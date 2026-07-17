(function () {
    "use strict";

    window.initQueryLogsSqlApp({
        tabKey: "querylogsmysql",
        idPrefix: "qlm",
        paneId: "mainTabPaneQueryLogsMySql",
        configRootId: "qlmConfigRoot",
        apiBase: "/api/querylogsmysql",
        appLabel: "MySQL/MariaDB",
        connStr: window.QueryLogsConnStr.keyValue({ server: "Server", port: "Port", user: "Uid", password: "Pwd" }),
        defaultPort: "3306",
        serverPlaceholder: "192.168.180.128",
        hasTrustServerCertificate: false,
        forbiddenKeywordLabel: "<code>Database=</code>"
    });
})();
