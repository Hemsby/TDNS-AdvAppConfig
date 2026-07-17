(function () {
    "use strict";

    window.initQueryLogsSqlApp({
        tabKey: "querylogssqlserver",
        idPrefix: "qls",
        paneId: "mainTabPaneQueryLogsSqlServer",
        configRootId: "qlsConfigRoot",
        apiBase: "/api/querylogssqlserver",
        appLabel: "SQL Server",
        connStr: window.QueryLogsConnStr.sqlServer(),
        defaultPort: "1433",
        serverPlaceholder: "192.168.10.101",
        hasTrustServerCertificate: true,
        forbiddenKeywordLabel: "<code>Initial Catalog</code>"
    });
})();
