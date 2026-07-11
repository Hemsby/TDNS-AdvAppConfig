(function () {
    "use strict";

    const root = document.getElementById("configRoot");

    let config = null;      // working copy, mutated directly by the form
    let loaded = false;
    let dirty = false;
    let currentGroupIndex = -1;

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function groupNames() {
        return config.groups.map((g) => g.name);
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("configDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("configDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/config/raw");
            const data = await res.json();
            if (!data.success) {
                root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            config = data.config;
            currentGroupIndex = -1;
            clearDirty();
            renderRoot();
        } catch (err) {
            root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(err.message)}</p>`;
        }
    }

    async function save() {
        try {
            const res = await apiFetch("/api/config/raw", {
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

    function onTabActivated() {
        if (!loaded) {
            loaded = true;
            load();
            return;
        }

        // Pick up changes made from the Dashboard tab (pause/resume), but
        // don't clobber in-progress edits here.
        if (!dirty) load();
    }

    window.addEventListener("beforeunload", (e) => {
        if (dirty) {
            e.preventDefault();
            e.returnValue = "";
        }
    });

    document.addEventListener("abtabchange", (e) => {
        if (e.detail.subtab === "config") onTabActivated();
    });

    // If this tab was opened before the login overlay was unlocked, its
    // initial load() 401'd. Retry once authenticated, same as the Dashboard.
    document.addEventListener("authenticated", () => {
        if (loaded && !dirty) load();
    });

    // ---- root layout ----

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="group-row">
                        <div><span id="configDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="configListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                    <div class="panel-body">
                        <div class="form-horizontal">
                            <div class="form-group">
                                <div class="col-sm-12">
                                    <label><input type="checkbox" id="cfgEnableBlocking" /> Enable Blocking (master switch for all groups)</label>
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="col-sm-4 control-label">Blocking Answer TTL (seconds)</label>
                                <div class="col-sm-8"><input type="number" class="form-control" id="cfgBlockingTtl" min="0" /></div>
                            </div>
                            <div class="form-group">
                                <label class="col-sm-4 control-label">Block List Update Interval</label>
                                <div class="col-sm-4">
                                    <div class="input-group">
                                        <input type="number" class="form-control" id="cfgUpdateHours" min="0" />
                                        <span class="input-group-addon">hours</span>
                                    </div>
                                </div>
                                <div class="col-sm-4">
                                    <div class="input-group">
                                        <input type="number" class="form-control" id="cfgUpdateMinutes" min="0" max="59" />
                                        <span class="input-group-addon">minutes</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Local Endpoint Group Map</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Maps a specific DNS server listener (e.g. 127.0.0.1 or user1.dot.example.com) to a group.</p>
                        <div id="endpointMapContainer"></div>
                        <button id="btnAddEndpointMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Network Group Map</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Maps a client IP address or CIDR subnet to a group. More specific matches take precedence.</p>
                        <div id="networkMapContainer"></div>
                        <button id="btnAddNetworkMap" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Mapping</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Groups</h3></div>
                    <div class="panel-body">
                        <div id="groupsContainer" class="list-group"></div>
                        <button id="btnAddGroup" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Group</button>
                    </div>
                </div>
            </div>

            <div id="configGroupEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnConfigSave").addEventListener("click", save);
        document.getElementById("btnConfigDiscard").addEventListener("click", discard);

        document.getElementById("cfgEnableBlocking").checked = config.enableBlocking;
        document.getElementById("cfgEnableBlocking").addEventListener("change", (e) => { config.enableBlocking = e.target.checked; markDirty(); });

        document.getElementById("cfgBlockingTtl").value = config.blockingAnswerTtl;
        document.getElementById("cfgBlockingTtl").addEventListener("input", (e) => { config.blockingAnswerTtl = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("cfgUpdateHours").value = config.blockListUrlUpdateIntervalHours;
        document.getElementById("cfgUpdateHours").addEventListener("input", (e) => { config.blockListUrlUpdateIntervalHours = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("cfgUpdateMinutes").value = config.blockListUrlUpdateIntervalMinutes;
        document.getElementById("cfgUpdateMinutes").addEventListener("input", (e) => { config.blockListUrlUpdateIntervalMinutes = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("btnAddEndpointMap").addEventListener("click", addEndpointMapping);
        document.getElementById("btnAddNetworkMap").addEventListener("click", addNetworkMapping);
        document.getElementById("btnAddGroup").addEventListener("click", addGroup);

        renderEndpointMap();
        renderNetworkMap();
        renderGroupsList();
    }

    // ---- key/value map editors (endpoint map, network map) ----

    function renderMapTable(containerId, mapObj, keyLabel, keyPlaceholder) {
        const container = document.getElementById(containerId);
        const keys = Object.keys(mapObj);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No mappings configured.</p>';
            return;
        }

        if (groupNames().length === 0) {
            container.innerHTML = '<p class="text-danger">Create a group below before mapping to one.</p>';
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
                renderMapTable(containerId, mapObj, keyLabel, keyPlaceholder);
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
                renderMapTable(containerId, mapObj, keyLabel, keyPlaceholder);
            });
        });
    }

    function renderEndpointMap() {
        renderMapTable("endpointMapContainer", config.localEndPointGroupMap, "Endpoint", "127.0.0.1 or host.example.com:443");
    }

    function renderNetworkMap() {
        renderMapTable("networkMapContainer", config.networkGroupMap, "Network / IP", "192.168.1.0/24");
    }

    async function addEndpointMapping() {
        if (groupNames().length === 0) { await uiAlert("Create a group first."); return; }

        let key = await uiPrompt("Endpoint (e.g. 127.0.0.1, 192.168.1.2:53, or user1.dot.example.com):");
        if (!key) return;
        key = key.trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(config.localEndPointGroupMap, key)) {
            await uiAlert("That endpoint is already mapped.");
            return;
        }

        config.localEndPointGroupMap[key] = groupNames()[0];
        markDirty();
        renderEndpointMap();
    }

    async function addNetworkMapping() {
        if (groupNames().length === 0) { await uiAlert("Create a group first."); return; }

        let key = await uiPrompt("Network or IP address (e.g. 192.168.1.0/24, 0.0.0.0/0):");
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

    // ---- groups list ----

    function renderGroupsList() {
        const container = document.getElementById("groupsContainer");

        if (config.groups.length === 0) {
            container.innerHTML = '<p class="text-muted">No groups configured.</p>';
            return;
        }

        container.innerHTML = config.groups.map((g, idx) => {
            const badge = g.enableBlocking
                ? '<span class="label label-success">Active</span>'
                : '<span class="label label-default">Paused</span>';

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

                if (!(await uiConfirm(`Delete group "${g.name}"? Any endpoint/network mappings pointing to it will be left dangling.`))) return;

                config.groups.splice(idx, 1);
                markDirty();
                renderGroupsList();
                renderEndpointMap();
                renderNetworkMap();
            });
        });
    }

    async function addGroup() {
        let name = await uiPrompt("New group name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (config.groups.some((g) => g.name === name)) {
            await uiAlert("A group with that name already exists.");
            return;
        }

        config.groups.push({
            name,
            enableBlocking: true,
            allowTxtBlockingReport: true,
            blockAsNxDomain: false,
            blockingAddresses: [],
            allowed: [],
            blocked: [],
            allowListUrls: [],
            blockListUrls: [],
            allowedRegex: [],
            blockedRegex: [],
            regexAllowListUrls: [],
            regexBlockListUrls: [],
            adblockListUrls: []
        });

        markDirty();
        renderGroupsList();
        renderEndpointMap();
        renderNetworkMap();
    }

    // ---- simple string list editor (blockingAddresses, allowed, blocked, *Regex, allowListUrls, regexAllowListUrls) ----

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

    // ---- URL entry list editor: string OR {url, blockAsNxDomain, blockingAddresses} ----
    // (blockListUrls, regexBlockListUrls, adblockListUrls)

    function renderUrlEntryList(containerId, arrayRef) {
        const container = document.getElementById(containerId);

        container.innerHTML = arrayRef.map((entry, i) => {
            const isObj = typeof entry === "object" && entry !== null;
            const url = isObj ? (entry.url || "") : (entry || "");
            const blockAsNxDomain = isObj ? !!entry.blockAsNxDomain : false;

            return `<div class="well well-sm" style="margin-bottom:8px;">
                <div class="group-row">
                    <input type="text" class="form-control input-sm url-entry-url" data-index="${i}" style="flex:1; margin-right:8px;" value="${escapeHtml(url)}" placeholder="https://example.com/list.txt" />
                    <label style="white-space:nowrap; font-weight:normal; margin:0 8px;"><input type="checkbox" class="url-entry-advanced-toggle" data-index="${i}" ${isObj ? "checked" : ""} /> Advanced</label>
                    <button class="btn btn-danger btn-xs url-entry-remove" data-index="${i}"><span class="fa fa-trash"></span></button>
                </div>
                <div class="url-entry-advanced" style="margin-top:8px; ${isObj ? "" : "display:none;"}">
                    <label style="font-weight:normal;"><input type="checkbox" class="url-entry-blockasnxdomain" data-index="${i}" ${blockAsNxDomain ? "checked" : ""} /> Block as NXDOMAIN (overrides group default)</label>
                    <div class="text-muted" style="font-size:12px; margin-top:6px;">Blocking Addresses (overrides group default)</div>
                    <div id="${containerId}-addr-${i}"></div>
                </div>
            </div>`;
        }).join("") + `<button class="btn btn-default btn-xs url-entry-add"><span class="fa fa-plus"></span> Add URL</button>`;

        arrayRef.forEach((entry, i) => {
            if (typeof entry === "object" && entry !== null) {
                if (!Array.isArray(entry.blockingAddresses)) entry.blockingAddresses = [];
                renderStringList(`${containerId}-addr-${i}`, entry.blockingAddresses, "IP address");
            }
        });

        function toObjectEntry(entry) {
            const url = typeof entry === "object" && entry !== null ? (entry.url || "") : (entry || "");
            return { url, blockAsNxDomain: false, blockingAddresses: [] };
        }

        container.querySelectorAll(".url-entry-url").forEach((inp) => {
            inp.addEventListener("input", () => {
                const i = parseInt(inp.getAttribute("data-index"), 10);
                if (typeof arrayRef[i] === "object" && arrayRef[i] !== null) arrayRef[i].url = inp.value;
                else arrayRef[i] = inp.value;
                markDirty();
            });
        });

        container.querySelectorAll(".url-entry-advanced-toggle").forEach((chk) => {
            chk.addEventListener("change", () => {
                const i = parseInt(chk.getAttribute("data-index"), 10);
                arrayRef[i] = chk.checked ? toObjectEntry(arrayRef[i]) : (typeof arrayRef[i] === "object" ? (arrayRef[i].url || "") : arrayRef[i]);
                markDirty();
                renderUrlEntryList(containerId, arrayRef);
            });
        });

        container.querySelectorAll(".url-entry-blockasnxdomain").forEach((chk) => {
            chk.addEventListener("change", () => {
                const i = parseInt(chk.getAttribute("data-index"), 10);
                arrayRef[i].blockAsNxDomain = chk.checked;
                markDirty();
            });
        });

        container.querySelectorAll(".url-entry-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                arrayRef.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                markDirty();
                renderUrlEntryList(containerId, arrayRef);
            });
        });

        container.querySelector(".url-entry-add").addEventListener("click", () => {
            arrayRef.push("");
            markDirty();
            renderUrlEntryList(containerId, arrayRef);
        });
    }

    // ---- group editor ----

    function openGroupEditor(index) {
        currentGroupIndex = index;
        document.getElementById("configListView").style.display = "none";
        document.getElementById("configGroupEditorView").style.display = "block";
        renderGroupEditor();
    }

    function closeGroupEditor() {
        currentGroupIndex = -1;
        document.getElementById("configGroupEditorView").style.display = "none";
        document.getElementById("configListView").style.display = "block";
        renderGroupsList();
        renderEndpointMap();
        renderNetworkMap();
    }

    function renderGroupEditor() {
        const g = config.groups[currentGroupIndex];
        const editorEl = document.getElementById("configGroupEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Edit Group</h3></div>
                <div class="panel-body">
                    <button id="btnGroupBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Groups</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="grpName" /></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="grpEnableBlocking" /> Enable Blocking for this group</label></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="grpAllowTxt" /> Allow TXT Blocking Report</label></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="grpBlockAsNxDomain" /> Block as NXDOMAIN (instead of returning blocking addresses)</label></div>
                        </div>
                    </div>

                    <h4>Blocking Addresses</h4>
                    <div id="grpBlockingAddresses"></div>

                    <h4>Allowed Domains</h4>
                    <div id="grpAllowed"></div>

                    <h4>Blocked Domains</h4>
                    <div id="grpBlocked"></div>

                    <h4>Allow List URLs</h4>
                    <div id="grpAllowListUrls"></div>

                    <h4>Block List URLs</h4>
                    <div id="grpBlockListUrls"></div>

                    <h4>Allowed Regex Patterns</h4>
                    <div id="grpAllowedRegex"></div>

                    <h4>Blocked Regex Patterns</h4>
                    <div id="grpBlockedRegex"></div>

                    <h4>Regex Allow List URLs</h4>
                    <div id="grpRegexAllowListUrls"></div>

                    <h4>Regex Block List URLs</h4>
                    <div id="grpRegexBlockListUrls"></div>

                    <h4>AdBlock List URLs</h4>
                    <div id="grpAdblockListUrls"></div>
                </div>
            </div>
        `;

        document.getElementById("btnGroupBack").addEventListener("click", closeGroupEditor);

        const nameInput = document.getElementById("grpName");
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

            Object.keys(config.localEndPointGroupMap).forEach((k) => {
                if (config.localEndPointGroupMap[k] === g.name) config.localEndPointGroupMap[k] = newName;
            });
            Object.keys(config.networkGroupMap).forEach((k) => {
                if (config.networkGroupMap[k] === g.name) config.networkGroupMap[k] = newName;
            });

            g.name = newName;
            markDirty();
        });

        document.getElementById("grpEnableBlocking").checked = g.enableBlocking;
        document.getElementById("grpEnableBlocking").addEventListener("change", (e) => { g.enableBlocking = e.target.checked; markDirty(); });

        document.getElementById("grpAllowTxt").checked = g.allowTxtBlockingReport;
        document.getElementById("grpAllowTxt").addEventListener("change", (e) => { g.allowTxtBlockingReport = e.target.checked; markDirty(); });

        document.getElementById("grpBlockAsNxDomain").checked = g.blockAsNxDomain;
        document.getElementById("grpBlockAsNxDomain").addEventListener("change", (e) => { g.blockAsNxDomain = e.target.checked; markDirty(); });

        renderStringList("grpBlockingAddresses", g.blockingAddresses, "0.0.0.0 or ::");
        renderStringList("grpAllowed", g.allowed, "domain.example.com");
        renderStringList("grpBlocked", g.blocked, "domain.example.com");
        renderStringList("grpAllowListUrls", g.allowListUrls, "https://example.com/allow.txt");
        renderUrlEntryList("grpBlockListUrls", g.blockListUrls);
        renderStringList("grpAllowedRegex", g.allowedRegex, "regex pattern");
        renderStringList("grpBlockedRegex", g.blockedRegex, "regex pattern");
        renderStringList("grpRegexAllowListUrls", g.regexAllowListUrls, "https://example.com/regex-allow.txt");
        renderUrlEntryList("grpRegexBlockListUrls", g.regexBlockListUrls);
        renderUrlEntryList("grpAdblockListUrls", g.adblockListUrls);
    }
})();
