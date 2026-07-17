namespace TdnsAdvAppConfig;

public sealed record AppToggleInfo(string Key, string AppName, string DisplayName, string FieldName, bool DefaultValue);

public static class DashboardAppToggles
{
    public static readonly IReadOnlyList<AppToggleInfo> All =
    [
        new("splithorizon", TechnitiumClient.SplitHorizonAppName, "Split Horizon", "enableAddressTranslation", false),
        new("advancedforwarding", TechnitiumClient.AdvancedForwardingAppName, "Advanced Forwarding", "enableForwarding", true),
        new("defaultrecords", TechnitiumClient.DefaultRecordsAppName, "Default Records", "enableDefaultRecords", false),
        new("dnsrebindingprotection", TechnitiumClient.DnsRebindingProtectionAppName, "DNS Rebinding Protection", "enableProtection", true),
        new("droprequests", TechnitiumClient.DropRequestsAppName, "Drop Requests", "enableBlocking", true),
        new("filteraaaa", TechnitiumClient.FilterAaaaAppName, "Filter AAAA", "enableFilterAaaa", false),
        new("nxdomain", TechnitiumClient.NxDomainAppName, "NX Domain", "enableBlocking", true),
        new("nxdomainoverride", TechnitiumClient.NxDomainOverrideAppName, "NX Domain Override", "enableOverride", true),
        new("querylogsmysql", TechnitiumClient.QueryLogsMySqlAppName, "Query Logs (MySQL)", "enableLogging", false),
        new("querylogspostgresql", TechnitiumClient.QueryLogsPostgreSqlAppName, "Query Logs (PostgreSQL)", "enableLogging", false),
        new("querylogssqlserver", TechnitiumClient.QueryLogsSqlServerAppName, "Query Logs (SQL Server)", "enableLogging", false),
        new("querylogssqlite", TechnitiumClient.QueryLogsSqliteAppName, "Query Logs (Sqlite)", "enableLogging", true),
        new("zonealias", TechnitiumClient.ZoneAliasAppName, "Zone Alias", "enableAliasing", true),
    ];
}
