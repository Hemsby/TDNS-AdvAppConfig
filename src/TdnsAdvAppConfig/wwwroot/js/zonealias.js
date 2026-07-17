(function () {
    "use strict";

    const zaPane = document.getElementById("mainTabPaneZoneAlias");
    const root = document.getElementById("zoneAliasConfigRoot");

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
        const badge = document.getElementById("zaConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("zaConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.appPreference !== "number") raw.appPreference = 10;
        if (typeof raw.enableAliasing !== "boolean") raw.enableAliasing = true;
        if (typeof raw.zoneAliases !== "object" || raw.zoneAliases === null) raw.zoneAliases = {};

        Object.keys(raw.zoneAliases).forEach((key) => {
            if (!Array.isArray(raw.zoneAliases[key])) raw.zoneAliases[key] = [];
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/zonealias/config/raw");
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
        Object.keys(config.zoneAliases).forEach((zone) => {
            config.zoneAliases[zone] = config.zoneAliases[zone].map((a) => (a || "").trim().toLowerCase()).filter((a) => a !== "");
        });

        const seen = new Map();
        let conflict = null;

        Object.keys(config.zoneAliases).some((zone) => config.zoneAliases[zone].some((alias) => {
            if (seen.has(alias)) {
                conflict = { alias, zoneA: seen.get(alias), zoneB: zone };
                return true;
            }
            seen.set(alias, zone);
            return false;
        }));

        if (conflict) {
            const where = conflict.zoneA === conflict.zoneB
                ? `listed more than once under "${escapeHtml(conflict.zoneA)}"`
                : `used under both "${escapeHtml(conflict.zoneA)}" and "${escapeHtml(conflict.zoneB)}"`;
            await uiAlert(`Alias "${escapeHtml(conflict.alias)}" is ${where} - the app fails to reload with any repeated alias. Remove the repeat before saving.`);
            return;
        }

        try {
            const res = await apiFetch("/api/zonealias/config/raw", {
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
            renderRoot();
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
        zaPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        zaPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        zaPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        zaPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("zaTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "zonealias") return;
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
                        <div><span id="zaConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnZaConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnZaConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="zaEnableAliasing" /> Enable Aliasing</label></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">App Preference</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="zaAppPreference" min="0" max="255" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">Execution order relative to other apps - lower runs earlier. Leave at the default unless you know you need to change it.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Zone Aliases</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Each primary zone below returns identical records for every alias domain listed under it - queries to an alias (or any of its subdomains) are answered as if they'd been sent to the primary zone, with the zone name swapped back into the response. An alias may only be used once across this entire config, even under a different primary zone.</p>
                    <div id="zaZoneMapContainer"></div>
                    <button id="btnZaAddZone" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Primary Zone</button>
                </div>
            </div>
        `;

        document.getElementById("btnZaConfigSave").addEventListener("click", save);
        document.getElementById("btnZaConfigDiscard").addEventListener("click", discard);

        document.getElementById("zaEnableAliasing").checked = config.enableAliasing;
        document.getElementById("zaEnableAliasing").addEventListener("change", (e) => { config.enableAliasing = e.target.checked; markDirty(); });

        const preferenceInput = document.getElementById("zaAppPreference");
        preferenceInput.value = config.appPreference;
        preferenceInput.addEventListener("input", (e) => { config.appPreference = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("btnZaAddZone").addEventListener("click", addZoneMapping);

        renderZoneMap();
    }

    function renderZoneMap() {
        const container = document.getElementById("zaZoneMapContainer");
        const zones = Object.keys(config.zoneAliases);

        if (zones.length === 0) {
            container.innerHTML = '<p class="text-muted">No zone aliases configured.</p>';
            return;
        }

        container.innerHTML = zones.map((zone) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm zone-key" data-orig-key="${escapeHtml(zone)}" value="${escapeHtml(zone)}" placeholder="e.g. example.com" style="flex:1; margin-right:8px;" />
                <button class="btn btn-danger btn-xs zone-remove" data-key="${escapeHtml(zone)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="zaZoneAliases-${escapeHtml(zone)}"></div>
        </div>`).join("");

        zones.forEach((zone) => {
            AppHelpers.renderStringList(`zaZoneAliases-${zone}`, config.zoneAliases[zone], "e.g. example.net", markDirty);
        });

        container.querySelectorAll(".zone-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete config.zoneAliases[btn.getAttribute("data-key")];
                markDirty();
                renderZoneMap();
            });
        });

        container.querySelectorAll(".zone-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(config.zoneAliases, newKey)) {
                    await uiAlert(`A zone entry for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                config.zoneAliases[newKey] = config.zoneAliases[oldKey];
                delete config.zoneAliases[oldKey];
                markDirty();
                renderZoneMap();
            });
        });
    }

    async function addZoneMapping() {
        const key = await uiPrompt("Primary zone (e.g. example.com):");
        if (!key) return;
        const trimmedKey = key.trim();
        if (!trimmedKey) return;

        if (Object.prototype.hasOwnProperty.call(config.zoneAliases, trimmedKey)) {
            await uiAlert("That zone already has an entry.");
            return;
        }

        config.zoneAliases[trimmedKey] = [];
        markDirty();
        renderZoneMap();
    }

    initSubTabs();
})();
