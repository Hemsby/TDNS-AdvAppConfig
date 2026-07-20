(function () {
    "use strict";

    const faaPane = document.getElementById("mainTabPaneFilterAaaa");
    const root = document.getElementById("filterAaaaConfigRoot");

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
        const badge = document.getElementById("faaConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("faaConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.enableFilterAaaa !== "boolean") raw.enableFilterAaaa = false;
        if (typeof raw.defaultTtl !== "number") raw.defaultTtl = 30;
        if (typeof raw.bypassLocalZones !== "boolean") raw.bypassLocalZones = false;
        if (!Array.isArray(raw.bypassNetworks)) raw.bypassNetworks = [];
        if (!Array.isArray(raw.bypassDomains)) raw.bypassDomains = [];
        if (!Array.isArray(raw.filterDomains)) raw.filterDomains = [];

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/filteraaaa/config/raw");
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
            const res = await apiFetch("/api/filteraaaa/config/raw", {
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
        faaPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        faaPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        faaPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        faaPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("faaTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "filteraaaa") return;
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
                        <div><span id="faaConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnFaaConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnFaaConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Returns NO DATA for an AAAA query when the same domain also has an A record, so IPv4-preferring behavior can be forced even when a client asks for IPv6 first.</p>
                    <div style="margin-bottom:8px;">
                        <label><input type="checkbox" id="faaCfgEnable" /> Enable Filtering</label>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label><input type="checkbox" id="faaCfgBypassLocalZones" /> Bypass Local Zones (never filter authoritative answers)</label>
                    </div>
                    <div>
                        <label>SOA TTL for NO DATA responses<br/>
                            <input type="number" class="form-control" id="faaCfgDefaultTtl" min="0" step="1" style="max-width:150px;" />
                        </label>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Bypass Networks</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Client source networks exempt from filtering entirely - queries from these networks always get the real AAAA answer.</p>
                    <div id="faaBypassNetworksContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Bypass Domains</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Domains (and their subdomains) exempt from filtering, regardless of Filter Domains below.</p>
                    <div id="faaBypassDomainsContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Filter Domains</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Domains (and their subdomains) eligible for filtering. Leave empty to filter every domain not covered by Bypass Domains above.</p>
                    <div id="faaFilterDomainsContainer"></div>
                </div>
            </div>
        `;

        document.getElementById("btnFaaConfigSave").addEventListener("click", save);
        document.getElementById("btnFaaConfigDiscard").addEventListener("click", discard);

        document.getElementById("faaCfgEnable").checked = config.enableFilterAaaa;
        document.getElementById("faaCfgEnable").addEventListener("change", (e) => { config.enableFilterAaaa = e.target.checked; markDirty(); });

        document.getElementById("faaCfgBypassLocalZones").checked = config.bypassLocalZones;
        document.getElementById("faaCfgBypassLocalZones").addEventListener("change", (e) => { config.bypassLocalZones = e.target.checked; markDirty(); });

        const ttlInput = document.getElementById("faaCfgDefaultTtl");
        ttlInput.value = config.defaultTtl;
        ttlInput.addEventListener("input", () => {
            const value = parseInt(ttlInput.value, 10);
            config.defaultTtl = (Number.isNaN(value) || value < 0) ? 30 : value;
            markDirty();
        });

        AppHelpers.renderStringList("faaBypassNetworksContainer", config.bypassNetworks, "e.g. 10.0.0.0/8 or 192.168.1.1", markDirty);
        AppHelpers.renderStringList("faaBypassDomainsContainer", config.bypassDomains, "e.g. ipv6.example.com", markDirty);
        AppHelpers.renderStringList("faaFilterDomainsContainer", config.filterDomains, "e.g. example.com", markDirty);
    }

    initSubTabs();
})();
