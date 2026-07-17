(function () {
    "use strict";

    window.initQueryLogsSqlApp({
        tabKey: "querylogspostgresql",
        idPrefix: "qlp",
        paneId: "mainTabPaneQueryLogsPostgreSql",
        configRootId: "qlpConfigRoot",
        apiBase: "/api/querylogspostgresql",
        appLabel: "PostgreSQL",
        connStr: window.QueryLogsConnStr.keyValue({ server: "Server", port: "Port", user: "Username", password: "Password" }),
        defaultPort: "5432",
        serverPlaceholder: "127.0.0.1",
        hasTrustServerCertificate: false,
        forbiddenKeywordLabel: "<code>Database=</code>"
    });
})();
