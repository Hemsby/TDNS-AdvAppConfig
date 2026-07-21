using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public sealed class TechnitiumClient
{
    internal static readonly JsonDocumentOptions CommentTolerantJsonOptions = new() { CommentHandling = JsonCommentHandling.Skip };

    public const string AdvancedBlockingAppName = "Advanced Blocking";
    public const string SplitHorizonAppName = "Split Horizon";
    public const string AdvancedForwardingAppName = "Advanced Forwarding";
    public const string BlockPageAppName = "Block Page";
    public const string DefaultRecordsAppName = "Default Records";
    public const string DnsBlockListAppName = "DNS Block List (DNSBL)";
    public const string DnsRebindingProtectionAppName = "DNS Rebinding Protection";
    public const string AutoPtrAppName = "Auto PTR";
    public const string Dns64AppName = "DNS64";
    public const string DropRequestsAppName = "Drop Requests";
    public const string FilterAaaaAppName = "Filter AAAA";
    public const string GeoContinentAppName = "Geo Continent";
    public const string GeoCountryAppName = "Geo Country";
    public const string GeoDistanceAppName = "Geo Distance";
    public const string FailoverAppName = "Failover";
    public const string LogExporterAppName = "Log Exporter";
    public const string NoDataAppName = "NO DATA";
    public const string NxDomainAppName = "NX Domain";
    public const string NxDomainOverrideAppName = "NX Domain Override";
    public const string QueryLogsMySqlAppName = "Query Logs (MySQL)";
    public const string QueryLogsPostgreSqlAppName = "Query Logs (PostgreSQL)";
    public const string QueryLogsSqlServerAppName = "Query Logs (SQL Server)";
    public const string QueryLogsSqliteAppName = "Query Logs (Sqlite)";
    public const string WeightedRoundRobinAppName = "Weighted Round Robin";
    public const string WhatIsMyDnsAppName = "What Is My Dns";
    public const string WildIpAppName = "Wild IP";
    public const string ZoneAliasAppName = "Zone Alias";

    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public TechnitiumClient(AppSettings settings)
    {
        _baseUrl = settings.ServerUrl.TrimEnd('/');

        HttpClientHandler handler = new HttpClientHandler();
        if (settings.IgnoreSslErrors)
            handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;

        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };

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

    public async Task<JsonNode> ListInstalledAppsAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync("/api/apps/list", ct);
        return root["response"] ?? throw new InvalidOperationException("Empty response from server.");
    }

    public async Task<JsonNode> ListStoreAppsAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync("/api/apps/listStoreApps", ct);
        return root["response"] ?? throw new InvalidOperationException("Empty response from server.");
    }

    public async Task InstallAppAsync(string name, string url, CancellationToken ct = default)
    {
        Dictionary<string, string> form = new() { ["name"] = name, ["url"] = url };
        await PostFormAsync("/api/apps/downloadAndInstall", form, ct);
    }

    public async Task UninstallAppAsync(string name, CancellationToken ct = default)
    {
        Dictionary<string, string> form = new() { ["name"] = name };
        await PostFormAsync("/api/apps/uninstall", form, ct);
    }

    public async Task<string?> GetAppConfigRawAsync(string appName, CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(appName)}", ct);
        return root["response"]?["config"]?.GetValue<string>();
    }

    public async Task SetAppConfigRawAsync(string appName, string? config, CancellationToken ct = default)
    {
        Dictionary<string, string> form = new() { ["name"] = appName, ["config"] = config ?? "" };
        await PostFormAsync("/api/apps/config/set", form, ct);
    }

    public async Task<JsonNode> GetAdvancedBlockingConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(AdvancedBlockingAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Advanced Blocking' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Advanced Blocking app config could not be parsed.");
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

    public async Task<(JsonNode? Lists, string Source)> GetQuickBlockListsAsync(CancellationToken ct = default)
    {
        JsonNode? custom = await TryGetStaticJsonAsync("/json/quick-block-lists-custom.json", ct);
        if (custom is not null)
            return (custom, "custom");

        return (await TryGetStaticJsonAsync("/json/quick-block-lists-builtin.json", ct), "builtin");
    }

    private async Task<JsonNode?> TryGetStaticJsonAsync(string relativeUrl, CancellationToken ct)
    {
        using HttpResponseMessage response = await _http.GetAsync($"{_baseUrl}{relativeUrl}", ct);
        if (!response.IsSuccessStatusCode)
            return null;

        return JsonNode.Parse(await response.Content.ReadAsStringAsync(ct), documentOptions: CommentTolerantJsonOptions);
    }

    public async Task<JsonNode> GetSplitHorizonConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(SplitHorizonAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Split Horizon' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Split Horizon app config could not be parsed.");
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

    public async Task<JsonNode> GetAdvancedForwardingConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(AdvancedForwardingAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Advanced Forwarding' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Advanced Forwarding app config could not be parsed.");
    }

    public async Task SetAdvancedForwardingConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = AdvancedForwardingAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetBlockPageConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(BlockPageAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Block Page' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Block Page app config could not be parsed.");
    }

    public async Task SetBlockPageConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = BlockPageAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetDefaultRecordsConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(DefaultRecordsAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Default Records' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Default Records app config could not be parsed.");
    }

    public async Task SetDefaultRecordsConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = DefaultRecordsAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetDns64ConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(Dns64AppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'DNS64' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("DNS64 app config could not be parsed.");
    }

    public async Task SetDns64ConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = Dns64AppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetDropRequestsConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(DropRequestsAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Drop Requests' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Drop Requests app config could not be parsed.");
    }

    public async Task SetDropRequestsConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = DropRequestsAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetFilterAaaaConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(FilterAaaaAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Filter AAAA' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Filter AAAA app config could not be parsed.");
    }

    public async Task SetFilterAaaaConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = FilterAaaaAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetGeoContinentConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(GeoContinentAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Geo Continent' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Geo Continent app config could not be parsed.");
    }

    public async Task SetGeoContinentConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = GeoContinentAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetGeoCountryConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(GeoCountryAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Geo Country' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Geo Country app config could not be parsed.");
    }

    public async Task SetGeoCountryConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = GeoCountryAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetFailoverConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(FailoverAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Failover' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Failover app config could not be parsed.");
    }

    public async Task SetFailoverConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = FailoverAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetLogExporterConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(LogExporterAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Log Exporter' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Log Exporter app config could not be parsed.");
    }

    public async Task SetLogExporterConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = LogExporterAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetNxDomainConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(NxDomainAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'NX Domain' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("NX Domain app config could not be parsed.");
    }

    public async Task SetNxDomainConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = NxDomainAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetZoneAliasConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(ZoneAliasAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Zone Alias' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Zone Alias app config could not be parsed.");
    }

    public async Task SetZoneAliasConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = ZoneAliasAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetNxDomainOverrideConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(NxDomainOverrideAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'NX Domain Override' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("NX Domain Override app config could not be parsed.");
    }

    public async Task SetNxDomainOverrideConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = NxDomainOverrideAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetQueryLogsMySqlConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(QueryLogsMySqlAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Query Logs (MySQL)' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Query Logs (MySQL) app config could not be parsed.");
    }

    public async Task SetQueryLogsMySqlConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = QueryLogsMySqlAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetQueryLogsPostgreSqlConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(QueryLogsPostgreSqlAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Query Logs (PostgreSQL)' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Query Logs (PostgreSQL) app config could not be parsed.");
    }

    public async Task SetQueryLogsPostgreSqlConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = QueryLogsPostgreSqlAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetQueryLogsSqlServerConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(QueryLogsSqlServerAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Query Logs (SQL Server)' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Query Logs (SQL Server) app config could not be parsed.");
    }

    public async Task SetQueryLogsSqlServerConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = QueryLogsSqlServerAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetQueryLogsSqliteConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(QueryLogsSqliteAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'Query Logs (Sqlite)' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("Query Logs (Sqlite) app config could not be parsed.");
    }

    public async Task SetQueryLogsSqliteConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = QueryLogsSqliteAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetDnsRebindingProtectionConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(DnsRebindingProtectionAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'DNS Rebinding Protection' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("DNS Rebinding Protection app config could not be parsed.");
    }

    public async Task SetDnsRebindingProtectionConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = DnsRebindingProtectionAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<JsonNode> GetDnsBlockListConfigAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/apps/config/get?name={Uri.EscapeDataString(DnsBlockListAppName)}", ct);
        string? configJson = root["response"]?["config"]?.GetValue<string>();
        if (string.IsNullOrEmpty(configJson))
            throw new InvalidOperationException("The 'DNS Block List (DNSBL)' app is not installed or has no configuration.");

        return JsonNode.Parse(configJson, documentOptions: CommentTolerantJsonOptions) ?? throw new InvalidOperationException("DNS Block List app config could not be parsed.");
    }

    public async Task SetDnsBlockListConfigAsync(JsonNode config, CancellationToken ct = default)
    {
        string configJson = config.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

        using FormUrlEncodedContent content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["name"] = DnsBlockListAppName,
            ["config"] = configJson
        });

        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}/api/apps/config/set", content, ct);
        response.EnsureSuccessStatusCode();

        JsonNode result = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidOperationException("Empty response from server.");
        EnsureOk(result);
    }

    public async Task<uint> GetDefaultRecordTtlAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync("/api/settings/get", ct);
        return root["response"]?["defaultRecordTtl"]?.GetValue<uint>() ?? 3600;
    }

    public async Task<List<string>> ListWritableZoneNamesAsync(CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync("/api/zones/list", ct);
        JsonArray? zones = root["response"]?["zones"]?.AsArray();
        if (zones is null)
            return [];

        List<string> names = [];
        foreach (JsonNode? zone in zones)
        {
            if (zone is null)
                continue;

            string? type = zone["type"]?.GetValue<string>();
            bool isInternal = zone["internal"]?.GetValue<bool>() ?? false;
            string? name = zone["name"]?.GetValue<string>();
            string? dnssecStatus = zone["dnssecStatus"]?.GetValue<string>();

            if (type == "Primary" && dnssecStatus != "Unsigned")
                continue;

            if ((type == "Primary" || type == "Forwarder") && !isInternal && !string.IsNullOrEmpty(name))
                names.Add(name);
        }

        return names;
    }

    public async Task<List<AppRecord>> GetAppRecordsAsync(string zoneName, string appName, CancellationToken ct = default)
    {
        JsonNode root = await GetJsonAsync($"/api/zones/records/get?domain={Uri.EscapeDataString(zoneName)}&zone={Uri.EscapeDataString(zoneName)}&listZone=true", ct);
        JsonArray? records = root["response"]?["records"]?.AsArray();
        if (records is null)
            return [];

        List<AppRecord> results = [];
        foreach (JsonNode? record in records)
        {
            if (record is null || record["type"]?.GetValue<string>() != "APP")
                continue;

            JsonNode? rData = record["rData"];
            if (rData is null || rData["appName"]?.GetValue<string>() != appName)
                continue;

            results.Add(new AppRecord(
                Domain: record["name"]?.GetValue<string>() ?? "",
                Zone: zoneName,
                Ttl: record["ttl"]?.GetValue<int>() ?? 0,
                Disabled: record["disabled"]?.GetValue<bool>() ?? false,
                ClassPath: rData["classPath"]?.GetValue<string>() ?? "",
                Data: rData["data"]?.GetValue<string>() ?? ""
            ));
        }

        return results;
    }

    public async Task AddAppRecordAsync(string domain, string zone, string appName, string classPath, string recordData, int ttl, CancellationToken ct = default)
    {
        Dictionary<string, string> form = new()
        {
            ["domain"] = domain,
            ["zone"] = zone,
            ["type"] = "APP",
            ["ttl"] = ttl.ToString(),
            ["overwrite"] = "true",
            ["appName"] = appName,
            ["classPath"] = classPath,
            ["recordData"] = recordData
        };

        await PostFormAsync("/api/zones/records/add", form, ct);
    }

    public async Task DeleteAppRecordAsync(string domain, string zone, CancellationToken ct = default)
    {
        Dictionary<string, string> form = new()
        {
            ["domain"] = domain,
            ["zone"] = zone,
            ["type"] = "APP"
        };

        await PostFormAsync("/api/zones/records/delete", form, ct);
    }

    private async Task PostFormAsync(string relativeUrl, Dictionary<string, string> form, CancellationToken ct)
    {
        using FormUrlEncodedContent content = new FormUrlEncodedContent(form);
        using HttpResponseMessage response = await _http.PostAsync($"{_baseUrl}{relativeUrl}", content, ct);
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

public sealed record AppRecord(string Domain, string Zone, int Ttl, bool Disabled, string ClassPath, string Data);
