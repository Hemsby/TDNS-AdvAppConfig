(function () {
    "use strict";

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    window.QueryLogsConnStr = {
        keyValue: function (keys) {
            return {
                parse: function (str) {
                    const result = { server: "", port: "", user: "", password: "", extra: "" };
                    const extraParts = [];

                    (str || "").split(";").forEach((part) => {
                        const trimmed = part.trim();
                        if (!trimmed) return;

                        const eq = trimmed.indexOf("=");
                        if (eq === -1) { extraParts.push(trimmed); return; }

                        const key = trimmed.slice(0, eq).trim();
                        const value = trimmed.slice(eq + 1).trim();
                        const keyLower = key.toLowerCase();

                        if (keyLower === keys.server.toLowerCase()) result.server = value;
                        else if (keyLower === keys.port.toLowerCase()) result.port = value;
                        else if (keyLower === keys.user.toLowerCase()) result.user = value;
                        else if (keyLower === keys.password.toLowerCase()) result.password = value;
                        else extraParts.push(`${key}=${value}`);
                    });

                    result.extra = extraParts.join("; ");
                    return result;
                },
                build: function (fields) {
                    const parts = [];
                    if (fields.server) parts.push(`${keys.server}=${fields.server}`);
                    if (fields.port) parts.push(`${keys.port}=${fields.port}`);
                    if (fields.user) parts.push(`${keys.user}=${fields.user}`);
                    if (fields.password) parts.push(`${keys.password}=${fields.password}`);
                    if (fields.extra && fields.extra.trim()) parts.push(fields.extra.trim().replace(/;\s*$/, ""));
                    return parts.length ? parts.join("; ") + ";" : "";
                }
            };
        },
        sqlServer: function () {
            return {
                parse: function (str) {
                    const result = { server: "", port: "", user: "", password: "", trustServerCertificate: false, extra: "" };
                    const extraParts = [];

                    (str || "").split(";").forEach((part) => {
                        const trimmed = part.trim();
                        if (!trimmed) return;

                        const eq = trimmed.indexOf("=");
                        if (eq === -1) { extraParts.push(trimmed); return; }

                        const key = trimmed.slice(0, eq).trim();
                        const value = trimmed.slice(eq + 1).trim();
                        const keyLower = key.toLowerCase();

                        if (keyLower === "data source") {
                            const m = /^tcp:(.+),(\d+)$/i.exec(value);
                            if (m) { result.server = m[1]; result.port = m[2]; }
                            else extraParts.push(`${key}=${value}`);
                        } else if (keyLower === "user id") {
                            result.user = value;
                        } else if (keyLower === "password") {
                            result.password = value;
                        } else if (keyLower === "trustservercertificate") {
                            result.trustServerCertificate = value.toLowerCase() === "true";
                        } else {
                            extraParts.push(`${key}=${value}`);
                        }
                    });

                    result.extra = extraParts.join("; ");
                    return result;
                },
                build: function (fields) {
                    const parts = [];
                    if (fields.server) parts.push(`Data Source=tcp:${fields.server}${fields.port ? "," + fields.port : ""}`);
                    if (fields.user) parts.push(`User ID=${fields.user}`);
                    if (fields.password) parts.push(`Password=${fields.password}`);
                    if (fields.trustServerCertificate) parts.push("TrustServerCertificate=true");
                    if (fields.extra && fields.extra.trim()) parts.push(fields.extra.trim().replace(/;\s*$/, ""));
                    return parts.length ? parts.join("; ") + ";" : "";
                }
            };
        }
    };

    window.initQueryLogsSqlApp = function (opts) {
        const pane = document.getElementById(opts.paneId);
        const root = document.getElementById(opts.configRootId);
        const idp = opts.idPrefix;

        let config = null;
        let connFields = null;
        let loaded = false;
        let dirty = false;
        let currentSubTab = "config";

        function markDirty() {
            dirty = true;
            const badge = document.getElementById(idp + "ConfigDirtyBadge");
            if (badge) badge.style.display = "inline";
        }

        function clearDirty() {
            dirty = false;
            const badge = document.getElementById(idp + "ConfigDirtyBadge");
            if (badge) badge.style.display = "none";
        }

        function normalizeConfig(raw) {
            if (typeof raw !== "object" || raw === null) raw = {};

            if (typeof raw.enableLogging !== "boolean") raw.enableLogging = false;
            if (typeof raw.maxQueueSize !== "number") raw.maxQueueSize = 1000000;
            if (typeof raw.maxLogDays !== "number") raw.maxLogDays = 0;
            if (typeof raw.maxLogRecords !== "number") raw.maxLogRecords = 0;
            if (typeof raw.databaseName !== "string") raw.databaseName = "DnsQueryLogs";
            if (typeof raw.connectionString !== "string") raw.connectionString = "";

            return raw;
        }

        async function load() {
            root.innerHTML = "<p>Loading&hellip;</p>";
            try {
                const res = await apiFetch(opts.apiBase + "/config/raw");
                const data = await res.json();
                if (!data.success) {
                    root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(data.error || "unknown error")}</p>`;
                    return;
                }

                config = normalizeConfig(data.config || {});
                connFields = opts.connStr.parse(config.connectionString);
                clearDirty();
                renderRoot();
            } catch (err) {
                root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(err.message)}</p>`;
            }
        }

        async function save() {
            try {
                const res = await apiFetch(opts.apiBase + "/config/raw", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(config)
                });
                const data = await res.json();

                if (!data.success) {
                    await uiAlert("Failed to save config: " + (data.error || "unknown error"));
                    return;
                }

                clearDirty();
            } catch (err) {
                await uiAlert("Failed to save config: " + err.message);
            }
        }

        async function discard() {
            if (dirty && !(await uiConfirm("Discard unsaved changes?"))) return;
            load();
        }

        function onConfigTabActivated() {
            if (!loaded) {
                loaded = true;
                load();
                return;
            }

            if (!dirty) load();
        }

        window.addEventListener("beforeunload", (e) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = "";
            }
        });

        function initSubTabs() {
            pane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
                link.addEventListener("click", (e) => {
                    e.preventDefault();
                    switchSubTab(link.getAttribute("data-subtab"));
                });
            });
        }

        function switchSubTab(subtab) {
            currentSubTab = subtab;

            pane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
            pane.querySelectorAll(".tab-content > .tab-pane").forEach((p) => p.classList.remove("active"));

            pane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
            document.getElementById(idp + "TabPaneConfig").classList.add("active");

            if (subtab === "config") onConfigTabActivated();
        }

        document.addEventListener("tabchange", (e) => {
            if (e.detail.tab !== opts.tabKey) return;
            switchSubTab(currentSubTab);
        });

        document.addEventListener("authenticated", () => {
            if (loaded && !dirty) load();
        });

        function renderRoot() {
            root.innerHTML = `
                <div class="panel panel-default action-bar-sticky">
                    <div class="panel-body">
                        <div class="group-row">
                            <div><span id="${idp}ConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                            <div>
                                <button id="btn${idp}ConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                                <button id="btn${idp}ConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Logs every DNS query to a ${escapeHtml(opts.appLabel)} database. Logging stays off until a valid connection string is saved and enabled below.</p>
                        <div style="margin-bottom:8px;">
                            <label><input type="checkbox" id="${idp}CfgEnable" /> Enable Logging</label>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label>Max Queue Size<br/>
                                <input type="number" class="form-control" id="${idp}CfgMaxQueueSize" min="1" step="1" style="max-width:200px;" />
                            </label>
                            <p class="text-muted" style="margin-top:4px;">Maximum log entries buffered in memory before new entries are dropped.</p>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label>Max Log Age (days)<br/>
                                <input type="number" class="form-control" id="${idp}CfgMaxLogDays" min="0" step="1" style="max-width:150px;" />
                            </label>
                            <p class="text-muted" style="margin-top:4px;">0 disables age-based cleanup.</p>
                        </div>
                        <div>
                            <label>Max Log Records<br/>
                                <input type="number" class="form-control" id="${idp}CfgMaxLogRecords" min="0" step="1" style="max-width:200px;" />
                            </label>
                            <p class="text-muted" style="margin-top:4px;">0 disables count-based cleanup.</p>
                        </div>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Database Connection</h3></div>
                    <div class="panel-body">
                        <div style="margin-bottom:8px;">
                            <label>Database Name<br/>
                                <input type="text" class="form-control" id="${idp}CfgDatabaseName" style="max-width:300px;" />
                            </label>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label>Server<br/>
                                <input type="text" class="form-control" id="${idp}CfgConnServer" placeholder="e.g. ${escapeHtml(opts.serverPlaceholder)}" autocomplete="off" style="max-width:220px;" />
                            </label>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label>Port<br/>
                                <input type="number" class="form-control" id="${idp}CfgConnPort" min="1" max="65535" step="1" placeholder="${escapeHtml(opts.defaultPort)}" style="max-width:120px;" />
                            </label>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label>Username<br/>
                                <input type="text" class="form-control" id="${idp}CfgConnUser" autocomplete="off" style="max-width:220px;" />
                            </label>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label>Password<br/>
                                <input type="password" class="form-control" id="${idp}CfgConnPassword" autocomplete="new-password" style="max-width:220px;" />
                            </label>
                        </div>
                        ${opts.hasTrustServerCertificate ? `
                        <div style="margin-bottom:8px;">
                            <label><input type="checkbox" id="${idp}CfgConnTrustCert" /> Trust Server Certificate</label>
                            <p class="text-muted" style="margin-top:4px;">Skips TLS certificate validation for the database connection - typically needed for a self-signed or internal CA certificate.</p>
                        </div>` : ""}
                        <div>
                            <label>Additional Connection Options<br/>
                                <input type="text" class="form-control" id="${idp}CfgConnExtra" placeholder="e.g. SslMode=Required" style="width:600px; max-width:100%;" />
                            </label>
                            <p class="text-muted" style="margin-top:4px;">Anything not covered by the fields above - appended to the connection string as-is. A pasted connection string that used a different key name for a field above shows up here too, untouched. Don't add ${opts.forbiddenKeywordLabel} here - the database name is set above, and the app rejects a connection string that also specifies one.</p>
                        </div>
                    </div>
                </div>
            `;

            document.getElementById("btn" + idp + "ConfigSave").addEventListener("click", save);
            document.getElementById("btn" + idp + "ConfigDiscard").addEventListener("click", discard);

            document.getElementById(idp + "CfgEnable").checked = config.enableLogging;
            document.getElementById(idp + "CfgEnable").addEventListener("change", (e) => { config.enableLogging = e.target.checked; markDirty(); });

            const queueInput = document.getElementById(idp + "CfgMaxQueueSize");
            queueInput.value = config.maxQueueSize;
            queueInput.addEventListener("input", () => {
                const value = parseInt(queueInput.value, 10);
                config.maxQueueSize = (Number.isNaN(value) || value < 1) ? 1000000 : value;
                markDirty();
            });

            const daysInput = document.getElementById(idp + "CfgMaxLogDays");
            daysInput.value = config.maxLogDays;
            daysInput.addEventListener("input", () => {
                const value = parseInt(daysInput.value, 10);
                config.maxLogDays = (Number.isNaN(value) || value < 0) ? 0 : value;
                markDirty();
            });

            const recordsInput = document.getElementById(idp + "CfgMaxLogRecords");
            recordsInput.value = config.maxLogRecords;
            recordsInput.addEventListener("input", () => {
                const value = parseInt(recordsInput.value, 10);
                config.maxLogRecords = (Number.isNaN(value) || value < 0) ? 0 : value;
                markDirty();
            });

            const dbNameInput = document.getElementById(idp + "CfgDatabaseName");
            dbNameInput.value = config.databaseName;
            dbNameInput.addEventListener("input", () => { config.databaseName = dbNameInput.value; markDirty(); });

            function recomposeConnectionString() {
                config.connectionString = opts.connStr.build(connFields);
                markDirty();
            }

            const serverInput = document.getElementById(idp + "CfgConnServer");
            serverInput.value = connFields.server;
            serverInput.addEventListener("input", () => { connFields.server = serverInput.value; recomposeConnectionString(); });

            const portInput = document.getElementById(idp + "CfgConnPort");
            portInput.value = connFields.port;
            portInput.addEventListener("input", () => { connFields.port = portInput.value; recomposeConnectionString(); });

            const userInput = document.getElementById(idp + "CfgConnUser");
            userInput.value = connFields.user;
            userInput.addEventListener("input", () => { connFields.user = userInput.value; recomposeConnectionString(); });

            const passwordInput = document.getElementById(idp + "CfgConnPassword");
            passwordInput.value = connFields.password;
            passwordInput.addEventListener("input", () => { connFields.password = passwordInput.value; recomposeConnectionString(); });

            if (opts.hasTrustServerCertificate) {
                const trustCertInput = document.getElementById(idp + "CfgConnTrustCert");
                trustCertInput.checked = connFields.trustServerCertificate;
                trustCertInput.addEventListener("change", (e) => { connFields.trustServerCertificate = e.target.checked; recomposeConnectionString(); });
            }

            const extraInput = document.getElementById(idp + "CfgConnExtra");
            extraInput.value = connFields.extra;
            extraInput.addEventListener("input", () => { connFields.extra = extraInput.value; recomposeConnectionString(); });
        }

        initSubTabs();
    };
})();
