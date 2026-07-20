(function () {
    "use strict";

    const pane = document.getElementById("mainTabPaneQueryLogsSqlite");
    const root = document.getElementById("qltConfigRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "config";

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("qltConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("qltConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.enableLogging !== "boolean") raw.enableLogging = true;
        if (typeof raw.maxQueueSize !== "number") raw.maxQueueSize = 200000;
        if (typeof raw.maxLogDays !== "number") raw.maxLogDays = 0;
        if (typeof raw.maxLogRecords !== "number") raw.maxLogRecords = 0;
        if (typeof raw.enableVacuum !== "boolean") raw.enableVacuum = false;
        if (typeof raw.useInMemoryDb !== "boolean") raw.useInMemoryDb = false;
        if (typeof raw.sqliteDbPath !== "string") raw.sqliteDbPath = "querylogs.db";
        if (typeof raw.connectionString !== "string") raw.connectionString = "Data Source='{sqliteDbPath}'; Cache=Shared;";

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/querylogssqlite/config/raw");
            const data = await res.json();
            if (!data.success) {
                root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            config = normalizeConfig(data.config || {});
            clearDirty();
            renderRoot();
        } catch (err) {
            root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(err.message)}</p>`;
        }
    }

    async function save() {
        try {
            const res = await apiFetch("/api/querylogssqlite/config/raw", {
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
        document.getElementById("qltTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "querylogssqlite") return;
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
                        <div><span id="qltConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnQltConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnQltConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Logs every DNS query to a local SQLite database file.</p>
                    <div style="margin-bottom:8px;">
                        <label><input type="checkbox" id="qltCfgEnable" /> Enable Logging</label>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label>Max Queue Size<br/>
                            <input type="number" class="form-control" id="qltCfgMaxQueueSize" min="1" step="1" style="max-width:200px;" />
                        </label>
                        <p class="text-muted" style="margin-top:4px;">Maximum log entries buffered in memory before new entries are dropped.</p>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label>Max Log Age (days)<br/>
                            <input type="number" class="form-control" id="qltCfgMaxLogDays" min="0" step="1" style="max-width:150px;" />
                        </label>
                        <p class="text-muted" style="margin-top:4px;">0 disables age-based cleanup.</p>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label>Max Log Records<br/>
                            <input type="number" class="form-control" id="qltCfgMaxLogRecords" min="0" step="1" style="max-width:200px;" />
                        </label>
                        <p class="text-muted" style="margin-top:4px;">0 disables count-based cleanup.</p>
                    </div>
                    <div>
                        <label><input type="checkbox" id="qltCfgEnableVacuum" /> Vacuum Database After Cleanup</label>
                        <p class="text-muted" style="margin-top:4px;">Runs SQLite's <code>VACUUM</code> after a cleanup pass that actually deleted records, reclaiming disk space at the cost of extra I/O.</p>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Storage</h3></div>
                <div class="panel-body">
                    <div style="margin-bottom:8px;">
                        <label><input type="checkbox" id="qltCfgUseInMemoryDb" /> Use In-Memory Database</label>
                        <p class="text-muted" style="margin-top:4px;">Keeps logs in memory only - much faster, but every log is lost on restart. The database path/connection string below are ignored while this is on.</p>
                    </div>
                    <div style="margin-bottom:8px;" id="qltDbPathGroup">
                        <label>Database File Path<br/>
                            <input type="text" class="form-control" id="qltCfgSqliteDbPath" style="max-width:300px;" />
                        </label>
                        <p class="text-muted" style="margin-top:4px;">Relative paths resolve under the app's own folder on the DNS server.</p>
                    </div>
                    <div id="qltConnStrGroup">
                        <label>Connection String<br/>
                            <input type="text" class="form-control" id="qltCfgConnectionString" />
                        </label>
                        <p class="text-muted" style="margin-top:4px;">Must keep the <code>{sqliteDbPath}</code> token - it's replaced with the database file path above. Only change this for advanced SQLite connection options.</p>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnQltConfigSave").addEventListener("click", save);
        document.getElementById("btnQltConfigDiscard").addEventListener("click", discard);

        document.getElementById("qltCfgEnable").checked = config.enableLogging;
        document.getElementById("qltCfgEnable").addEventListener("change", (e) => { config.enableLogging = e.target.checked; markDirty(); });

        const queueInput = document.getElementById("qltCfgMaxQueueSize");
        queueInput.value = config.maxQueueSize;
        queueInput.addEventListener("input", () => {
            const value = parseInt(queueInput.value, 10);
            config.maxQueueSize = (Number.isNaN(value) || value < 1) ? 200000 : value;
            markDirty();
        });

        const daysInput = document.getElementById("qltCfgMaxLogDays");
        daysInput.value = config.maxLogDays;
        daysInput.addEventListener("input", () => {
            const value = parseInt(daysInput.value, 10);
            config.maxLogDays = (Number.isNaN(value) || value < 0) ? 0 : value;
            markDirty();
        });

        const recordsInput = document.getElementById("qltCfgMaxLogRecords");
        recordsInput.value = config.maxLogRecords;
        recordsInput.addEventListener("input", () => {
            const value = parseInt(recordsInput.value, 10);
            config.maxLogRecords = (Number.isNaN(value) || value < 0) ? 0 : value;
            markDirty();
        });

        document.getElementById("qltCfgEnableVacuum").checked = config.enableVacuum;
        document.getElementById("qltCfgEnableVacuum").addEventListener("change", (e) => { config.enableVacuum = e.target.checked; markDirty(); });

        document.getElementById("qltCfgUseInMemoryDb").checked = config.useInMemoryDb;
        document.getElementById("qltCfgUseInMemoryDb").addEventListener("change", (e) => {
            config.useInMemoryDb = e.target.checked;
            updateStorageFieldsEnabled();
            markDirty();
        });

        const dbPathInput = document.getElementById("qltCfgSqliteDbPath");
        dbPathInput.value = config.sqliteDbPath;
        dbPathInput.addEventListener("input", () => { config.sqliteDbPath = dbPathInput.value; markDirty(); });

        const connStrInput = document.getElementById("qltCfgConnectionString");
        connStrInput.value = config.connectionString;
        connStrInput.addEventListener("input", () => { config.connectionString = connStrInput.value; markDirty(); });

        updateStorageFieldsEnabled();
    }

    function updateStorageFieldsEnabled() {
        const disabled = config.useInMemoryDb;
        document.getElementById("qltCfgSqliteDbPath").disabled = disabled;
        document.getElementById("qltCfgConnectionString").disabled = disabled;
        document.getElementById("qltDbPathGroup").style.opacity = disabled ? "0.5" : "1";
        document.getElementById("qltConnStrGroup").style.opacity = disabled ? "0.5" : "1";
    }

    initSubTabs();
})();
