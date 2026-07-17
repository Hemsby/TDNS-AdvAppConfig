(function () {
    "use strict";

    const dnsblPane = document.getElementById("mainTabPaneDnsBlockList");
    const root = document.getElementById("dnsBlockListConfigRoot");
    const recordsRoot = document.getElementById("dnsBlockListRecordsRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "records";

    const BLOCK_LIST_TYPES = ["Ip", "Domain"];

    let records = [];
    let zones = [];
    let defaultRecordTtl = 3600;
    let recordsLoaded = false;
    let editingIndex = -1;
    let editBuffer = null;
    let editOriginalDomain = null;
    let editOriginalZone = null;
    let availableListsCache = [];

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("dnsblConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("dnsblConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function blockListNames() {
        return config.dnsBlockLists.map((b) => b.name);
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};
        if (!Array.isArray(raw.dnsBlockLists)) raw.dnsBlockLists = [];

        raw.dnsBlockLists.forEach((b) => {
            if (typeof b.type !== "string") b.type = "Ip";
            if (typeof b.enabled !== "boolean") b.enabled = true;
            if (typeof b.responseA !== "string" || b.responseA === "") b.responseA = "127.0.0.2";
            if (typeof b.responseTXT === "undefined") b.responseTXT = "";
            if (typeof b.blockListFile !== "string") b.blockListFile = "";
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/dnsblocklist/config/raw");
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
            const res = await apiFetch("/api/dnsblocklist/config/raw", {
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
        dnsblPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        dnsblPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        dnsblPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        dnsblPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "dnsblTabPaneConfig" : "dnsblTabPaneRecords").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
        else if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "dnsblocklist") return;
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
                        <div><span id="dnsblConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnDnsblConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnDnsblConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">DNS Block Lists</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Defines named block lists here only - add one to a domain from the Records tab to actually apply it.</p>
                    <div id="dnsblListsContainer"></div>
                    <button id="btnDnsblAddList" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Block List</button>
                </div>
            </div>
        `;

        document.getElementById("btnDnsblConfigSave").addEventListener("click", save);
        document.getElementById("btnDnsblConfigDiscard").addEventListener("click", discard);
        document.getElementById("btnDnsblAddList").addEventListener("click", addBlockList);

        renderLists();
    }

    function renderLists() {
        const container = document.getElementById("dnsblListsContainer");

        if (config.dnsBlockLists.length === 0) {
            container.innerHTML = '<p class="text-muted">No block lists configured.</p>';
            return;
        }

        container.innerHTML = config.dnsBlockLists.map((b, idx) => {
            const placeholder = (b.type || "").toLowerCase() === "domain" ? "e.g. https://example.com/dnsbl?domain={domain}" : "e.g. https://example.com/dnsbl?ip={ip}";

            return `<div class="well well-sm" style="margin-bottom:8px;">
                <div class="group-row" style="margin-bottom:8px;">
                    <input type="text" class="form-control input-sm list-name" data-index="${idx}" value="${escapeHtml(b.name)}" style="flex:1; margin-right:8px; font-weight:600;" />
                    <button class="btn btn-danger btn-xs list-remove" data-index="${idx}"><span class="fa fa-trash"></span></button>
                </div>
                <div class="form-horizontal">
                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Type</label>
                        <div class="col-sm-9">
                            <select class="form-control input-sm list-type" data-index="${idx}">
                                ${BLOCK_LIST_TYPES.map((t) => `<option value="${t}" ${t.toLowerCase() === (b.type || "").toLowerCase() ? "selected" : ""}>${t}</option>`).join("")}
                            </select>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:6px;">
                        <div class="col-sm-9 col-sm-offset-3">
                            <label style="font-weight:normal;"><input type="checkbox" class="list-enabled" data-index="${idx}" ${b.enabled ? "checked" : ""} /> Enabled</label>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Response A</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm list-responseA" data-index="${idx}" value="${escapeHtml(b.responseA)}" placeholder="127.0.0.2" /></div>
                    </div>
                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Response TXT</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm list-responseTXT" data-index="${idx}" value="${escapeHtml(b.responseTXT)}" placeholder="${placeholder}" /></div>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Block List File</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm list-file" data-index="${idx}" value="${escapeHtml(b.blockListFile)}" placeholder="ip-blocklist.txt" /></div>
                    </div>
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll(".list-type").forEach((sel) => {
            sel.addEventListener("change", () => {
                config.dnsBlockLists[parseInt(sel.getAttribute("data-index"), 10)].type = sel.value;
                markDirty();
                renderLists();
            });
        });
        container.querySelectorAll(".list-enabled").forEach((chk) => {
            chk.addEventListener("change", () => { config.dnsBlockLists[parseInt(chk.getAttribute("data-index"), 10)].enabled = chk.checked; markDirty(); });
        });
        container.querySelectorAll(".list-responseA").forEach((inp) => {
            inp.addEventListener("input", () => { config.dnsBlockLists[parseInt(inp.getAttribute("data-index"), 10)].responseA = inp.value; markDirty(); });
        });
        container.querySelectorAll(".list-responseTXT").forEach((inp) => {
            inp.addEventListener("input", () => { config.dnsBlockLists[parseInt(inp.getAttribute("data-index"), 10)].responseTXT = inp.value; markDirty(); });
        });
        container.querySelectorAll(".list-file").forEach((inp) => {
            inp.addEventListener("input", () => { config.dnsBlockLists[parseInt(inp.getAttribute("data-index"), 10)].blockListFile = inp.value; markDirty(); });
        });

        container.querySelectorAll(".list-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const idx = parseInt(inp.getAttribute("data-index"), 10);
                const newName = inp.value.trim();
                const oldName = config.dnsBlockLists[idx].name;

                if (newName === "") { inp.value = oldName; return; }
                if (newName === oldName) return;

                if (blockListNames().some((n, i) => i !== idx && n === newName)) {
                    await uiAlert(`A block list called "${newName}" already exists.`);
                    inp.value = oldName;
                    return;
                }

                config.dnsBlockLists[idx].name = newName;
                markDirty();
            });
        });

        container.querySelectorAll(".list-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                if (!(await uiConfirm(`Delete block list "${config.dnsBlockLists[idx].name}"? Any APP record still referencing it by name will simply stop matching.`))) return;

                config.dnsBlockLists.splice(idx, 1);
                markDirty();
                renderLists();
            });
        });
    }

    async function addBlockList() {
        let name = await uiPrompt("Block list name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (blockListNames().includes(name)) {
            await uiAlert(`A block list called "${name}" already exists.`);
            return;
        }

        config.dnsBlockLists.push({ name, type: "Ip", enabled: true, responseA: "127.0.0.2", responseTXT: "", blockListFile: "" });
        markDirty();
        renderLists();
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
            const res = await apiFetch("/api/dnsblocklist/records");
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

    async function fetchBlockListNames() {
        if (config && Array.isArray(config.dnsBlockLists)) return blockListNames();

        try {
            const res = await apiFetch("/api/dnsblocklist/config/raw");
            const data = await res.json();
            if (data.success && data.config && Array.isArray(data.config.dnsBlockLists))
                return data.config.dnsBlockLists.map((b) => b.name).filter((n) => typeof n === "string" && n !== "");
        } catch {
        }

        return [];
    }

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="dnsblRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">DNS Block List APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">APP records apply named block lists (defined on the Config tab) to a domain. Add one per domain that should be checked against a DNSBL.</p>
                        <div id="dnsblRecordsContainer" class="list-group"></div>
                        <button id="btnDnsblAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="dnsblRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnDnsblAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("dnsblRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No DNS Block List APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            const lists = (rec.data && Array.isArray(rec.data.dnsBlockLists)) ? rec.data.dnsBlockLists : [];
            const listsBadge = lists.length > 0
                ? `<span class="label label-info">${lists.map(escapeHtml).join(", ")}</span>`
                : '<span class="label label-danger">no block lists</span>';

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> ${listsBadge} ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops DNSBL responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/dnsblocklist/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, ttl: defaultRecordTtl, dnsBlockLists: [] };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            const lists = (rec.data && Array.isArray(rec.data.dnsBlockLists)) ? rec.data.dnsBlockLists.slice() : [];

            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                ttl: rec.ttl,
                dnsBlockLists: lists
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("dnsblRecordsListView").style.display = "none";
        document.getElementById("dnsblRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("dnsblRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    async function renderRecordEditor() {
        const editorEl = document.getElementById("dnsblRecordEditorView");
        availableListsCache = await fetchBlockListNames();

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnDnsblRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="dnsblRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="dnsblRecName" placeholder="e.g. example - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="dnsblRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="dnsblRecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <h4>Block Lists</h4>
                    <p class="text-muted">Checked in the order added; the first list this domain (or address, for an IP list) matches wins. Remove and re-add an entry to move it to the end.</p>
                    <div id="dnsblRecListsContainer"></div>

                    <div style="margin-top:16px;">
                        <button id="btnDnsblRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnDnsblRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("dnsblRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("dnsblRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const ttlInput = document.getElementById("dnsblRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        AppHelpers.renderBadgePicker("dnsblRecListsContainer", editBuffer.dnsBlockLists, () => availableListsCache, () => { }, {
            emptyText: "No block lists selected yet.",
            noOptionsText: "No block lists are defined yet - add one on the Config tab first."
        });

        document.getElementById("btnDnsblRecSave").addEventListener("click", saveRecord);
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }
        if (editBuffer.dnsBlockLists.length === 0) { await uiAlert("Select at least one block list."); return; }

        const saveBtn = document.getElementById("btnDnsblRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/dnsblocklist/records/delete", {
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

            const res = await apiFetch("/api/dnsblocklist/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain, zone: editBuffer.zone, ttl: editBuffer.ttl, data: { dnsBlockLists: editBuffer.dnsBlockLists } })
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
