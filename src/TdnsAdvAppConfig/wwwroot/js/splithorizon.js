(function () {
    "use strict";

    const shPane = document.getElementById("mainTabPaneSplitHorizon");
    const root = document.getElementById("splitHorizonConfigRoot");
    const recordsRoot = document.getElementById("splitHorizonRecordsRoot");

    let config = null;      // working copy, mutated directly by the form
    let loaded = false;
    let dirty = false;
    let currentGroupIndex = -1;
    let currentSubTab = "appconfig";

    // App Records state. Unlike App Config there's no batched "dirty" concept -
    // each add/edit/delete is its own immediate server round-trip, matching
    // Technitium's own zone records console.
    let records = [];
    let zones = [];
    let recordsLoaded = false;
    let editingIndex = -1;    // -1 = adding a new record
    let editBuffer = null;    // { domain, zone, classPath, ttl, data }
    let editOriginalDomain = null;
    let editOriginalZone = null;

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ---- App Config / App Records sub-tabs ----
    // Scoped to shPane throughout: app.js's top-level switchTab() also toggles
    // .active on any element matching ".nav-tabs > li" / ".tab-content > .tab-pane"
    // (unscoped, since it doesn't know about nested tab widgets), so this reuses
    // those same classes for visual styling but must never touch the outer
    // Dashboard/Config nav when switching sub-tabs here.

    function initSubTabs() {
        shPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        shPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        shPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        shPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "appconfig" ? "shTabPaneAppConfig" : "shTabPaneAppRecords").classList.add("active");

        if (subtab === "appconfig") onConfigTabActivated();
        else if (subtab === "apprecords") onRecordsTabActivated();
    }

    // ---- load/save ----

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("shConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("shConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function groupNames() {
        return config.groups.map((g) => g.name);
    }

    // The server may return a config document missing keys that were never
    // saved (a fresh Split Horizon install, or one only using the APP record
    // feature and never touching address translation). Default them so the
    // form always has something to bind to.
    function normalizeConfig(raw) {
        return {
            appPreference: typeof raw.appPreference === "number" ? raw.appPreference : 40,
            enableAddressTranslation: !!raw.enableAddressTranslation,
            networks: raw.networks && typeof raw.networks === "object" ? raw.networks : {},
            domainGroupMap: raw.domainGroupMap && typeof raw.domainGroupMap === "object" ? raw.domainGroupMap : {},
            networkGroupMap: raw.networkGroupMap && typeof raw.networkGroupMap === "object" ? raw.networkGroupMap : {},
            groups: Array.isArray(raw.groups) ? raw.groups : []
        };
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/splithorizon/config/raw");
            const data = await res.json();
            if (!data.success) {
                root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            config = normalizeConfig(data.config || {});
            currentGroupIndex = -1;
            clearDirty();
            renderRoot();
        } catch (err) {
            root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(err.message)}</p>`;
        }
    }

    async function save() {
        try {
            const res = await apiFetch("/api/splithorizon/config/raw", {
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

        // Pick up changes made outside this session, but don't clobber
        // in-progress edits here.
        if (!dirty) load();
    }

    window.addEventListener("beforeunload", (e) => {
        if (dirty) {
            e.preventDefault();
            e.returnValue = "";
        }
    });

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "splithorizon") return;

        // The outer switchTab() just cleared .active off our sub-tab nav/panes
        // too (see note above); re-apply whichever sub-tab was showing.
        switchSubTab(currentSubTab);
    });

    // If this tab was opened before the login overlay was unlocked, its
    // initial load() 401'd. Retry once authenticated, same as the Config tab.
    document.addEventListener("authenticated", () => {
        if (loaded && !dirty) load();
        if (recordsLoaded) loadRecords();
    });

    // ---- root layout ----

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="group-row">
                        <div><span id="shConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnShConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnShConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="shConfigListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                    <div class="panel-body">
                        <div class="form-horizontal">
                            <div class="form-group">
                                <label class="col-sm-4 control-label">App Preference</label>
                                <div class="col-sm-8"><input type="number" class="form-control" id="shCfgAppPreference" min="0" /></div>
                            </div>
                            <div class="form-group">
                                <div class="col-sm-12">
                                    <label><input type="checkbox" id="shCfgEnableAddressTranslation" /> Enable Address Translation</label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Named Networks</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Reusable named collections of CIDR networks, referenced from APP records and the maps below.</p>
                        <div id="shNetworksContainer"></div>
                        <button id="btnShAddNetwork" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Named Network</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Domain Group Map</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Maps a queried domain to a translation group. Takes precedence over the network group map.</p>
                        <div id="shDomainMapContainer"></div>
                        <button id="btnShAddDomainMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Network Group Map</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Maps a client source network (CIDR) to a translation group. Most specific subnet wins.</p>
                        <div id="shNetworkMapContainer"></div>
                        <button id="btnShAddNetworkMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Translation Groups</h3></div>
                    <div class="panel-body">
                        <div id="shGroupsContainer" class="list-group"></div>
                        <button id="btnShAddGroup" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Group</button>
                    </div>
                </div>
            </div>

            <div id="shConfigGroupEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnShConfigSave").addEventListener("click", save);
        document.getElementById("btnShConfigDiscard").addEventListener("click", discard);

        document.getElementById("shCfgAppPreference").value = config.appPreference;
        document.getElementById("shCfgAppPreference").addEventListener("input", (e) => { config.appPreference = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("shCfgEnableAddressTranslation").checked = config.enableAddressTranslation;
        document.getElementById("shCfgEnableAddressTranslation").addEventListener("change", (e) => { config.enableAddressTranslation = e.target.checked; markDirty(); });

        document.getElementById("btnShAddNetwork").addEventListener("click", addNamedNetwork);
        document.getElementById("btnShAddDomainMap").addEventListener("click", addDomainMapping);
        document.getElementById("btnShAddNetworkMap").addEventListener("click", addNetworkMapping);
        document.getElementById("btnShAddGroup").addEventListener("click", addGroup);

        renderNamedNetworks();
        renderDomainMap();
        renderNetworkMap();
        renderGroupsList();
    }

    // ---- named networks (name -> array of CIDR strings) ----

    function renderNamedNetworks() {
        const container = document.getElementById("shNetworksContainer");
        const names = Object.keys(config.networks);

        if (names.length === 0) {
            container.innerHTML = '<p class="text-muted">No named networks configured.</p>';
            return;
        }

        container.innerHTML = names.map((name) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <span class="group-name">${escapeHtml(name)}</span>
                <button class="btn btn-danger btn-xs network-remove" data-name="${escapeHtml(name)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="shNetworkCidrs-${escapeHtml(name)}"></div>
        </div>`).join("");

        names.forEach((name) => {
            renderStringList(`shNetworkCidrs-${name}`, config.networks[name], "10.0.0.0/8 or 2001:db8::/32");
        });

        container.querySelectorAll(".network-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete config.networks[btn.getAttribute("data-name")];
                markDirty();
                renderNamedNetworks();
            });
        });
    }

    async function addNamedNetwork() {
        let name = await uiPrompt("Named network name (letters, numbers, hyphens):");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (Object.prototype.hasOwnProperty.call(config.networks, name)) {
            await uiAlert(`A named network called "${name}" already exists.`);
            return;
        }

        config.networks[name] = [];
        markDirty();
        renderNamedNetworks();
    }

    // ---- group-name-valued map editors (domain map, network map) ----

    function renderGroupMapTable(containerId, mapObj, keyLabel, keyPlaceholder) {
        const container = document.getElementById(containerId);
        const keys = Object.keys(mapObj);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No mappings configured.</p>';
            return;
        }

        if (groupNames().length === 0) {
            container.innerHTML = '<p class="text-danger">Create a translation group below before mapping to one.</p>';
            return;
        }

        container.innerHTML = `<table class="table table-hover table-condensed">
            <thead><tr><th>${escapeHtml(keyLabel)}</th><th>Group</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${keys.map((key) => `<tr>
                    <td><input type="text" class="form-control input-sm map-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" placeholder="${escapeHtml(keyPlaceholder)}" /></td>
                    <td><select class="form-control input-sm map-value" data-key="${escapeHtml(key)}">
                        ${groupNames().map((g) => `<option value="${escapeHtml(g)}" ${g === mapObj[key] ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}
                    </select></td>
                    <td><button class="btn btn-danger btn-xs map-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".map-value").forEach((sel) => {
            sel.addEventListener("change", () => {
                mapObj[sel.getAttribute("data-key")] = sel.value;
                markDirty();
            });
        });

        container.querySelectorAll(".map-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete mapObj[btn.getAttribute("data-key")];
                markDirty();
                renderGroupMapTable(containerId, mapObj, keyLabel, keyPlaceholder);
            });
        });

        container.querySelectorAll(".map-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(mapObj, newKey)) {
                    await uiAlert(`A mapping for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                mapObj[newKey] = mapObj[oldKey];
                delete mapObj[oldKey];
                markDirty();
                renderGroupMapTable(containerId, mapObj, keyLabel, keyPlaceholder);
            });
        });
    }

    function renderDomainMap() {
        renderGroupMapTable("shDomainMapContainer", config.domainGroupMap, "Domain", "example.com");
    }

    function renderNetworkMap() {
        renderGroupMapTable("shNetworkMapContainer", config.networkGroupMap, "Network / IP", "192.168.1.0/24");
    }

    async function addDomainMapping() {
        if (groupNames().length === 0) { await uiAlert("Create a translation group first."); return; }

        let key = await uiPrompt("Domain name (e.g. example.com):");
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(config.domainGroupMap, key)) {
            await uiAlert("That domain is already mapped.");
            return;
        }

        config.domainGroupMap[key] = groupNames()[0];
        markDirty();
        renderDomainMap();
    }

    async function addNetworkMapping() {
        if (groupNames().length === 0) { await uiAlert("Create a translation group first."); return; }

        let key = await uiPrompt("Network or IP address (e.g. 192.168.1.0/24, 10.0.0.0/8):");
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(config.networkGroupMap, key)) {
            await uiAlert("That network is already mapped.");
            return;
        }

        config.networkGroupMap[key] = groupNames()[0];
        markDirty();
        renderNetworkMap();
    }

    // ---- simple string list editor (named network CIDRs) ----

    function renderStringList(containerId, arrayRef, placeholder) {
        const container = document.getElementById(containerId);

        container.innerHTML = `<table class="table table-condensed" style="margin-bottom:8px;">
            <tbody>
                ${arrayRef.map((val, i) => `<tr>
                    <td><input type="text" class="form-control input-sm string-list-item" data-index="${i}" value="${escapeHtml(val)}" placeholder="${escapeHtml(placeholder)}" /></td>
                    <td style="width:40px;"><button class="btn btn-danger btn-xs string-list-remove" data-index="${i}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>
        <button class="btn btn-default btn-xs string-list-add"><span class="fa fa-plus"></span> Add</button>`;

        container.querySelectorAll(".string-list-item").forEach((inp) => {
            inp.addEventListener("input", () => {
                arrayRef[parseInt(inp.getAttribute("data-index"), 10)] = inp.value;
                markDirty();
            });
        });

        container.querySelectorAll(".string-list-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                arrayRef.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                markDirty();
                renderStringList(containerId, arrayRef, placeholder);
            });
        });

        container.querySelector(".string-list-add").addEventListener("click", () => {
            arrayRef.push("");
            markDirty();
            renderStringList(containerId, arrayRef, placeholder);
            const inputs = container.querySelectorAll(".string-list-item");
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
    }

    // ---- free-text key/value map editor (externalToInternalTranslation) ----

    function renderTranslationMap(containerId, mapObj) {
        const container = document.getElementById(containerId);
        const keys = Object.keys(mapObj);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No translations configured.</p>';
        } else {
            container.innerHTML = `<table class="table table-hover table-condensed">
                <thead><tr><th>External IP / CIDR</th><th>Internal IP / CIDR</th><th style="width:40px;"></th></tr></thead>
                <tbody>
                    ${keys.map((key) => `<tr>
                        <td><input type="text" class="form-control input-sm translation-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" placeholder="1.2.3.0/24" /></td>
                        <td><input type="text" class="form-control input-sm translation-value" data-key="${escapeHtml(key)}" value="${escapeHtml(mapObj[key])}" placeholder="10.0.0.0/24" /></td>
                        <td><button class="btn btn-danger btn-xs translation-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                    </tr>`).join("")}
                </tbody>
            </table>`;
        }

        container.innerHTML += `<button class="btn btn-default btn-xs translation-add"><span class="fa fa-plus"></span> Add Translation</button>`;

        container.querySelectorAll(".translation-value").forEach((inp) => {
            inp.addEventListener("input", () => {
                mapObj[inp.getAttribute("data-key")] = inp.value;
                markDirty();
            });
        });

        container.querySelectorAll(".translation-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete mapObj[btn.getAttribute("data-key")];
                markDirty();
                renderTranslationMap(containerId, mapObj);
            });
        });

        container.querySelectorAll(".translation-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(mapObj, newKey)) {
                    await uiAlert(`A translation for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                mapObj[newKey] = mapObj[oldKey];
                delete mapObj[oldKey];
                markDirty();
                renderTranslationMap(containerId, mapObj);
            });
        });

        container.querySelector(".translation-add").addEventListener("click", async () => {
            let key = await uiPrompt("External IP or CIDR (e.g. 1.2.3.0/24):");
            if (!key) return;
            key = key.trim();
            if (!key) return;

            if (Object.prototype.hasOwnProperty.call(mapObj, key)) {
                await uiAlert("That external network is already mapped.");
                return;
            }

            mapObj[key] = "";
            markDirty();
            renderTranslationMap(containerId, mapObj);
        });
    }

    // ---- groups list ----

    function renderGroupsList() {
        const container = document.getElementById("shGroupsContainer");

        if (config.groups.length === 0) {
            container.innerHTML = '<p class="text-muted">No translation groups configured.</p>';
            return;
        }

        container.innerHTML = config.groups.map((g, idx) => {
            const badge = g.enabled
                ? '<span class="label label-success">Enabled</span>'
                : '<span class="label label-default">Disabled</span>';

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(g.name)}</span> ${badge}</div>
                <div class="group-actions">
                    <button class="btn btn-default btn-xs group-edit" data-index="${idx}">Edit</button>
                    <button class="btn btn-danger btn-xs group-delete" data-index="${idx}">Delete</button>
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll(".group-edit").forEach((btn) => {
            btn.addEventListener("click", () => openGroupEditor(parseInt(btn.getAttribute("data-index"), 10)));
        });

        container.querySelectorAll(".group-delete").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                const g = config.groups[idx];

                if (!(await uiConfirm(`Delete group "${g.name}"? Any domain/network mappings pointing to it will be left dangling.`))) return;

                config.groups.splice(idx, 1);
                markDirty();
                renderGroupsList();
                renderDomainMap();
                renderNetworkMap();
            });
        });
    }

    async function addGroup() {
        let name = await uiPrompt("New translation group name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (config.groups.some((g) => g.name === name)) {
            await uiAlert("A group with that name already exists.");
            return;
        }

        config.groups.push({
            name,
            enabled: true,
            translateReverseLookups: true,
            externalToInternalTranslation: {}
        });

        markDirty();
        renderGroupsList();
        renderDomainMap();
        renderNetworkMap();
    }

    // ---- group editor ----

    function openGroupEditor(index) {
        currentGroupIndex = index;
        document.getElementById("shConfigListView").style.display = "none";
        document.getElementById("shConfigGroupEditorView").style.display = "block";
        renderGroupEditor();
    }

    function closeGroupEditor() {
        currentGroupIndex = -1;
        document.getElementById("shConfigGroupEditorView").style.display = "none";
        document.getElementById("shConfigListView").style.display = "block";
        renderGroupsList();
        renderDomainMap();
        renderNetworkMap();
    }

    function renderGroupEditor() {
        const g = config.groups[currentGroupIndex];
        const editorEl = document.getElementById("shConfigGroupEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Edit Translation Group</h3></div>
                <div class="panel-body">
                    <button id="btnShGroupBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Groups</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="shGrpName" /></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="shGrpEnabled" /> Enabled</label></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="shGrpTranslateReverse" /> Translate Reverse Lookups (PTR)</label></div>
                        </div>
                    </div>

                    <h4>External &rarr; Internal Translation</h4>
                    <p class="text-muted">External and internal networks must use the same prefix length; only the network portion is replaced.</p>
                    <div id="shGrpTranslations"></div>
                </div>
            </div>
        `;

        document.getElementById("btnShGroupBack").addEventListener("click", closeGroupEditor);

        const nameInput = document.getElementById("shGrpName");
        nameInput.value = g.name;
        nameInput.addEventListener("blur", async () => {
            const newName = nameInput.value.trim();
            if (!newName) { nameInput.value = g.name; return; }
            if (newName === g.name) return;

            if (config.groups.some((gr, idx) => idx !== currentGroupIndex && gr.name === newName)) {
                await uiAlert("A group with that name already exists.");
                nameInput.value = g.name;
                return;
            }

            Object.keys(config.domainGroupMap).forEach((k) => {
                if (config.domainGroupMap[k] === g.name) config.domainGroupMap[k] = newName;
            });
            Object.keys(config.networkGroupMap).forEach((k) => {
                if (config.networkGroupMap[k] === g.name) config.networkGroupMap[k] = newName;
            });

            g.name = newName;
            markDirty();
        });

        document.getElementById("shGrpEnabled").checked = g.enabled;
        document.getElementById("shGrpEnabled").addEventListener("change", (e) => { g.enabled = e.target.checked; markDirty(); });

        document.getElementById("shGrpTranslateReverse").checked = g.translateReverseLookups;
        document.getElementById("shGrpTranslateReverse").addEventListener("change", (e) => { g.translateReverseLookups = e.target.checked; markDirty(); });

        if (!g.externalToInternalTranslation || typeof g.externalToInternalTranslation !== "object") g.externalToInternalTranslation = {};
        renderTranslationMap("shGrpTranslations", g.externalToInternalTranslation);
    }

    // ---- App Records (Split Horizon APP zone records) ----

    function onRecordsTabActivated() {
        if (!recordsLoaded) {
            recordsLoaded = true;
            loadRecords();
        }
    }

    async function loadRecords() {
        recordsRoot.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/splithorizon/records");
            const data = await res.json();
            if (!data.success) {
                recordsRoot.innerHTML = `<p class="text-danger">Failed to load records: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            records = data.records || [];
            zones = data.zones || [];
            editingIndex = -1;
            editBuffer = null;
            renderRecordsRoot();
        } catch (err) {
            recordsRoot.innerHTML = `<p class="text-danger">Failed to load records: ${escapeHtml(err.message)}</p>`;
        }
    }

    function classPathLabel(classPath) {
        return classPath === "SplitHorizon.SimpleCNAME" ? "CNAME" : "Address";
    }

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="shRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Split Horizon APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">APP records serve different A/AAAA or CNAME answers depending on the client's network. Add one per domain that needs split-horizon behavior.</p>
                        <div id="shRecordsContainer" class="list-group"></div>
                        <button id="btnShAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="shRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnShAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("shRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No Split Horizon APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> <span class="label label-info">${classPathLabel(rec.classPath)}</span> ${badge}</div>
                <div class="group-actions">
                    <button class="btn btn-default btn-xs rec-edit" data-index="${idx}">Edit</button>
                    <button class="btn btn-danger btn-xs rec-delete" data-index="${idx}">Delete</button>
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll(".rec-edit").forEach((btn) => {
            btn.addEventListener("click", () => openRecordEditor(parseInt(btn.getAttribute("data-index"), 10)));
        });

        container.querySelectorAll(".rec-delete").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                const rec = records[idx];

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops split-horizon responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/splithorizon/records/delete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ domain: rec.domain, zone: rec.zone })
                    });
                    const data = await res.json();
                    if (!data.success) {
                        await uiAlert("Failed to delete record: " + (data.error || "unknown error"));
                        return;
                    }
                    await loadRecords();
                } catch (err) {
                    await uiAlert("Failed to delete record: " + err.message);
                }
            });
        });
    }

    // ---- record editor ----

    function openRecordEditor(index) {
        editingIndex = index;

        if (index === -1) {
            editBuffer = { domain: "", zone: zones[0] || "", classPath: "SplitHorizon.SimpleAddress", ttl: 300, data: {} };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            editBuffer = {
                domain: rec.domain,
                zone: rec.zone,
                classPath: rec.classPath,
                ttl: rec.ttl,
                data: rec.data && typeof rec.data === "object" ? JSON.parse(JSON.stringify(rec.data)) : {}
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("shRecordsListView").style.display = "none";
        document.getElementById("shRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("shRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnShRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="shRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Domain</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="shRecDomain" placeholder="e.g. vpn.example.com" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Record Type</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="shRecClassPath">
                                    <option value="SplitHorizon.SimpleAddress" ${editBuffer.classPath === "SplitHorizon.SimpleAddress" ? "selected" : ""}>Address (A/AAAA)</option>
                                    <option value="SplitHorizon.SimpleCNAME" ${editBuffer.classPath === "SplitHorizon.SimpleCNAME" ? "selected" : ""}>CNAME</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="shRecTtl" min="0" /></div>
                        </div>
                    </div>

                    <h4>Network &rarr; Response Mapping</h4>
                    <p class="text-muted">Network key can be a CIDR (e.g. 10.0.0.0/8), a named network from App Config, or the keyword &quot;public&quot;/&quot;private&quot;.</p>
                    <div id="shRecDataContainer"></div>
                    <button id="btnShRecAddEntry" class="btn btn-default btn-xs"><span class="fa fa-plus"></span> Add Network Entry</button>

                    <div style="margin-top:16px;">
                        <button id="btnShRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnShRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("shRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; });

        const domainInput = document.getElementById("shRecDomain");
        domainInput.value = editBuffer.domain;
        domainInput.addEventListener("input", (e) => { editBuffer.domain = e.target.value; });

        const classPathSelect = document.getElementById("shRecClassPath");
        classPathSelect.addEventListener("change", async (e) => {
            const newClassPath = e.target.value;

            if (Object.keys(editBuffer.data).length > 0) {
                if (!(await uiConfirm("Switching the record type clears the network entries below. Continue?"))) {
                    classPathSelect.value = editBuffer.classPath;
                    return;
                }
                editBuffer.data = {};
            }

            editBuffer.classPath = newClassPath;
            renderRecordDataEditor();
        });

        const ttlInput = document.getElementById("shRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById("btnShRecAddEntry").addEventListener("click", addRecordDataEntry);
        document.getElementById("btnShRecSave").addEventListener("click", saveRecord);

        renderRecordDataEditor();
    }

    function renderRecordDataEditor() {
        if (editBuffer.classPath === "SplitHorizon.SimpleCNAME")
            renderRecordCnameData();
        else
            renderRecordAddressData();
    }

    async function addRecordDataEntry() {
        let key = await uiPrompt('Network key (CIDR, named network, or "public"/"private"):');
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(editBuffer.data, key)) {
            await uiAlert(`An entry for "${key}" already exists.`);
            return;
        }

        editBuffer.data[key] = editBuffer.classPath === "SplitHorizon.SimpleCNAME" ? "" : [];
        renderRecordDataEditor();
    }

    async function renameRecordDataKey(oldKey, newKeyRaw) {
        const newKey = newKeyRaw.trim();
        if (newKey === oldKey) return false;
        if (newKey === "") return false;

        if (Object.prototype.hasOwnProperty.call(editBuffer.data, newKey)) {
            await uiAlert(`An entry for "${newKey}" already exists.`);
            return false;
        }

        editBuffer.data[newKey] = editBuffer.data[oldKey];
        delete editBuffer.data[oldKey];
        return true;
    }

    // ---- Address (A/AAAA) data editor: network key -> array of IPs ----

    function renderRecordAddressData() {
        const container = document.getElementById("shRecDataContainer");
        const keys = Object.keys(editBuffer.data);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No network entries yet.</p>';
            return;
        }

        container.innerHTML = keys.map((key) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm rec-data-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs rec-data-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="shRecAddr-${escapeHtml(key)}"></div>
        </div>`).join("");

        keys.forEach((key) => {
            if (!Array.isArray(editBuffer.data[key])) editBuffer.data[key] = [];
            renderRecordAddressList(`shRecAddr-${key}`, editBuffer.data[key], "192.168.1.10 or ::1");
        });

        container.querySelectorAll(".rec-data-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const renamed = await renameRecordDataKey(oldKey, inp.value);
                if (renamed) renderRecordDataEditor();
                else inp.value = oldKey;
            });
        });

        container.querySelectorAll(".rec-data-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete editBuffer.data[btn.getAttribute("data-key")];
                renderRecordDataEditor();
            });
        });
    }

    // Same shape as the App Config tab's renderStringList, but without
    // markDirty() calls - App Records has no batched-document dirty concept,
    // and calling the App Config tab's markDirty() from here would incorrectly
    // flag the *other* sub-tab as having unsaved changes.
    function renderRecordAddressList(containerId, arrayRef, placeholder) {
        const container = document.getElementById(containerId);

        container.innerHTML = `<table class="table table-condensed" style="margin-bottom:8px;">
            <tbody>
                ${arrayRef.map((val, i) => `<tr>
                    <td><input type="text" class="form-control input-sm rec-addr-item" data-index="${i}" value="${escapeHtml(val)}" placeholder="${escapeHtml(placeholder)}" /></td>
                    <td style="width:40px;"><button class="btn btn-danger btn-xs rec-addr-remove" data-index="${i}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>
        <button class="btn btn-default btn-xs rec-addr-add"><span class="fa fa-plus"></span> Add</button>`;

        container.querySelectorAll(".rec-addr-item").forEach((inp) => {
            inp.addEventListener("input", () => {
                arrayRef[parseInt(inp.getAttribute("data-index"), 10)] = inp.value;
            });
        });

        container.querySelectorAll(".rec-addr-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                arrayRef.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                renderRecordAddressList(containerId, arrayRef, placeholder);
            });
        });

        container.querySelector(".rec-addr-add").addEventListener("click", () => {
            arrayRef.push("");
            renderRecordAddressList(containerId, arrayRef, placeholder);
            const inputs = container.querySelectorAll(".rec-addr-item");
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
    }

    // ---- CNAME data editor: network key -> single target domain ----

    function renderRecordCnameData() {
        const container = document.getElementById("shRecDataContainer");
        const keys = Object.keys(editBuffer.data);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No network entries yet.</p>';
            return;
        }

        container.innerHTML = `<table class="table table-hover table-condensed">
            <thead><tr><th>Network Key</th><th>CNAME Target</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${keys.map((key) => `<tr>
                    <td><input type="text" class="form-control input-sm rec-data-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" /></td>
                    <td><input type="text" class="form-control input-sm rec-cname-value" data-key="${escapeHtml(key)}" value="${escapeHtml(editBuffer.data[key] || "")}" placeholder="target.example.com" /></td>
                    <td><button class="btn btn-danger btn-xs rec-data-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".rec-cname-value").forEach((inp) => {
            inp.addEventListener("input", () => {
                editBuffer.data[inp.getAttribute("data-key")] = inp.value;
            });
        });

        container.querySelectorAll(".rec-data-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const renamed = await renameRecordDataKey(oldKey, inp.value);
                if (renamed) renderRecordDataEditor();
                else inp.value = oldKey;
            });
        });

        container.querySelectorAll(".rec-data-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete editBuffer.data[btn.getAttribute("data-key")];
                renderRecordDataEditor();
            });
        });
    }

    // ---- save ----

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }
        if (Object.keys(editBuffer.data).length === 0) { await uiAlert("Add at least one network entry."); return; }

        const saveBtn = document.getElementById("btnShRecSave");
        saveBtn.disabled = true;

        try {
            // Add's overwrite=true only replaces the record already at `domain` -
            // if editing moved the record to a different domain/zone, the old
            // one has to be removed separately or it's left behind as a stray.
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/splithorizon/records/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ domain: editOriginalDomain, zone: editOriginalZone })
                });
                const delData = await delRes.json();
                if (!delData.success) {
                    await uiAlert("Failed to move record (could not remove old entry): " + (delData.error || "unknown error"));
                    saveBtn.disabled = false;
                    return;
                }
            }

            const res = await apiFetch("/api/splithorizon/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain, zone: editBuffer.zone, classPath: editBuffer.classPath, ttl: editBuffer.ttl, data: editBuffer.data })
            });
            const data = await res.json();

            if (!data.success) {
                await uiAlert("Failed to save record: " + (data.error || "unknown error"));
                saveBtn.disabled = false;
                return;
            }

            await loadRecords();
        } catch (err) {
            await uiAlert("Failed to save record: " + err.message);
            saveBtn.disabled = false;
        }
    }

    initSubTabs();
})();
