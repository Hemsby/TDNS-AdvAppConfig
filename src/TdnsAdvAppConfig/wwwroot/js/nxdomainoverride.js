(function () {
    "use strict";

    const nxoPane = document.getElementById("mainTabPaneNxDomainOverride");
    const root = document.getElementById("nxDomainOverrideConfigRoot");

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
        const badge = document.getElementById("nxoConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("nxoConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function setNames() {
        return config.sets.map((s) => s.name).filter((n) => typeof n === "string" && n !== "");
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.enableOverride !== "boolean") raw.enableOverride = true;
        if (typeof raw.defaultTtl !== "number") raw.defaultTtl = 300;
        if (typeof raw.domainSetMap !== "object" || raw.domainSetMap === null) raw.domainSetMap = {};
        if (!Array.isArray(raw.sets)) raw.sets = [];

        raw.sets.forEach((s) => {
            if (!Array.isArray(s.addresses)) s.addresses = [];
        });

        Object.keys(raw.domainSetMap).forEach((key) => {
            if (!Array.isArray(raw.domainSetMap[key])) raw.domainSetMap[key] = [];
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/nxdomainoverride/config/raw");
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
            const res = await apiFetch("/api/nxdomainoverride/config/raw", {
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
        nxoPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        nxoPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        nxoPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        nxoPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("nxoTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "nxdomainoverride") return;
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
                        <div><span id="nxoConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnNxoConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnNxoConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="nxoEnableOverride" /> Enable Override</label></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Default TTL (seconds)</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="nxoDefaultTtl" min="0" /></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Address Sets</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Named groups of IP addresses, referenced by name from Domain Mappings below.</p>
                    <div id="nxoSetsContainer"></div>
                    <button id="btnNxoAddSet" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Set</button>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Domain Mappings</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Maps a domain (or "*" as a catch-all) to one or more sets above. A query that would otherwise get NXDOMAIN returns these addresses instead. More specific domains are matched before "*".</p>
                    <div id="nxoDomainMapContainer"></div>
                    <button id="btnNxoAddDomainMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Domain Mapping</button>
                </div>
            </div>
        `;

        document.getElementById("btnNxoConfigSave").addEventListener("click", save);
        document.getElementById("btnNxoConfigDiscard").addEventListener("click", discard);
        document.getElementById("btnNxoAddSet").addEventListener("click", addSet);
        document.getElementById("btnNxoAddDomainMap").addEventListener("click", addDomainMapping);

        document.getElementById("nxoEnableOverride").checked = config.enableOverride;
        document.getElementById("nxoEnableOverride").addEventListener("change", (e) => { config.enableOverride = e.target.checked; markDirty(); });

        const ttlInput = document.getElementById("nxoDefaultTtl");
        ttlInput.value = config.defaultTtl;
        ttlInput.addEventListener("input", (e) => { config.defaultTtl = parseInt(e.target.value, 10) || 0; markDirty(); });

        renderSets();
        renderDomainMap();
    }

    function renderSets() {
        const container = document.getElementById("nxoSetsContainer");

        if (config.sets.length === 0) {
            container.innerHTML = '<p class="text-muted">No sets configured.</p>';
            return;
        }

        container.innerHTML = config.sets.map((s, idx) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm set-name" data-index="${idx}" value="${escapeHtml(s.name || "")}" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs set-remove" data-index="${idx}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="nxoSetAddr-${idx}"></div>
        </div>`).join("");

        config.sets.forEach((s, idx) => {
            AppHelpers.renderStringList(`nxoSetAddr-${idx}`, s.addresses, "e.g. 192.168.10.1", markDirty);
        });

        container.querySelectorAll(".set-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const idx = parseInt(inp.getAttribute("data-index"), 10);
                const newName = inp.value.trim();
                const oldName = config.sets[idx].name;

                if (newName === "") { inp.value = oldName; return; }
                if (newName === oldName) return;

                if (setNames().some((n, i) => i !== idx && n === newName)) {
                    await uiAlert(`A set called "${newName}" already exists.`);
                    inp.value = oldName;
                    return;
                }

                config.sets[idx].name = newName;
                markDirty();
            });
        });

        container.querySelectorAll(".set-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                const name = config.sets[idx].name;

                if (!(await uiConfirm(`Delete set "${name}"? Any Domain Mapping still referencing it by name will simply skip it.`))) return;

                config.sets.splice(idx, 1);
                markDirty();
                renderSets();
                renderDomainMap();
            });
        });
    }

    async function addSet() {
        let name = await uiPrompt("New set name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (setNames().includes(name)) {
            await uiAlert(`A set called "${name}" already exists.`);
            return;
        }

        config.sets.push({ name, addresses: [] });
        markDirty();
        renderSets();
    }

    function renderDomainMap() {
        const container = document.getElementById("nxoDomainMapContainer");
        const domains = Object.keys(config.domainSetMap);

        if (domains.length === 0) {
            container.innerHTML = '<p class="text-muted">No domain mappings configured.</p>';
            return;
        }

        container.innerHTML = domains.map((domain) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm domain-key" data-orig-key="${escapeHtml(domain)}" value="${escapeHtml(domain)}" placeholder="* or example.com or *.example.com" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs domain-remove" data-key="${escapeHtml(domain)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="nxoDomainSets-${escapeHtml(domain)}"></div>
        </div>`).join("");

        domains.forEach((domain) => renderDomainSetBadges(domain));

        container.querySelectorAll(".domain-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(config.domainSetMap, newKey)) {
                    await uiAlert(`A mapping for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                config.domainSetMap[newKey] = config.domainSetMap[oldKey];
                delete config.domainSetMap[oldKey];
                markDirty();
                renderDomainMap();
            });
        });

        container.querySelectorAll(".domain-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete config.domainSetMap[btn.getAttribute("data-key")];
                markDirty();
                renderDomainMap();
            });
        });
    }

    function renderDomainSetBadges(domain) {
        AppHelpers.renderBadgePicker(`nxoDomainSets-${domain}`, config.domainSetMap[domain], setNames, markDirty, {
            emptyText: "No sets assigned yet.",
            noOptionsText: "Add a set above first."
        });
    }

    async function addDomainMapping() {
        if (setNames().length === 0) {
            await uiAlert("Add an address set first.");
            return;
        }

        let key = await uiPrompt('Domain name (e.g. example.com), "*.example.com" for subdomains, or "*" for a catch-all:');
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(config.domainSetMap, key)) {
            await uiAlert(`A mapping for "${key}" already exists.`);
            return;
        }

        config.domainSetMap[key] = [];
        markDirty();
        renderDomainMap();
    }

    initSubTabs();
})();
