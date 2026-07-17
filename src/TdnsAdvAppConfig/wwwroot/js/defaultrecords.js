(function () {
    "use strict";

    const drPane = document.getElementById("mainTabPaneDefaultRecords");
    const root = document.getElementById("defaultRecordsConfigRoot");

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
        const badge = document.getElementById("drConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("drConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function setNames() {
        return config.sets.map((s) => s.name);
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.enableDefaultRecords !== "boolean") raw.enableDefaultRecords = false;
        if (typeof raw.defaultTtl !== "number") raw.defaultTtl = 3600;
        if (!Array.isArray(raw.sets)) raw.sets = [];
        if (typeof raw.zoneSetMap !== "object" || raw.zoneSetMap === null) raw.zoneSetMap = {};

        raw.sets.forEach((s) => {
            if (typeof s.enable !== "boolean") s.enable = true;
            if (!Array.isArray(s.records)) s.records = [];
        });

        Object.keys(raw.zoneSetMap).forEach((key) => {
            if (!Array.isArray(raw.zoneSetMap[key])) raw.zoneSetMap[key] = [];
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/defaultrecords/config/raw");
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
            const res = await apiFetch("/api/defaultrecords/config/raw", {
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
        drPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        drPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        drPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        drPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("drTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "defaultrecords") return;
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
                        <div><span id="drConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnDrConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnDrConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-12">
                                <label><input type="checkbox" id="drCfgEnable" /> Enable Default Records</label>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-4 control-label">Default TTL</label>
                            <div class="col-sm-8"><input type="number" class="form-control" id="drCfgDefaultTtl" min="0" /></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Sets</h3></div>
                <div class="panel-body">
                    <p class="text-muted">A set is a named group of DNS records (zone-file syntax, e.g. <code>@ 3600 IN A 1.2.3.4</code>) that gets added to a zone's answers when mapped to it below.</p>
                    <div id="drSetsContainer"></div>
                    <button id="btnDrAddSet" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Set</button>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Zone Set Map</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Maps a zone to the set(s) applied to it. An exact name (e.g. <code>example.org</code>) matches only that literal domain. <code>*.example.org</code> matches any subdomain underneath it, but not the domain itself. <code>*</code> is a catch-all matching every zone, including bare apexes.</p>
                    <div id="drZoneMapContainer"></div>
                    <button id="btnDrAddZoneMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Zone Mapping</button>
                </div>
            </div>
        `;

        document.getElementById("btnDrConfigSave").addEventListener("click", save);
        document.getElementById("btnDrConfigDiscard").addEventListener("click", discard);

        document.getElementById("drCfgEnable").checked = config.enableDefaultRecords;
        document.getElementById("drCfgEnable").addEventListener("change", (e) => { config.enableDefaultRecords = e.target.checked; markDirty(); });

        document.getElementById("drCfgDefaultTtl").value = config.defaultTtl;
        document.getElementById("drCfgDefaultTtl").addEventListener("input", (e) => { config.defaultTtl = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("btnDrAddSet").addEventListener("click", addSet);
        document.getElementById("btnDrAddZoneMap").addEventListener("click", addZoneMapping);

        renderSets();
        renderZoneMap();
    }

    function renderSets() {
        const container = document.getElementById("drSetsContainer");

        if (config.sets.length === 0) {
            container.innerHTML = '<p class="text-muted">No sets configured.</p>';
            return;
        }

        container.innerHTML = config.sets.map((s, idx) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm set-name" data-index="${idx}" value="${escapeHtml(s.name)}" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs set-remove" data-index="${idx}"><span class="fa fa-trash"></span></button>
            </div>
            <div style="margin-bottom:8px;">
                <label style="font-weight:normal;"><input type="checkbox" class="set-enable" data-index="${idx}" ${s.enable ? "checked" : ""} /> Enabled</label>
            </div>
            <div>
                <label style="font-weight:normal;">Records</label>
                <div id="drSetRecords-${idx}"></div>
            </div>
        </div>`).join("");

        config.sets.forEach((s, idx) => {
            AppHelpers.renderStringList(`drSetRecords-${idx}`, s.records, "@ 3600 IN A 1.2.3.4", markDirty);
        });

        container.querySelectorAll(".set-enable").forEach((chk) => {
            chk.addEventListener("change", () => { config.sets[parseInt(chk.getAttribute("data-index"), 10)].enable = chk.checked; markDirty(); });
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
                Object.keys(config.zoneSetMap).forEach((zone) => {
                    const setsForZone = config.zoneSetMap[zone];
                    const i = setsForZone.indexOf(oldName);
                    if (i !== -1) setsForZone[i] = newName;
                });
                markDirty();
                renderZoneMap();
            });
        });

        container.querySelectorAll(".set-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                const name = config.sets[idx].name;

                const affectedZones = Object.keys(config.zoneSetMap).filter((zone) => config.zoneSetMap[zone].includes(name));

                let msg = `Delete set "${name}"?`;
                if (affectedZones.length > 0)
                    msg = `Delete set "${name}"? It's mapped from ${affectedZones.length} zone(s) (${affectedZones.join(", ")}) - those mappings will be updated to no longer reference it.`;

                if (!(await uiConfirm(msg))) return;

                affectedZones.forEach((zone) => {
                    config.zoneSetMap[zone] = config.zoneSetMap[zone].filter((n) => n !== name);
                });

                config.sets.splice(idx, 1);
                markDirty();
                renderSets();
                renderZoneMap();
            });
        });
    }

    async function addSet() {
        let name = await uiPrompt("Set name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (setNames().includes(name)) {
            await uiAlert(`A set called "${name}" already exists.`);
            return;
        }

        config.sets.push({ name, enable: true, records: [] });
        markDirty();
        renderSets();
    }

    function renderZoneMap() {
        const container = document.getElementById("drZoneMapContainer");
        const zones = Object.keys(config.zoneSetMap);

        if (zones.length === 0) {
            container.innerHTML = '<p class="text-muted">No zone mappings configured.</p>';
            return;
        }

        container.innerHTML = zones.map((zone) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm zone-key" data-orig-key="${escapeHtml(zone)}" value="${escapeHtml(zone)}" placeholder="example.org or *.example.org or *" style="flex:1; margin-right:8px;" />
                <button class="btn btn-danger btn-xs zone-remove" data-key="${escapeHtml(zone)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="drZoneSets-${escapeHtml(zone)}"></div>
        </div>`).join("");

        zones.forEach((zone) => {
            AppHelpers.renderBadgePicker(`drZoneSets-${zone}`, config.zoneSetMap[zone], setNames, markDirty, {
                emptyText: "No sets assigned yet.",
                noOptionsText: "Create a set above before mapping this zone to one."
            });
        });

        container.querySelectorAll(".zone-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete config.zoneSetMap[btn.getAttribute("data-key")];
                markDirty();
                renderZoneMap();
            });
        });

        container.querySelectorAll(".zone-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim().toLowerCase();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(config.zoneSetMap, newKey)) {
                    await uiAlert(`A mapping for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                config.zoneSetMap[newKey] = config.zoneSetMap[oldKey];
                delete config.zoneSetMap[oldKey];
                markDirty();
                renderZoneMap();
            });
        });
    }

    async function addZoneMapping() {
        let key = await uiPrompt("Zone (e.g. example.org, *.example.org, or * for every zone):");
        if (!key) return;
        key = key.trim().toLowerCase();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(config.zoneSetMap, key)) {
            await uiAlert("That zone is already mapped.");
            return;
        }

        config.zoneSetMap[key] = [];
        markDirty();
        renderZoneMap();
    }

    initSubTabs();
})();
