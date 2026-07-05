using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TdnsAdvAppConfig;

string configPath = Path.Combine(AppContext.BaseDirectory, "config.json");

AppSettings settings;
try
{
    settings = AppSettings.Load(configPath);
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}

string currentVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.ListenAnyIP(settings.ListenPort));
builder.Host.UseSystemd();
builder.Host.UseWindowsService();

builder.Services.AddSingleton(settings);
builder.Services.AddSingleton<TechnitiumClient>();
builder.Services.AddSingleton<BlockingService>();
builder.Services.AddSingleton<PauseTimerService>();
builder.Services.AddSingleton(new UpdateManager(settings, currentVersion));
builder.Services.AddSingleton<UpdateApplier>();

WebApplication app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// Everything under /api requires the shared secret, via Authorization: Bearer.
// Without this, anyone reaching this addon's port would have unauthenticated
// control over blocking and config (the addon holds a Technitium API token
// with Apps:Modify permission). Static files (the page shell/JS/CSS) stay
// public - they carry no sensitive data - so the login prompt can render.
byte[] expectedSecretBytes = Encoding.UTF8.GetBytes(settings.AdminSecret);

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        string authHeader = context.Request.Headers.Authorization.ToString();
        string provided = authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? authHeader["Bearer ".Length..].Trim()
            : "";

        byte[] providedBytes = Encoding.UTF8.GetBytes(provided);
        bool valid = providedBytes.Length == expectedSecretBytes.Length && CryptographicOperations.FixedTimeEquals(providedBytes, expectedSecretBytes);

        if (!valid)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { success = false, error = "Unauthorized" });
            return;
        }
    }

    await next();
});

app.MapGet("/api/status", async (BlockingService svc, PauseTimerService timers) =>
{
    try
    {
        BlockingStatus status = await svc.GetStatusAsync();
        var groups = status.Groups.Select(g => new { g.Name, g.EnableBlocking, resumeAt = timers.GetExpiry(g.Name) });
        return Results.Ok(new { connected = true, rootEnableBlocking = status.RootEnableBlocking, rootResumeAt = timers.GetExpiry(PauseTimerService.RootTarget), groups, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { connected = false, rootEnableBlocking = false, rootResumeAt = (DateTime?)null, groups = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/groups/toggle", async (ToggleRequest req, BlockingService svc, PauseTimerService timers) =>
{
    try
    {
        BlockingStatus status = await svc.SetGroupEnabledAsync(req.Name, req.Enabled);

        if (req.Enabled)
            timers.CancelPause(req.Name);
        else if (req.DurationMinutes is int minutes && minutes > 0)
            timers.SchedulePause(req.Name, TimeSpan.FromMinutes(minutes));
        else
            timers.CancelPause(req.Name);

        var groups = status.Groups.Select(g => new { g.Name, g.EnableBlocking, resumeAt = timers.GetExpiry(g.Name) });
        return Results.Ok(new { success = true, rootEnableBlocking = status.RootEnableBlocking, rootResumeAt = timers.GetExpiry(PauseTimerService.RootTarget), groups, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/root/toggle", async (RootToggleRequest req, BlockingService svc, PauseTimerService timers) =>
{
    try
    {
        BlockingStatus status = await svc.SetRootEnabledAsync(req.Enabled);

        if (req.Enabled)
            timers.CancelPause(PauseTimerService.RootTarget);
        else if (req.DurationMinutes is int minutes && minutes > 0)
            timers.SchedulePause(PauseTimerService.RootTarget, TimeSpan.FromMinutes(minutes));
        else
            timers.CancelPause(PauseTimerService.RootTarget);

        var groups = status.Groups.Select(g => new { g.Name, g.EnableBlocking, resumeAt = timers.GetExpiry(g.Name) });
        return Results.Ok(new { success = true, rootEnableBlocking = status.RootEnableBlocking, rootResumeAt = timers.GetExpiry(PauseTimerService.RootTarget), groups, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetAdvancedBlockingConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = AdvancedBlockingConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetAdvancedBlockingConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/version", () => Results.Ok(new { version = currentVersion }));

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/updates/check", async (UpdateManager um) => Results.Ok(await um.CheckAsync()));

app.MapPost("/api/updates/apply", async (UpdateManager um, UpdateApplier applier) =>
{
    ReleaseCheckResult check = await um.CheckAsync();
    if (!check.UpdateAvailable)
        return Results.Ok(new { success = false, error = "No update available." });

    if (check.DownloadUrl is null)
        return Results.Ok(new { success = false, error = $"No release asset found for this platform ({UpdateManager.CurrentRid})." });

    (bool success, string status, string? message) = await applier.ApplyAsync(check.DownloadUrl, AppContext.BaseDirectory, CancellationToken.None);
    return Results.Ok(new { success, status, message });
});

app.Run();

return 0;

sealed record ToggleRequest(string Name, bool Enabled, int? DurationMinutes = null);
sealed record RootToggleRequest(bool Enabled, int? DurationMinutes = null);
