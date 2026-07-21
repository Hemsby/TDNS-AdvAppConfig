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

app.MapGet("/api/dashboard/apptoggles", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode installedResponse = await client.ListInstalledAppsAsync();
        HashSet<string> installedNames = new(StringComparer.Ordinal);

        foreach (JsonNode? installedApp in installedResponse["apps"]?.AsArray() ?? [])
        {
            string? name = installedApp?["name"]?.GetValue<string>();
            if (name is not null)
                installedNames.Add(name);
        }

        async Task<object> LoadOneAsync(AppToggleInfo info)
        {
            try
            {
                string? raw = await client.GetAppConfigRawAsync(info.AppName);
                bool enabled = info.DefaultValue;

                if (!string.IsNullOrEmpty(raw))
                {
                    JsonNode? parsed = JsonNode.Parse(raw, documentOptions: TechnitiumClient.CommentTolerantJsonOptions);
                    if (parsed?[info.FieldName] is JsonValue fieldValue && fieldValue.TryGetValue(out bool parsedEnabled))
                        enabled = parsedEnabled;
                }

                return new { key = info.Key, displayName = info.DisplayName, enabled = (bool?)enabled, error = (string?)null };
            }
            catch (Exception ex)
            {
                return new { key = info.Key, displayName = info.DisplayName, enabled = (bool?)null, error = ex.Message };
            }
        }

        object[] toggles = await Task.WhenAll(DashboardAppToggles.All.Where(t => installedNames.Contains(t.AppName)).Select(LoadOneAsync));
        return Results.Ok(new { success = true, toggles, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, toggles = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/dashboard/apptoggles/set", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        string? key = body.TryGetProperty("key", out JsonElement keyEl) ? keyEl.GetString() : null;
        bool enabled = body.TryGetProperty("enabled", out JsonElement enabledEl) && enabledEl.ValueKind == JsonValueKind.True;

        AppToggleInfo? info = DashboardAppToggles.All.FirstOrDefault(t => t.Key == key);
        if (info is null)
            return Results.Ok(new { success = false, error = "Unknown app." });

        string? raw = await client.GetAppConfigRawAsync(info.AppName);
        if (string.IsNullOrEmpty(raw))
            return Results.Ok(new { success = false, error = $"The '{info.DisplayName}' app is not installed or has no configuration." });

        JsonNode? config = JsonNode.Parse(raw, documentOptions: TechnitiumClient.CommentTolerantJsonOptions);
        if (config is not JsonObject root)
            return Results.Ok(new { success = false, error = "Existing config could not be parsed as an object." });

        root[info.FieldName] = enabled;

        await client.SetAppConfigRawAsync(info.AppName, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
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

app.MapGet("/api/advancedblocking/quickblocklists", async (TechnitiumClient client) =>
{
    try
    {
        (JsonNode? lists, string source) = await client.GetQuickBlockListsAsync();
        return Results.Ok(new { success = true, lists, source, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, lists = (JsonNode?)null, source = (string?)null, error = ex.Message });
    }
});

app.MapGet("/api/splithorizon/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetSplitHorizonConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/splithorizon/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = SplitHorizonConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetSplitHorizonConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/advancedforwarding/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetAdvancedForwardingConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/advancedforwarding/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = AdvancedForwardingConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetAdvancedForwardingConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/blockpage/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetBlockPageConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/blockpage/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = BlockPageConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetBlockPageConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/defaultrecords/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetDefaultRecordsConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/defaultrecords/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = DefaultRecordsConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetDefaultRecordsConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/dnsblocklist/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetDnsBlockListConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/dnsblocklist/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = DnsBlockListConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetDnsBlockListConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/autoptr/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.AutoPtrAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/autoptr/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = AutoPtrAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.AutoPtrAppName, "AutoPtr.App", recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/autoptr/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/wildip/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.WildIpAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/wildip/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = WildIpAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.WildIpAppName, "WildIp.App", recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/wildip/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/zonealias/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetZoneAliasConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/zonealias/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = ZoneAliasConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetZoneAliasConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/dns64/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetDns64ConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/dns64/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = Dns64ConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetDns64ConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/droprequests/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetDropRequestsConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/droprequests/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = DropRequestsConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetDropRequestsConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/filteraaaa/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetFilterAaaaConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/filteraaaa/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = FilterAaaaConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetFilterAaaaConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/geocontinent/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetGeoContinentConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/geocontinent/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = GeoGroupsConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetGeoContinentConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/geocountry/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetGeoCountryConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/geocountry/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = GeoGroupsConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetGeoCountryConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/failover/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetFailoverConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/failover/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = FailoverConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetFailoverConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/logexporter/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetLogExporterConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/logexporter/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = LogExporterConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetLogExporterConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/nxdomain/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetNxDomainConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/nxdomain/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = NxDomainConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetNxDomainConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/nxdomainoverride/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetNxDomainOverrideConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/nxdomainoverride/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = NxDomainOverrideConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetNxDomainOverrideConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/querylogsmysql/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetQueryLogsMySqlConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/querylogsmysql/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = SqlQueryLogsConfigValidator.Validate(config, "Database=", true);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetQueryLogsMySqlConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/querylogspostgresql/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetQueryLogsPostgreSqlConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/querylogspostgresql/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = SqlQueryLogsConfigValidator.Validate(config, "Database=", true);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetQueryLogsPostgreSqlConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/querylogssqlserver/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetQueryLogsSqlServerConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/querylogssqlserver/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = SqlQueryLogsConfigValidator.Validate(config, "Initial Catalog", false);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetQueryLogsSqlServerConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/querylogssqlite/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetQueryLogsSqliteConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/querylogssqlite/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = SqliteQueryLogsConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetQueryLogsSqliteConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/dnsrebindingprotection/config/raw", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode config = await client.GetDnsRebindingProtectionConfigAsync();
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/dnsrebindingprotection/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode config = JsonNode.Parse(body.GetRawText()) ?? throw new InvalidOperationException("Empty config body.");

        List<string> validationErrors = DnsRebindingProtectionConfigValidator.Validate(config);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Config rejected before saving: " + string.Join("; ", validationErrors) });

        await client.SetDnsRebindingProtectionConfigAsync(config);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/dnsblocklist/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.DnsBlockListAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/dnsblocklist/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = DnsBlockListAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.DnsBlockListAppName, "DnsBlockList.App", recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/dnsblocklist/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/splithorizon/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.SplitHorizonAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/splithorizon/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = SplitHorizonAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        string classPath = req["classPath"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.SplitHorizonAppName, classPath, recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/splithorizon/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/geocontinent/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.GeoContinentAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/geocontinent/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = GeoAppRecordValidator.Validate(req, "GeoContinent.Address", "GeoContinent.CNAME");
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        string classPath = req["classPath"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.GeoContinentAppName, classPath, recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/geocontinent/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/geocountry/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.GeoCountryAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/geocountry/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = GeoAppRecordValidator.Validate(req, "GeoCountry.Address", "GeoCountry.CNAME");
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        string classPath = req["classPath"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.GeoCountryAppName, classPath, recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/geocountry/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/geodistance/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.GeoDistanceAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/geodistance/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = GeoDistanceAppRecordValidator.Validate(req, "GeoDistance.Address", "GeoDistance.CNAME");
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        string classPath = req["classPath"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.GeoDistanceAppName, classPath, recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/geodistance/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/failover/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.FailoverAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/failover/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        string? classPath = req["classPath"]?.GetValue<string>();

        List<string> validationErrors = classPath switch
        {
            "Failover.Address" => FailoverAppRecordValidator.ValidateAddress(req),
            "Failover.CNAME" => FailoverAppRecordValidator.ValidateCname(req),
            _ => ["'classPath' must be one of: Failover.Address, Failover.CNAME."]
        };

        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.FailoverAppName, classPath!, recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/failover/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/nodata/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.NoDataAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/nodata/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = NoDataAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.NoDataAppName, "NoData.App", recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/nodata/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/weightedroundrobin/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.WeightedRoundRobinAppName))
            {
                JsonNode? data = null;
                try { data = JsonNode.Parse(rec.Data); } catch (JsonException) { }

                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled, rec.ClassPath, data, dataRaw = data is null ? rec.Data : null });
            }
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/weightedroundrobin/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = WeightedRoundRobinAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        string classPath = req["classPath"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();
        string recordData = req["data"]!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.WeightedRoundRobinAppName, classPath, recordData, ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/weightedroundrobin/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/whatismydns/records", async (TechnitiumClient client) =>
{
    try
    {
        List<string> zones = await client.ListWritableZoneNamesAsync();
        List<object> records = [];

        foreach (string zone in zones)
        {
            foreach (AppRecord rec in await client.GetAppRecordsAsync(zone, TechnitiumClient.WhatIsMyDnsAppName))
                records.Add(new { rec.Domain, rec.Zone, rec.Ttl, rec.Disabled });
        }

        uint defaultTtl;
        try { defaultTtl = await client.GetDefaultRecordTtlAsync(); }
        catch { defaultTtl = 3600; }

        return Results.Ok(new { success = true, zones, records, defaultTtl, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, zones = Array.Empty<string>(), records = Array.Empty<object>(), error = ex.Message });
    }
});

app.MapPost("/api/whatismydns/records", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        if (JsonNode.Parse(body.GetRawText()) is not JsonObject req)
            return Results.Ok(new { success = false, error = "Invalid request body." });

        List<string> validationErrors = WhatIsMyDnsAppRecordValidator.Validate(req);
        if (validationErrors.Count > 0)
            return Results.Ok(new { success = false, error = "Record rejected before saving: " + string.Join("; ", validationErrors) });

        string domain = req["domain"]!.GetValue<string>();
        string zone = req["zone"]!.GetValue<string>();
        int ttl = req["ttl"]!.GetValue<int>();

        await client.AddAppRecordAsync(domain, zone, TechnitiumClient.WhatIsMyDnsAppName, "WhatIsMyDns.App", "{}", ttl);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/whatismydns/records/delete", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? domain = req?["domain"]?.GetValue<string>();
        string? zone = req?["zone"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(zone))
            return Results.Ok(new { success = false, error = "'domain' and 'zone' are required." });

        await client.DeleteAppRecordAsync(domain, zone);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/appstore/installed", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode response = await client.ListInstalledAppsAsync();
        return Results.Ok(new { success = true, apps = response["apps"], error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, apps = (JsonNode?)null, error = ex.Message });
    }
});

app.MapGet("/api/appstore/available", async (TechnitiumClient client) =>
{
    try
    {
        JsonNode response = await client.ListStoreAppsAsync();
        JsonArray available = [];

        foreach (JsonNode? storeApp in response["storeApps"]?.AsArray() ?? [])
        {
            if (storeApp is null)
                continue;

            bool installed = storeApp["installed"]?.GetValue<bool>() ?? false;
            if (!installed)
                available.Add(storeApp.DeepClone());
        }

        return Results.Ok(new { success = true, apps = (JsonNode)available, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, apps = (JsonNode?)null, error = ex.Message });
    }
});

app.MapPost("/api/appstore/install", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? name = req?["name"]?.GetValue<string>();
        string? url = req?["url"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(url))
            return Results.Ok(new { success = false, error = "'name' and 'url' are required." });

        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return Results.Ok(new { success = false, error = "'url' must start with 'https://'." });

        await client.InstallAppAsync(name, url);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/appstore/uninstall", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? name = req?["name"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(name))
            return Results.Ok(new { success = false, error = "'name' is required." });

        await client.UninstallAppAsync(name);
        return Results.Ok(new { success = true, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/apps/config/raw", async (string? name, TechnitiumClient client) =>
{
    try
    {
        if (string.IsNullOrWhiteSpace(name))
            return Results.Ok(new { success = false, config = (string?)null, error = "'name' is required." });

        string? config = await client.GetAppConfigRawAsync(name);
        return Results.Ok(new { success = true, config, error = (string?)null });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, config = (string?)null, error = ex.Message });
    }
});

app.MapPost("/api/apps/config/raw", async (JsonElement body, TechnitiumClient client) =>
{
    try
    {
        JsonNode? req = JsonNode.Parse(body.GetRawText());
        string? name = req?["name"]?.GetValue<string>();
        string? config = req?["config"]?.GetValue<string>();

        if (string.IsNullOrWhiteSpace(name))
            return Results.Ok(new { success = false, error = "'name' is required." });

        await client.SetAppConfigRawAsync(name, config);
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
