(function () {
    "use strict";

    const KNOWN_APP_TAB_LIST_IDS = {
        "Advanced Blocking": "mainTabListAdvancedBlocking",
        "Advanced Forwarding": "mainTabListAdvancedForwarding",
        "Split Horizon": "mainTabListSplitHorizon",
        "Block Page": "mainTabListBlockPage",
        "Default Records": "mainTabListDefaultRecords",
        "DNS Block List (DNSBL)": "mainTabListDnsBlockList",
        "DNS Rebinding Protection": "mainTabListDnsRebindingProtection",
        "Auto PTR": "mainTabListAutoPtr",
        "DNS64": "mainTabListDns64",
        "Drop Requests": "mainTabListDropRequests",
        "Filter AAAA": "mainTabListFilterAaaa",
        "Geo Continent": "mainTabListGeoContinent",
        "Geo Country": "mainTabListGeoCountry",
        "Geo Distance": "mainTabListGeoDistance",
        "Failover": "mainTabListFailover",
        "Log Exporter": "mainTabListLogExporter",
        "NO DATA": "mainTabListNoData",
        "NX Domain": "mainTabListNxDomain",
        "NX Domain Override": "mainTabListNxDomainOverride",
        "Query Logs (MySQL)": "mainTabListQueryLogsMySql",
        "Query Logs (PostgreSQL)": "mainTabListQueryLogsPostgreSql",
        "Query Logs (SQL Server)": "mainTabListQueryLogsSqlServer",
        "Query Logs (Sqlite)": "mainTabListQueryLogsSqlite",
        "Weighted Round Robin": "mainTabListWeightedRoundRobin",
        "What Is My Dns": "mainTabListWhatIsMyDns",
        "Wild IP": "mainTabListWildIp",
        "Zone Alias": "mainTabListZoneAlias"
    };

    const navTabs = document.querySelector("#content > .container > .nav-tabs");
    const tabContent = document.querySelector("#content > .container > .tab-content");
    const appStoreTabListEl = document.getElementById("mainTabListAppStore");
    const appStorePaneEl = document.getElementById("mainTabPaneAppStore");

    const dynamicTabs = new Map();

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function slugify(name) {
        return "dyn-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }

    async function refresh() {
        let apps;
        try {
            const res = await apiFetch("/api/appstore/installed");
            const data = await res.json();
            if (!data.success) return;
            apps = data.apps || [];
        } catch {
            return;
        }

        const installedNames = new Set(apps.map((a) => a.name));

        for (const app of apps) {
            let li;

            if (app.name in KNOWN_APP_TAB_LIST_IDS) {
                li = document.getElementById(KNOWN_APP_TAB_LIST_IDS[app.name]);
                li.style.display = "";
            } else {
                if (!dynamicTabs.has(app.name))
                    addDynamicTab(app.name);
                li = dynamicTabs.get(app.name).liEl;
            }

            navTabs.insertBefore(li, appStoreTabListEl);
        }

        for (const [appName, tabListId] of Object.entries(KNOWN_APP_TAB_LIST_IDS)) {
            if (installedNames.has(appName))
                continue;

            const li = document.getElementById(tabListId);
            const wasActive = li.classList.contains("active");

            li.style.display = "none";

            if (wasActive)
                window.mainTabs.switchTab("dashboard");
        }

        for (const [appName, entry] of dynamicTabs) {
            if (installedNames.has(appName))
                continue;

            const wasActive = entry.liEl.classList.contains("active");

            entry.liEl.remove();
            entry.paneEl.remove();
            window.mainTabs.unregisterPane(entry.key);
            dynamicTabs.delete(appName);

            if (wasActive)
                window.mainTabs.switchTab("dashboard");
        }
    }

    function addDynamicTab(appName) {
        const key = slugify(appName);
        const listId = "mainTabList-" + key;
        const paneId = "mainTabPane-" + key;
        const subPaneId = paneId + "-config";

        const li = document.createElement("li");
        li.id = listId;
        li.setAttribute("role", "presentation");
        li.innerHTML = `<a href="#${paneId}" data-tab="${key}">${escapeHtml(appName)}</a>`;
        navTabs.insertBefore(li, appStoreTabListEl);

        const pane = document.createElement("div");
        pane.id = paneId;
        pane.className = "tab-pane";
        pane.style.paddingTop = "15px";
        pane.innerHTML = `
            <ul class="nav nav-tabs" role="tablist">
                <li role="presentation" class="active"><a href="#${subPaneId}" data-subtab="config">Config</a></li>
            </ul>

            <div class="tab-content">
                <div id="${subPaneId}" class="tab-pane active" style="padding-top: 15px;">
                    <div class="panel panel-default">
                        <div class="panel-body">
                            <div class="group-row">
                                <div><span class="dyn-dirty-badge label label-warning" style="display:none;">Unsaved changes</span></div>
                                <div>
                                    <button class="btn btn-default btn-sm dyn-discard">Discard</button>
                                    <button class="btn btn-primary btn-sm dyn-save">Save Changes</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="panel panel-default">
                        <div class="panel-heading"><h3 class="panel-title">${escapeHtml(appName)} Config</h3></div>
                        <div class="panel-body">
                            <p class="text-muted">This app doesn't have a dedicated editor yet, so this is its raw config text - same as what the official Technitium console shows for it.</p>
                            <textarea class="form-control dyn-config-textarea" rows="20" style="font-family: monospace; font-size: 12px;">Loading&hellip;</textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;
        tabContent.insertBefore(pane, appStorePaneEl);

        function switchSubTab() {
            pane.querySelectorAll(".nav-tabs > li").forEach((subLi) => subLi.classList.remove("active"));
            pane.querySelectorAll(".tab-content > .tab-pane").forEach((subPane) => subPane.classList.remove("active"));
            pane.querySelector('.nav-tabs a[data-subtab="config"]').closest("li").classList.add("active");
            document.getElementById(subPaneId).classList.add("active");
        }

        pane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab();
            });
        });

        const entry = { liEl: li, paneEl: pane, key, loaded: false, dirty: false, originalConfig: "" };
        dynamicTabs.set(appName, entry);

        window.mainTabs.registerPane(key, paneId);
        window.mainTabs.wireTabLink(li.querySelector("a"));

        const textarea = pane.querySelector(".dyn-config-textarea");
        const dirtyBadge = pane.querySelector(".dyn-dirty-badge");
        const saveBtn = pane.querySelector(".dyn-save");
        const discardBtn = pane.querySelector(".dyn-discard");

        function markDirty() {
            entry.dirty = true;
            dirtyBadge.style.display = "";
        }

        function clearDirty() {
            entry.dirty = false;
            dirtyBadge.style.display = "none";
        }

        async function load() {
            textarea.value = "Loading…";
            textarea.disabled = true;
            try {
                const res = await apiFetch("/api/apps/config/raw?name=" + encodeURIComponent(appName));
                const data = await res.json();
                if (!data.success) {
                    textarea.value = "Failed to load config: " + (data.error || "unknown error");
                    return;
                }
                entry.originalConfig = data.config || "";
                textarea.value = entry.originalConfig;
                clearDirty();
            } catch (err) {
                textarea.value = "Failed to load config: " + err.message;
            } finally {
                textarea.disabled = false;
            }
        }

        textarea.addEventListener("input", markDirty);

        discardBtn.addEventListener("click", async () => {
            if (entry.dirty && !(await uiConfirm("Discard unsaved changes?"))) return;
            load();
        });

        saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true;
            try {
                const res = await apiFetch("/api/apps/config/raw", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: appName, config: textarea.value })
                });
                const data = await res.json();
                if (!data.success) {
                    await uiAlert("Failed to save config: " + (data.error || "unknown error"));
                    return;
                }
                entry.originalConfig = textarea.value;
                clearDirty();
            } catch (err) {
                await uiAlert("Failed to save config: " + err.message);
            } finally {
                saveBtn.disabled = false;
            }
        });

        document.addEventListener("tabchange", (e) => {
            if (e.detail.tab !== key) return;

            switchSubTab();

            if (entry.loaded) return;
            entry.loaded = true;
            load();
        });
    }

    window.refreshInstalledAppTabs = refresh;

    document.addEventListener("authenticated", refresh);
    refresh();
})();
