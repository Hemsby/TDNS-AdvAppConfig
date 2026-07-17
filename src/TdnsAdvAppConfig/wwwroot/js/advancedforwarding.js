(function () {
    "use strict";

    const afPane = document.getElementById("mainTabPaneAdvancedForwarding");
    const root = document.getElementById("advancedForwardingConfigRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentGroupIndex = -1;
    let currentSubTab = "config";

    const PROXY_TYPES = ["Http", "Socks5"];
    const FORWARDER_PROTOCOLS = ["Udp", "Tcp", "Tls", "Https", "Quic"];

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("afConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("afConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function proxyNames() {
        return config.proxyServers.map((p) => p.name);
    }

    function forwarderNames() {
        return config.forwarders.map((f) => f.name);
    }

    function groupNames() {
        return config.groups.map((g) => g.name);
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.appPreference !== "number") raw.appPreference = 200;
        if (typeof raw.enableForwarding !== "boolean") raw.enableForwarding = true;
        if (!Array.isArray(raw.proxyServers)) raw.proxyServers = [];
        if (!Array.isArray(raw.forwarders)) raw.forwarders = [];
        if (typeof raw.networkGroupMap !== "object" || raw.networkGroupMap === null) raw.networkGroupMap = {};
        if (!Array.isArray(raw.groups)) raw.groups = [];

        raw.groups.forEach((g) => {
            if (!Array.isArray(g.forwardings)) g.forwardings = [];
            g.forwardings.forEach((f) => {
                if (!Array.isArray(f.forwarders)) f.forwarders = [];
                if (!Array.isArray(f.domains)) f.domains = [];
            });
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/advancedforwarding/config/raw");
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
            const res = await apiFetch("/api/advancedforwarding/config/raw", {
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
        afPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        afPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        afPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        afPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("afTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "advancedforwarding") return;
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
                        <div><span id="afConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnAfConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnAfConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="afConfigListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                    <div class="panel-body">
                        <div class="form-horizontal">
                            <div class="form-group">
                                <label class="col-sm-4 control-label">App Preference</label>
                                <div class="col-sm-8"><input type="number" class="form-control" id="afCfgAppPreference" min="0" /></div>
                            </div>
                            <div class="form-group">
                                <div class="col-sm-12">
                                    <label><input type="checkbox" id="afCfgEnableForwarding" /> Enable Forwarding</label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Proxy Servers</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Reusable proxy definitions forwarders can optionally route through.</p>
                        <div id="afProxyServersContainer"></div>
                        <button id="btnAfAddProxy" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Proxy Server</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Forwarders</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Reusable upstream resolver definitions, referenced by name from groups' forwarding rules below.</p>
                        <div id="afForwardersContainer"></div>
                        <button id="btnAfAddForwarder" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Forwarder</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Network Group Map</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Maps a client source network (CIDR) to a group. Most specific subnet wins.</p>
                        <div id="afNetworkMapContainer"></div>
                        <button id="btnAfAddNetworkMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Groups</h3></div>
                    <div class="panel-body">
                        <div id="afGroupsContainer" class="list-group"></div>
                        <button id="btnAfAddGroup" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Group</button>
                    </div>
                </div>
            </div>

            <div id="afGroupEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnAfConfigSave").addEventListener("click", save);
        document.getElementById("btnAfConfigDiscard").addEventListener("click", discard);

        document.getElementById("afCfgAppPreference").value = config.appPreference;
        document.getElementById("afCfgAppPreference").addEventListener("input", (e) => { config.appPreference = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("afCfgEnableForwarding").checked = config.enableForwarding;
        document.getElementById("afCfgEnableForwarding").addEventListener("change", (e) => { config.enableForwarding = e.target.checked; markDirty(); });

        document.getElementById("btnAfAddProxy").addEventListener("click", addProxyServer);
        document.getElementById("btnAfAddForwarder").addEventListener("click", addForwarder);
        document.getElementById("btnAfAddNetworkMap").addEventListener("click", addNetworkMapping);
        document.getElementById("btnAfAddGroup").addEventListener("click", addGroup);

        renderProxyServers();
        renderForwarders();
        renderNetworkMap();
        renderGroupsList();
    }

    function renderProxyServers() {
        const container = document.getElementById("afProxyServersContainer");

        if (config.proxyServers.length === 0) {
            container.innerHTML = '<p class="text-muted">No proxy servers configured.</p>';
            return;
        }

        container.innerHTML = config.proxyServers.map((p) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm proxy-name" data-orig-name="${escapeHtml(p.name)}" value="${escapeHtml(p.name)}" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs proxy-remove" data-name="${escapeHtml(p.name)}"><span class="fa fa-trash"></span></button>
            </div>
            <div class="form-horizontal">
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Type</label>
                    <div class="col-sm-9">
                        <select class="form-control input-sm proxy-type" data-name="${escapeHtml(p.name)}">
                            ${PROXY_TYPES.map((t) => `<option value="${t}" ${p.type === t ? "selected" : ""}>${t}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Address</label>
                    <div class="col-sm-9"><input type="text" class="form-control input-sm proxy-address" data-name="${escapeHtml(p.name)}" value="${escapeHtml(p.proxyAddress || "")}" placeholder="localhost or 10.0.0.1" /></div>
                </div>
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Port</label>
                    <div class="col-sm-9"><input type="number" class="form-control input-sm proxy-port" data-name="${escapeHtml(p.name)}" value="${p.proxyPort || 0}" min="0" max="65535" /></div>
                </div>
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Username</label>
                    <div class="col-sm-9"><input type="text" class="form-control input-sm proxy-username" data-name="${escapeHtml(p.name)}" value="${escapeHtml(p.proxyUsername || "")}" placeholder="optional" /></div>
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Password</label>
                    <div class="col-sm-9"><input type="password" class="form-control input-sm proxy-password" data-name="${escapeHtml(p.name)}" value="${escapeHtml(p.proxyPassword || "")}" placeholder="optional" /></div>
                </div>
            </div>
        </div>`).join("");

        function findProxy(name) { return config.proxyServers.find((p) => p.name === name); }

        container.querySelectorAll(".proxy-type").forEach((sel) => {
            sel.addEventListener("change", () => { findProxy(sel.getAttribute("data-name")).type = sel.value; markDirty(); });
        });
        container.querySelectorAll(".proxy-address").forEach((inp) => {
            inp.addEventListener("input", () => { findProxy(inp.getAttribute("data-name")).proxyAddress = inp.value; markDirty(); });
        });
        container.querySelectorAll(".proxy-port").forEach((inp) => {
            inp.addEventListener("input", () => { findProxy(inp.getAttribute("data-name")).proxyPort = parseInt(inp.value, 10) || 0; markDirty(); });
        });
        container.querySelectorAll(".proxy-username").forEach((inp) => {
            inp.addEventListener("input", () => { findProxy(inp.getAttribute("data-name")).proxyUsername = inp.value || null; markDirty(); });
        });
        container.querySelectorAll(".proxy-password").forEach((inp) => {
            inp.addEventListener("input", () => { findProxy(inp.getAttribute("data-name")).proxyPassword = inp.value || null; markDirty(); });
        });

        container.querySelectorAll(".proxy-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldName = inp.getAttribute("data-orig-name");
                const newName = inp.value.trim();

                if (newName === oldName) return;

                if (newName === "") {
                    inp.value = oldName;
                    return;
                }

                if (proxyNames().includes(newName)) {
                    await uiAlert(`A proxy server called "${newName}" already exists.`);
                    inp.value = oldName;
                    return;
                }

                findProxy(oldName).name = newName;
                config.forwarders.forEach((f) => { if (f.proxy === oldName) f.proxy = newName; });
                markDirty();
                renderProxyServers();
                renderForwarders();
            });
        });

        container.querySelectorAll(".proxy-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const name = btn.getAttribute("data-name");
                const affected = config.forwarders.filter((f) => f.proxy === name);

                if (affected.length > 0) {
                    const list = affected.map((f) => f.name).join(", ");
                    if (!(await uiConfirm(`Deleting "${name}" will clear the proxy on ${affected.length} forwarder(s) that use it, so they'll connect directly instead: ${list}. Continue?`))) return;

                    affected.forEach((f) => { f.proxy = null; });
                    renderForwarders();
                }

                config.proxyServers = config.proxyServers.filter((p) => p.name !== name);
                markDirty();
                renderProxyServers();
            });
        });
    }

    async function addProxyServer() {
        let name = await uiPrompt("Proxy server name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (proxyNames().includes(name)) {
            await uiAlert(`A proxy server called "${name}" already exists.`);
            return;
        }

        config.proxyServers.push({ name, type: "Http", proxyAddress: "", proxyPort: 1080, proxyUsername: null, proxyPassword: null });
        markDirty();
        renderProxyServers();
    }

    function renderForwarders() {
        const container = document.getElementById("afForwardersContainer");

        if (config.forwarders.length === 0) {
            container.innerHTML = '<p class="text-muted">No forwarders configured.</p>';
            return;
        }

        container.innerHTML = config.forwarders.map((f) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm forwarder-name" data-orig-name="${escapeHtml(f.name)}" value="${escapeHtml(f.name)}" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs forwarder-remove" data-name="${escapeHtml(f.name)}"><span class="fa fa-trash"></span></button>
            </div>
            <div class="form-horizontal">
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Protocol</label>
                    <div class="col-sm-9">
                        <select class="form-control input-sm forwarder-protocol" data-name="${escapeHtml(f.name)}">
                            ${FORWARDER_PROTOCOLS.map((p) => `<option value="${p}" ${(f.forwarderProtocol || "Udp") === p ? "selected" : ""}>${p}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Proxy</label>
                    <div class="col-sm-9">
                        <select class="form-control input-sm forwarder-proxy" data-name="${escapeHtml(f.name)}">
                            <option value="">(none - direct connection)</option>
                            ${proxyNames().map((n) => `<option value="${escapeHtml(n)}" ${f.proxy === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <div class="form-group" style="margin-bottom:6px;">
                    <div class="col-sm-9 col-sm-offset-3">
                        <label style="font-weight:normal;"><input type="checkbox" class="forwarder-dnssec" data-name="${escapeHtml(f.name)}" ${f.dnssecValidation !== false ? "checked" : ""} /> DNSSEC Validation</label>
                    </div>
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label class="col-sm-3 control-label" style="font-weight:normal;">Addresses</label>
                    <div class="col-sm-9"><div id="afForwarderAddrs-${escapeHtml(f.name)}"></div></div>
                </div>
            </div>
        </div>`).join("");

        function findForwarder(name) { return config.forwarders.find((f) => f.name === name); }

        config.forwarders.forEach((f) => {
            AppHelpers.renderStringList(`afForwarderAddrs-${f.name}`, f.forwarderAddresses, "1.1.1.1 or https://dns.quad9.net/dns-query (9.9.9.9)", markDirty);
        });

        container.querySelectorAll(".forwarder-protocol").forEach((sel) => {
            sel.addEventListener("change", () => { findForwarder(sel.getAttribute("data-name")).forwarderProtocol = sel.value; markDirty(); });
        });
        container.querySelectorAll(".forwarder-proxy").forEach((sel) => {
            sel.addEventListener("change", () => { findForwarder(sel.getAttribute("data-name")).proxy = sel.value || null; markDirty(); });
        });
        container.querySelectorAll(".forwarder-dnssec").forEach((chk) => {
            chk.addEventListener("change", () => { findForwarder(chk.getAttribute("data-name")).dnssecValidation = chk.checked; markDirty(); });
        });

        container.querySelectorAll(".forwarder-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldName = inp.getAttribute("data-orig-name");
                const newName = inp.value.trim();

                if (newName === oldName) return;

                if (newName === "") {
                    inp.value = oldName;
                    return;
                }

                if (forwarderNames().includes(newName)) {
                    await uiAlert(`A forwarder called "${newName}" already exists.`);
                    inp.value = oldName;
                    return;
                }

                findForwarder(oldName).name = newName;
                config.groups.forEach((g) => {
                    g.forwardings.forEach((fw) => {
                        const idx = fw.forwarders.indexOf(oldName);
                        if (idx !== -1) fw.forwarders[idx] = newName;
                    });
                });
                markDirty();
                renderForwarders();
            });
        });

        container.querySelectorAll(".forwarder-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const name = btn.getAttribute("data-name");
                const affected = [];

                config.groups.forEach((g) => {
                    g.forwardings.forEach((fw) => {
                        if (fw.forwarders.includes(name)) affected.push(g.name);
                    });
                });

                if (affected.length > 0) {
                    if (!(await uiConfirm(`Deleting "${name}" will also update forwarding rules in ${affected.length} group(s) that use it: ${affected.join(", ")}. Rules left with no forwarders will be removed entirely. Continue?`))) return;

                    config.groups.forEach((g) => {
                        g.forwardings = g.forwardings.filter((fw) => {
                            const idx = fw.forwarders.indexOf(name);
                            if (idx !== -1) fw.forwarders.splice(idx, 1);
                            return fw.forwarders.length > 0;
                        });
                    });

                    renderGroupsList();
                }

                config.forwarders = config.forwarders.filter((f) => f.name !== name);
                markDirty();
                renderForwarders();
            });
        });
    }

    async function addForwarder() {
        let name = await uiPrompt("Forwarder name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (forwarderNames().includes(name)) {
            await uiAlert(`A forwarder called "${name}" already exists.`);
            return;
        }

        config.forwarders.push({ name, proxy: null, dnssecValidation: true, forwarderProtocol: "Udp", forwarderAddresses: [] });
        markDirty();
        renderForwarders();
    }

    function renderNetworkMap() {
        AppHelpers.renderGroupMapTable("afNetworkMapContainer", config.networkGroupMap, "Network / IP", "192.168.1.0/24", groupNames, markDirty, "group");
    }

    async function addNetworkMapping() {
        if (groupNames().length === 0) { await uiAlert("Create a group first."); return; }

        let key = await uiPrompt("Network / IP (e.g. 192.168.1.0/24):");
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

    function renderGroupsList() {
        const container = document.getElementById("afGroupsContainer");

        if (config.groups.length === 0) {
            container.innerHTML = '<p class="text-muted">No groups configured.</p>';
            return;
        }

        container.innerHTML = config.groups.map((g, idx) => {
            const badge = g.enableForwarding
                ? '<span class="label label-success">Enabled</span>'
                : '<span class="label label-default">Disabled</span>';
            const ruleCount = `<span class="label label-info">${g.forwardings.length} rule${g.forwardings.length === 1 ? "" : "s"}</span>`;

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(g.name)}</span> ${badge} ${ruleCount}</div>
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
                const hasAdguard = Array.isArray(g.adguardUpstreams) && g.adguardUpstreams.length > 0;

                let msg = `Delete group "${g.name}"?`;
                const parts = [];
                if (mapKeys.length > 0) parts.push(`${mapKeys.length} network mapping(s) (${mapKeys.join(", ")})`);
                if (hasAdguard) parts.push(`${g.adguardUpstreams.length} AdGuard Upstream file reference(s)`);
                if (parts.length > 0) msg = `Delete group "${g.name}"? This will also remove ${parts.join(" and ")} that belong to it.`;

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

        config.groups.push({ name, enableForwarding: true, forwardings: [] });
        markDirty();
        renderGroupsList();
    }

    function closeGroupEditor() {
        currentGroupIndex = -1;
        document.getElementById("afConfigListView").style.display = "";
        document.getElementById("afGroupEditorView").style.display = "none";
        renderGroupsList();
        renderNetworkMap();
    }

    function openGroupEditor(index) {
        currentGroupIndex = index;
        document.getElementById("afConfigListView").style.display = "none";
        document.getElementById("afGroupEditorView").style.display = "";
        renderGroupEditor();
    }

    function renderGroupEditor() {
        const g = config.groups[currentGroupIndex];
        const editorView = document.getElementById("afGroupEditorView");

        const adguardNote = (Array.isArray(g.adguardUpstreams) && g.adguardUpstreams.length > 0)
            ? `<p class="text-muted">This group also has ${g.adguardUpstreams.length} AdGuard Upstream file reference(s) configured, which aren't editable here - they're preserved as-is when you save.</p>`
            : "";

        editorView.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-body">
                    <button id="btnAfGroupBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Groups</button>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="afGrpName" /></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3">
                                <label><input type="checkbox" id="afGrpEnabled" /> Enable Forwarding</label>
                            </div>
                        </div>
                    </div>
                    ${adguardNote}
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Forwarding Rules</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Checked top-to-bottom for a matching domain - the first rule whose domains list matches wins.</p>
                    <div id="afGrpForwardings"></div>
                    <button id="btnAfGrpAddForwarding" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Rule</button>
                </div>
            </div>
        `;

        document.getElementById("btnAfGroupBack").addEventListener("click", closeGroupEditor);

        const nameInput = document.getElementById("afGrpName");
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

        document.getElementById("afGrpEnabled").checked = g.enableForwarding;
        document.getElementById("afGrpEnabled").addEventListener("change", (e) => { g.enableForwarding = e.target.checked; markDirty(); });

        document.getElementById("btnAfGrpAddForwarding").addEventListener("click", () => {
            g.forwardings.push({ forwarders: [], domains: [] });
            markDirty();
            renderForwardingsEditor();
        });

        renderForwardingsEditor();
    }

    function renderForwardingsEditor() {
        const g = config.groups[currentGroupIndex];
        const container = document.getElementById("afGrpForwardings");

        if (g.forwardings.length === 0) {
            container.innerHTML = '<p class="text-muted">No forwarding rules - this group never matches anything.</p>';
            return;
        }

        if (forwarderNames().length === 0) {
            container.innerHTML = '<p class="text-danger">Create a forwarder above before adding a rule.</p>';
            return;
        }

        container.innerHTML = g.forwardings.map((fw, i) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <strong>Rule ${i + 1}</strong>
                <button class="btn btn-danger btn-xs fw-remove" data-index="${i}"><span class="fa fa-trash"></span></button>
            </div>

            <div style="margin-bottom:8px;">
                <label style="font-weight:normal;">Forwarders</label>
                <div id="afGrpFwForwarders-${i}"></div>
            </div>

            <div>
                <label style="font-weight:normal;">Domains (exact, "*.example.com" wildcard, or "*" for everything)</label>
                <div id="afGrpFwDomains-${i}"></div>
            </div>
        </div>`).join("");

        g.forwardings.forEach((fw, i) => {
            AppHelpers.renderBadgePicker(`afGrpFwForwarders-${i}`, fw.forwarders, forwarderNames, markDirty, { emptyText: "No forwarders selected yet." });
            AppHelpers.renderStringList(`afGrpFwDomains-${i}`, fw.domains, "example.com or *", markDirty);
        });

        container.querySelectorAll(".fw-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                g.forwardings.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                markDirty();
                renderForwardingsEditor();
            });
        });
    }

    initSubTabs();
})();
