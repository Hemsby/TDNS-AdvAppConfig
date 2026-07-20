window.initGeoGroupApp = function (opts) {
    "use strict";

    const pane = document.getElementById(opts.paneId);
    const root = document.getElementById(opts.configRootId);
    const recordsRoot = document.getElementById(opts.recordsRootId);
    const p = opts.idPrefix;

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "records";

    let records = [];
    let zones = [];
    let defaultRecordTtl = 3600;
    let recordsLoaded = false;
    let editingIndex = -1;
    let editBuffer = null;
    let editOriginalDomain = null;
    let editOriginalZone = null;

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById(p + "ConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById(p + "ConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function groupNames() {
        return Object.keys(config.groups);
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};
        if (typeof raw.groups !== "object" || raw.groups === null) raw.groups = {};
        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch(opts.apiBase + "/config/raw");
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
            const res = await apiFetch(opts.apiBase + "/config/raw", {
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
        pane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        pane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        pane.querySelectorAll(".tab-content > .tab-pane").forEach((tp) => tp.classList.remove("active"));

        pane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? p + "TabPaneConfig" : p + "TabPaneRecords").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
        else if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== opts.tabKey) return;
        switchSubTab(currentSubTab);
    });

    document.addEventListener("authenticated", () => {
        if (loaded && !dirty) load();
        if (recordsLoaded) loadRecords();
    });

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default action-bar-sticky">
                <div class="panel-body">
                    <div class="group-row">
                        <div><span id="${p}ConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btn${p}ConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btn${p}ConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Groups</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Reusable named collections of ${escapeHtml(opts.keyNoun)} codes or ASNs (e.g. "AS1234"), referenced by name from APP records' data - lets one record entry stand in for several ${escapeHtml(opts.keyNoun)}s at once.</p>
                    <div id="${p}GroupsContainer"></div>
                    <button id="btn${p}AddGroup" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Group</button>
                </div>
            </div>
        `;

        document.getElementById(`btn${p}ConfigSave`).addEventListener("click", save);
        document.getElementById(`btn${p}ConfigDiscard`).addEventListener("click", discard);
        document.getElementById(`btn${p}AddGroup`).addEventListener("click", addGroup);

        renderGroups();
    }

    function renderGroups() {
        const container = document.getElementById(`${p}GroupsContainer`);
        const names = Object.keys(config.groups);

        if (names.length === 0) {
            container.innerHTML = '<p class="text-muted">No groups configured.</p>';
            return;
        }

        container.innerHTML = names.map((name) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm group-name" data-orig-name="${escapeHtml(name)}" value="${escapeHtml(name)}" style="flex:1; margin-right:8px; font-weight:600;" />
                <button class="btn btn-danger btn-xs group-remove" data-name="${escapeHtml(name)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="${p}GroupCodes-${escapeHtml(name)}"></div>
        </div>`).join("");

        names.forEach((name) => {
            AppHelpers.renderStringList(`${p}GroupCodes-${name}`, config.groups[name], opts.codePlaceholder, markDirty);
        });

        container.querySelectorAll(".group-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldName = inp.getAttribute("data-orig-name");
                const newName = inp.value.trim();

                if (newName === oldName) return;

                if (newName === "") {
                    inp.value = oldName;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(config.groups, newName)) {
                    await uiAlert(`A group called "${newName}" already exists.`);
                    inp.value = oldName;
                    return;
                }

                config.groups[newName] = config.groups[oldName];
                delete config.groups[oldName];
                markDirty();
                renderGroups();
            });
        });

        container.querySelectorAll(".group-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const name = btn.getAttribute("data-name");
                if (!(await uiConfirm(`Delete group "${name}"? Any APP record still referencing it by name will simply stop matching.`))) return;

                delete config.groups[name];
                markDirty();
                renderGroups();
            });
        });
    }

    async function addGroup() {
        let name = await uiPrompt("New group name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (Object.prototype.hasOwnProperty.call(config.groups, name)) {
            await uiAlert(`A group called "${name}" already exists.`);
            return;
        }

        config.groups[name] = [];
        markDirty();
        renderGroups();
    }

    function onRecordsTabActivated() {
        if (!recordsLoaded) {
            recordsLoaded = true;
            loadRecords();
        }
    }

    async function loadRecords() {
        recordsRoot.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch(opts.apiBase + "/records");
            const data = await res.json();
            if (!data.success) {
                recordsRoot.innerHTML = `<p class="text-danger">Failed to load records: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            records = data.records || [];
            zones = data.zones || [];
            if (data.defaultTtl) defaultRecordTtl = data.defaultTtl;
            editingIndex = -1;
            editBuffer = null;
            renderRecordsRoot();
        } catch (err) {
            recordsRoot.innerHTML = `<p class="text-danger">Failed to load records: ${escapeHtml(err.message)}</p>`;
        }
    }

    async function fetchGroupNames() {
        if (config && config.groups) return Object.keys(config.groups);

        try {
            const res = await apiFetch(opts.apiBase + "/config/raw");
            const data = await res.json();
            if (data.success && data.config && data.config.groups && typeof data.config.groups === "object")
                return Object.keys(data.config.groups);
        } catch {
        }

        return [];
    }

    function classPathLabel(classPath) {
        return classPath === opts.classPathCname ? "CNAME" : "Address";
    }

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="${p}RecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">${escapeHtml(opts.appLabel)} APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">APP records serve different A/AAAA or CNAME answers depending on the client's ${escapeHtml(opts.keyNoun)}. Add one per domain that needs ${escapeHtml(opts.keyNoun)}-based behavior.</p>
                        <div id="${p}RecordsContainer" class="list-group"></div>
                        <button id="btn${p}AddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="${p}RecordEditorView" style="display:none;"></div>
        `;

        document.getElementById(`btn${p}AddRecord`).addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById(`${p}RecordsContainer`);

        if (records.length === 0) {
            container.innerHTML = `<p class="text-muted">No ${escapeHtml(opts.appLabel)} APP records found in any writable zone.</p>`;
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops ${opts.appLabel} responses for it.`))) return;

                try {
                    const res = await apiFetch(opts.apiBase + "/records/delete", {
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

    function relativeNameFor(domain, zone) {
        if (domain === zone) return "";

        const suffix = "." + zone;
        if (domain.length > suffix.length && domain.toLowerCase().endsWith(suffix.toLowerCase()))
            return domain.slice(0, domain.length - suffix.length);

        return domain;
    }

    function openRecordEditor(index) {
        editingIndex = index;

        if (index === -1) {
            const zone = zones[0] || "";
            editBuffer = { name: "", domain: zone, zone, classPath: opts.classPathAddress, ttl: defaultRecordTtl, data: {} };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                classPath: rec.classPath,
                ttl: rec.ttl,
                data: rec.data && typeof rec.data === "object" ? JSON.parse(JSON.stringify(rec.data)) : {}
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById(`${p}RecordsListView`).style.display = "none";
        document.getElementById(`${p}RecordEditorView`).style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById(`${p}RecFullName`);
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    async function renderRecordEditor() {
        const editorEl = document.getElementById(`${p}RecordEditorView`);

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btn${p}RecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="${p}RecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="${p}RecName" placeholder="e.g. example - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="${p}RecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Record Type</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="${p}RecClassPath">
                                    <option value="${opts.classPathAddress}" ${editBuffer.classPath === opts.classPathAddress ? "selected" : ""}>Address (A/AAAA)</option>
                                    <option value="${opts.classPathCname}" ${editBuffer.classPath === opts.classPathCname ? "selected" : ""}>CNAME</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="${p}RecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <h4>${escapeHtml(opts.keyLabel)} &rarr; Response Mapping</h4>
                    <p class="text-muted">Order doesn't matter - the app matches whichever entry fits the client's ASN, ${escapeHtml(opts.keyNoun)}, or group, falling back to "default" if nothing matches.</p>
                    <div id="${p}RecDataContainer"></div>

                    <div id="${p}RecAddEntryForm" class="well well-sm" style="display:none; margin-top:8px;">
                        <div class="form-group" style="margin-bottom:8px;">
                            <label>Match On</label>
                            <select class="form-control input-sm" id="${p}RecEntryType">
                                <option value="code">${escapeHtml(opts.keyLabel)}</option>
                                <option value="asn">Autonomous System Number (ASN)</option>
                                <option value="group" id="${p}RecEntryGroupOption" style="display:none;">Group (App Config)</option>
                                <option value="default">Default (fallback)</option>
                            </select>
                        </div>
                        <div class="form-group" id="${p}RecEntryCodeGroup" style="margin-bottom:8px;">
                            <select class="form-control input-sm" id="${p}RecEntryCodeSelect">
                                ${opts.codeOptions.map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`).join("")}
                            </select>
                        </div>
                        <div class="form-group" id="${p}RecEntryAsnGroup" style="display:none; margin-bottom:8px;">
                            <input type="text" class="form-control input-sm" id="${p}RecEntryAsnInput" placeholder="e.g. AS1234" />
                        </div>
                        <div class="form-group" id="${p}RecEntryGroupGroup" style="display:none; margin-bottom:8px;">
                            <select class="form-control input-sm" id="${p}RecEntryGroupSelect"></select>
                        </div>
                        <button class="btn btn-primary btn-xs" id="btn${p}RecEntryConfirm">Add This Rule</button>
                        <button class="btn btn-default btn-xs" id="btn${p}RecEntryCancel">Cancel</button>
                    </div>
                    <button id="btn${p}RecAddEntry" class="btn btn-default btn-xs"><span class="fa fa-plus"></span> Add a Rule</button>

                    <div style="margin-top:16px;">
                        <button id="btn${p}RecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById(`btn${p}RecordBack`).addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById(`${p}RecZone`);
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById(`${p}RecName`);
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const classPathSelect = document.getElementById(`${p}RecClassPath`);
        classPathSelect.addEventListener("change", async (e) => {
            const newClassPath = e.target.value;

            if (Object.keys(editBuffer.data).length > 0) {
                if (!(await uiConfirm("Switching the record type clears the entries below. Continue?"))) {
                    classPathSelect.value = editBuffer.classPath;
                    return;
                }
                editBuffer.data = {};
            }

            editBuffer.classPath = newClassPath;
            renderRecordDataEditor();
        });

        const ttlInput = document.getElementById(`${p}RecTtl`);
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById(`btn${p}RecSave`).addEventListener("click", saveRecord);

        await initAddEntryForm();
        renderRecordDataEditor();
    }

    let groupNamesCache = [];

    async function initAddEntryForm() {
        groupNamesCache = await fetchGroupNames();

        const groupOption = document.getElementById(`${p}RecEntryGroupOption`);
        const groupSelect = document.getElementById(`${p}RecEntryGroupSelect`);

        if (groupNamesCache.length > 0) {
            groupOption.style.display = "block";
            groupSelect.innerHTML = groupNamesCache.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
        }

        const typeSelect = document.getElementById(`${p}RecEntryType`);
        const codeGroup = document.getElementById(`${p}RecEntryCodeGroup`);
        const asnGroup = document.getElementById(`${p}RecEntryAsnGroup`);
        const groupGroup = document.getElementById(`${p}RecEntryGroupGroup`);
        const formEl = document.getElementById(`${p}RecAddEntryForm`);
        const addBtn = document.getElementById(`btn${p}RecAddEntry`);

        function updateVisibility() {
            codeGroup.style.display = typeSelect.value === "code" ? "block" : "none";
            asnGroup.style.display = typeSelect.value === "asn" ? "block" : "none";
            groupGroup.style.display = typeSelect.value === "group" ? "block" : "none";
        }

        typeSelect.addEventListener("change", updateVisibility);
        updateVisibility();

        addBtn.addEventListener("click", () => {
            formEl.style.display = "block";
            addBtn.style.display = "none";
        });

        document.getElementById(`btn${p}RecEntryCancel`).addEventListener("click", () => {
            formEl.style.display = "none";
            addBtn.style.display = "inline-block";
        });

        document.getElementById(`btn${p}RecEntryConfirm`).addEventListener("click", confirmAddEntry);
    }

    async function confirmAddEntry() {
        const type = document.getElementById(`${p}RecEntryType`).value;
        let key = "";

        if (type === "code") key = document.getElementById(`${p}RecEntryCodeSelect`).value;
        else if (type === "asn") key = document.getElementById(`${p}RecEntryAsnInput`).value.trim();
        else if (type === "group") key = document.getElementById(`${p}RecEntryGroupSelect`).value;
        else if (type === "default") key = "default";

        if (!key) {
            await uiAlert("Enter a value first.");
            return;
        }

        if (Object.prototype.hasOwnProperty.call(editBuffer.data, key)) {
            await uiAlert("There's already a rule for that.");
            return;
        }

        editBuffer.data[key] = editBuffer.classPath === opts.classPathCname ? "" : [""];

        document.getElementById(`${p}RecAddEntryForm`).style.display = "none";
        document.getElementById(`btn${p}RecAddEntry`).style.display = "inline-block";
        document.getElementById(`${p}RecEntryAsnInput`).value = "";

        renderRecordDataEditor();
    }

    function renderRecordDataEditor() {
        if (editBuffer.classPath === opts.classPathCname)
            renderRecordCnameData();
        else
            renderRecordAddressData();
    }

    function keyLabelFor(key) {
        const found = opts.codeOptions.find((c) => c.code === key);
        if (found) return `${found.label} (${key})`;
        if (key === "default") return "Default (fallback)";
        return key;
    }

    function renderRecordAddressData() {
        const container = document.getElementById(`${p}RecDataContainer`);
        const keys = Object.keys(editBuffer.data);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No rules yet - add one below.</p>';
            return;
        }

        container.innerHTML = keys.map((key) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <span class="group-name">${escapeHtml(keyLabelFor(key))}</span>
                <button class="btn btn-danger btn-xs rec-data-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button>
            </div>
            <div id="${p}RecAddr-${escapeHtml(key)}"></div>
        </div>`).join("");

        keys.forEach((key) => {
            if (!Array.isArray(editBuffer.data[key])) editBuffer.data[key] = [];
            AppHelpers.renderStringList(`${p}RecAddr-${key}`, editBuffer.data[key], "e.g. 192.168.1.10", () => { });
        });

        container.querySelectorAll(".rec-data-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete editBuffer.data[btn.getAttribute("data-key")];
                renderRecordDataEditor();
            });
        });
    }

    function renderRecordCnameData() {
        const container = document.getElementById(`${p}RecDataContainer`);
        const keys = Object.keys(editBuffer.data);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No rules yet - add one below.</p>';
            return;
        }

        container.innerHTML = `<table class="table table-hover table-condensed">
            <thead><tr><th>Who</th><th>Redirect To This Domain</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${keys.map((key) => `<tr>
                    <td>${escapeHtml(keyLabelFor(key))}</td>
                    <td><input type="text" class="form-control input-sm rec-cname-value" data-key="${escapeHtml(key)}" value="${escapeHtml(editBuffer.data[key] || "")}" placeholder="e.g. target.example.com" /></td>
                    <td><button class="btn btn-danger btn-xs rec-data-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".rec-cname-value").forEach((inp) => {
            inp.addEventListener("input", () => {
                editBuffer.data[inp.getAttribute("data-key")] = inp.value;
            });
        });

        container.querySelectorAll(".rec-data-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete editBuffer.data[btn.getAttribute("data-key")];
                renderRecordDataEditor();
            });
        });
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }
        if (Object.keys(editBuffer.data).length === 0) { await uiAlert("Add at least one rule."); return; }

        const saveBtn = document.getElementById(`btn${p}RecSave`);
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch(opts.apiBase + "/records/delete", {
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

            const res = await apiFetch(opts.apiBase + "/records", {
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
};
