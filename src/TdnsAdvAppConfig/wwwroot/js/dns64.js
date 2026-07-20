(function () {
    "use strict";

    const dns64Pane = document.getElementById("mainTabPaneDns64");
    const root = document.getElementById("dns64ConfigRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentGroupIndex = -1;
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
        const badge = document.getElementById("dns64ConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("dns64ConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function groupNames() {
        return config.groups.map((g) => g.name);
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.appPreference !== "number") raw.appPreference = 30;
        if (typeof raw.enableDns64 !== "boolean") raw.enableDns64 = true;
        if (typeof raw.networkGroupMap !== "object" || raw.networkGroupMap === null) raw.networkGroupMap = {};
        if (!Array.isArray(raw.groups)) raw.groups = [];

        raw.groups.forEach((g) => {
            if (typeof g.enableDns64 !== "boolean") g.enableDns64 = true;
            if (typeof g.dns64PrefixMap !== "object" || g.dns64PrefixMap === null) g.dns64PrefixMap = {};
            if (!Array.isArray(g.excludedIpv6)) g.excludedIpv6 = [];
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/dns64/config/raw");
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
            const res = await apiFetch("/api/dns64/config/raw", {
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
        dns64Pane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        dns64Pane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        dns64Pane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        dns64Pane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("dns64TabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "dns64") return;
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
                        <div><span id="dns64ConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnDns64ConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnDns64ConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="dns64ConfigListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                    <div class="panel-body">
                        <div class="form-horizontal">
                            <div class="form-group">
                                <label class="col-sm-4 control-label">App Preference</label>
                                <div class="col-sm-8"><input type="number" class="form-control" id="dns64CfgAppPreference" min="0" max="255" /></div>
                            </div>
                            <div class="form-group">
                                <div class="col-sm-12">
                                    <label><input type="checkbox" id="dns64CfgEnable" /> Enable DNS64</label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Network Group Map</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Maps a client source network (CIDR) to a group. Most specific subnet wins.</p>
                        <div id="dns64NetworkMapContainer"></div>
                        <button id="btnDns64AddNetworkMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Groups</h3></div>
                    <div class="panel-body">
                        <div id="dns64GroupsContainer" class="list-group"></div>
                        <button id="btnDns64AddGroup" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Group</button>
                    </div>
                </div>
            </div>

            <div id="dns64GroupEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnDns64ConfigSave").addEventListener("click", save);
        document.getElementById("btnDns64ConfigDiscard").addEventListener("click", discard);

        document.getElementById("dns64CfgAppPreference").value = config.appPreference;
        document.getElementById("dns64CfgAppPreference").addEventListener("input", (e) => { config.appPreference = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("dns64CfgEnable").checked = config.enableDns64;
        document.getElementById("dns64CfgEnable").addEventListener("change", (e) => { config.enableDns64 = e.target.checked; markDirty(); });

        document.getElementById("btnDns64AddNetworkMap").addEventListener("click", addNetworkMapping);
        document.getElementById("btnDns64AddGroup").addEventListener("click", addGroup);

        renderNetworkMap();
        renderGroupsList();
    }

    function renderNetworkMap() {
        AppHelpers.renderGroupMapTable("dns64NetworkMapContainer", config.networkGroupMap, "Network", "::/0 or 192.168.1.0/24", groupNames, markDirty, "group", true);
    }

    async function addNetworkMapping() {
        if (groupNames().length === 0) { await uiAlert("Create a group first."); return; }

        let key = await uiPrompt("Network (e.g. ::/0 or 192.168.1.0/24):");
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(config.networkGroupMap, key)) {
            await uiAlert("That network is already mapped.");
            return;
        }

        const group = await uiSelectPrompt(`Map "${key}" to which group?`, groupNames(), groupNames()[0]);
        if (!group) return;

        config.networkGroupMap[key] = group;
        markDirty();
        renderNetworkMap();
    }

    function renderGroupsList() {
        const container = document.getElementById("dns64GroupsContainer");

        if (config.groups.length === 0) {
            container.innerHTML = '<p class="text-muted">No groups configured.</p>';
            return;
        }

        container.innerHTML = config.groups.map((g, idx) => {
            const badge = g.enableDns64
                ? '<span class="label label-success">Enabled</span>'
                : '<span class="label label-default">Disabled</span>';
            const prefixCount = Object.keys(g.dns64PrefixMap).length;
            const countBadge = `<span class="label label-info">${prefixCount} prefix mapping${prefixCount === 1 ? "" : "s"}</span>`;

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(g.name)}</span> ${badge} ${countBadge}</div>
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

                const mapKeys = Object.keys(config.networkGroupMap).filter((k) => config.networkGroupMap[k] === g.name);

                let msg = `Delete group "${g.name}"?`;
                if (mapKeys.length > 0)
                    msg = `Delete group "${g.name}"? This will also remove ${mapKeys.length} network mapping(s) (${mapKeys.join(", ")}) that belong to it.`;

                if (!(await uiConfirm(msg))) return;

                mapKeys.forEach((k) => delete config.networkGroupMap[k]);

                config.groups.splice(idx, 1);
                markDirty();
                renderGroupsList();
                renderNetworkMap();
            });
        });
    }

    async function addGroup() {
        let name = await uiPrompt("New group name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (groupNames().includes(name)) {
            await uiAlert("A group with that name already exists.");
            return;
        }

        config.groups.push({ name, enableDns64: true, dns64PrefixMap: {}, excludedIpv6: [] });
        markDirty();
        openGroupEditor(config.groups.length - 1);
    }

    function closeGroupEditor() {
        currentGroupIndex = -1;
        document.getElementById("dns64ConfigListView").style.display = "";
        document.getElementById("dns64GroupEditorView").style.display = "none";
        window.scrollTo({ top: 0 });
        renderGroupsList();
        renderNetworkMap();
    }

    function openGroupEditor(index) {
        currentGroupIndex = index;
        document.getElementById("dns64ConfigListView").style.display = "none";
        document.getElementById("dns64GroupEditorView").style.display = "";
        renderGroupEditor();
        window.scrollTo({ top: 0 });
    }

    function renderGroupEditor() {
        const g = config.groups[currentGroupIndex];
        const editorView = document.getElementById("dns64GroupEditorView");

        editorView.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-body">
                    <button id="btnDns64GroupBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Groups</button>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="dns64GrpName" /></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3">
                                <label><input type="checkbox" id="dns64GrpEnabled" /> Enable DNS64</label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">DNS64 Prefix Map</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Maps an IPv4 network to the DNS64 prefix used to synthesize its AAAA address. Mark a network Excluded (no prefix) to skip synthesis for it entirely - e.g. private ranges that shouldn't be reachable from an IPv6-only client. Most specific network wins. Prefix length must be one of: 32, 40, 48, 56, 64, or 96.</p>
                    <div id="dns64PrefixMapContainer"></div>
                    <button id="btnDns64AddPrefixMapping" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Excluded IPv6 Ranges</h3></div>
                <div class="panel-body">
                    <p class="text-muted">If a name already resolves to a real (non-excluded) AAAA record in one of these ranges, DNS64 synthesis is skipped entirely for that answer.</p>
                    <div id="dns64ExcludedIpv6Container"></div>
                </div>
            </div>
        `;

        document.getElementById("btnDns64GroupBack").addEventListener("click", closeGroupEditor);

        const nameInput = document.getElementById("dns64GrpName");
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

            Object.keys(config.networkGroupMap).forEach((k) => {
                if (config.networkGroupMap[k] === g.name) config.networkGroupMap[k] = newName;
            });

            g.name = newName;
            markDirty();
        });

        document.getElementById("dns64GrpEnabled").checked = g.enableDns64;
        document.getElementById("dns64GrpEnabled").addEventListener("change", (e) => { g.enableDns64 = e.target.checked; markDirty(); });

        document.getElementById("btnDns64AddPrefixMapping").addEventListener("click", addPrefixMapping);

        renderPrefixMap();
        AppHelpers.renderStringList("dns64ExcludedIpv6Container", g.excludedIpv6, "e.g. ::ffff:0:0/96", markDirty);
    }

    function renderPrefixMap() {
        const g = config.groups[currentGroupIndex];
        const container = document.getElementById("dns64PrefixMapContainer");
        const keys = Object.keys(g.dns64PrefixMap);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No prefix mappings configured - no addresses will be synthesized for this group.</p>';
            return;
        }

        container.innerHTML = `<table class="table table-condensed">
            <thead><tr><th>IPv4 Network</th><th>DNS64 Prefix</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${keys.map((key) => {
                    const val = g.dns64PrefixMap[key];
                    const excluded = val === null;

                    return `<tr>
                        <td><input type="text" class="form-control input-sm prefix-map-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" placeholder="0.0.0.0/0" /></td>
                        <td>
                            <label style="font-weight:normal; white-space:nowrap;"><input type="checkbox" class="prefix-map-excluded" data-key="${escapeHtml(key)}" ${excluded ? "checked" : ""} /> Excluded</label>
                            <input type="text" class="form-control input-sm prefix-map-value" data-key="${escapeHtml(key)}" value="${excluded ? "" : escapeHtml(val)}" placeholder="64:ff9b::/96" style="margin-top:4px; ${excluded ? "display:none;" : ""}" />
                        </td>
                        <td><button class="btn btn-danger btn-xs prefix-map-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                    </tr>`;
                }).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".prefix-map-excluded").forEach((chk) => {
            chk.addEventListener("change", () => {
                const key = chk.getAttribute("data-key");
                g.dns64PrefixMap[key] = chk.checked ? null : "";
                markDirty();
                renderPrefixMap();
            });
        });

        container.querySelectorAll(".prefix-map-value").forEach((inp) => {
            inp.addEventListener("input", () => { g.dns64PrefixMap[inp.getAttribute("data-key")] = inp.value; markDirty(); });
        });

        container.querySelectorAll(".prefix-map-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete g.dns64PrefixMap[btn.getAttribute("data-key")];
                markDirty();
                renderPrefixMap();
            });
        });

        container.querySelectorAll(".prefix-map-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(g.dns64PrefixMap, newKey)) {
                    await uiAlert(`A mapping for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                g.dns64PrefixMap[newKey] = g.dns64PrefixMap[oldKey];
                delete g.dns64PrefixMap[oldKey];
                markDirty();
                renderPrefixMap();
            });
        });
    }

    async function addPrefixMapping() {
        const g = config.groups[currentGroupIndex];

        let key = await uiPrompt("IPv4 network (e.g. 0.0.0.0/0 or 10.0.0.0/8):");
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(g.dns64PrefixMap, key)) {
            await uiAlert("That network is already mapped.");
            return;
        }

        g.dns64PrefixMap[key] = null;
        markDirty();
        renderPrefixMap();
    }

    initSubTabs();
})();
