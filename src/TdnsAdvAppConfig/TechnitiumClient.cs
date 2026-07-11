using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public sealed class TechnitiumClient
{
    public const string AdvancedBlockingAppName = "Advanced Blocking";
    public const string SplitHorizonAppName = "Split Horizon";

    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public TechnitiumClient(AppSettings settings)
    {
        _baseUrl = settings.ServerUrl.TrimEnd('/');

        HttpClientHandler handler = new HttpClientHandler();
        if (settings.IgnoreSslErrors)
            handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;

        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };

        // The DNS Server checks Authorization: Bearer first, falling back to a
        // ?token=/form token only if absent. Using the header keeps the token
        // out of URLs entirely (no risk of it showing up in access logs, proxy
        // logs, or browser history) - the token= fallback is not used here.
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);
    }

    public async Task<bool> IsAppInstalledAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync("/api/apps/list", ct);
        JsonArray? apps = root["response"]?["apps"]?.AsArray();
        if (apps is null)
            return false;

        foreach (JsonNode? app in apps)
        {
            if (string.Equals(app?["name"]?.GetValue<string>(), AdvancedBlockingAppName, StringComparison.Ordinal))
                return true;
        }

        return false;
    }

    public async Task<JsonNode> GetAdvancedBlockingConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(AdvancedBlockingAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Advanced Blocking' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson) ?? throw new InvalidOperationException("Advanced Blocking app config could not be parsed.");
    }

    public async Task SetAdvancedBlockingConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = AdvancedBlockingAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetSplitHorizonConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(SplitHorizonAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Split Horizon' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson) ?? throw new InvalidOperationException("Split Horizon app config could not be parsed.");
    }

    public async Task SetSplitHorizonConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = SplitHorizonAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    private async Task<JsonNode> GetJsonAsync(string relativeUrl, CancellationToken ct)
    {
        using HttpResponseMessage response = await _http.GetAsync($"{_baseUrl}{relativeUrl}", ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);

        return result;
    }

    private static void EnsureOk(JsonNode result)
    {
        string? status = result["status"]?.GetValue<string>();
        if (status != "ok")
            throw new InvalidOperationException($"Technitium API error: {result["errorMessage"]?.GetValue<string>() ?? status}");
    }
}
