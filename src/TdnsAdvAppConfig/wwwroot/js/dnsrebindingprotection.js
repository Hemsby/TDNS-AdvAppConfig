(function () {
    "use strict";

    const drpPane = document.getElementById("mainTabPaneDnsRebindingProtection");
    const root = document.getElementById("dnsRebindingProtectionConfigRoot");

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
        const badge = document.getElementById("drpConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("drpConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.enableProtection !== "boolean") raw.enableProtection = true;
        if (!Array.isArray(raw.bypassNetworks)) raw.bypassNetworks = [];
        if (!Array.isArray(raw.privateNetworks)) raw.privateNetworks = [];
        if (!Array.isArray(raw.privateDomains)) raw.privateDomains = [];

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/dnsrebindingprotection/config/raw");
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
            const res = await apiFetch("/api/dnsrebindingprotection/config/raw", {
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
        drpPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        drpPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        drpPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        drpPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("drpTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "dnsrebindingprotection") return;
        switchSubTab(currentSubTab);
    });

    document.addEventListener("authenticated", () => {
        if (loaded && !dirty) load();
    });

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="group-row">
                        <div><span id="drpConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnDrpConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnDrpConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Strips private/loopback/link-local addresses from a resolver response for a domain that isn't hosted locally, blocking DNS rebinding attacks. Authoritative answers (your own zones) are never filtered.</p>
                    <label><input type="checkbox" id="drpCfgEnable" /> Enable Protection</label>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Private Networks</h3></div>
                <div class="panel-body">
                    <p class="text-muted">A resolved A/AAAA address falling inside any of these ranges is treated as a rebinding attempt and stripped from the answer.</p>
                    <div id="drpPrivateNetworksContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Private Domains</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Domains (and their subdomains) exempt from filtering - use this for names that legitimately resolve to a private address, like <code>home.arpa</code>.</p>
                    <div id="drpPrivateDomainsContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Bypass Networks</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Client source networks exempt from protection entirely - queries from these networks are never filtered, regardless of what address comes back.</p>
                    <div id="drpBypassNetworksContainer"></div>
                </div>
            </div>
        `;

        document.getElementById("btnDrpConfigSave").addEventListener("click", save);
        document.getElementById("btnDrpConfigDiscard").addEventListener("click", discard);

        document.getElementById("drpCfgEnable").checked = config.enableProtection;
        document.getElementById("drpCfgEnable").addEventListener("change", (e) => { config.enableProtection = e.target.checked; markDirty(); });

        AppHelpers.renderStringList("drpPrivateNetworksContainer", config.privateNetworks, "e.g. 10.0.0.0/8 or 192.168.1.1", markDirty);
        AppHelpers.renderStringList("drpPrivateDomainsContainer", config.privateDomains, "e.g. home.arpa", markDirty);
        AppHelpers.renderStringList("drpBypassNetworksContainer", config.bypassNetworks, "e.g. 192.168.1.0/24", markDirty);
    }

    initSubTabs();
})();
