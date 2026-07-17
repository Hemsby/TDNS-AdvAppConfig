(function () {
    "use strict";

    const gdsPane = document.getElementById("mainTabPaneGeoDistance");
    const recordsRoot = document.getElementById("gdsRecordsRoot");

    const CLASS_PATH_ADDRESS = "GeoDistance.Address";
    const CLASS_PATH_CNAME = "GeoDistance.CNAME";

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

    function initSubTabs() {
        gdsPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        gdsPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        gdsPane.querySelectorAll(".tab-content > .tab-pane").forEach((tp) => tp.classList.remove("active"));

        gdsPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "gdsTabPaneConfig" : "gdsTabPaneRecords").classList.add("active");

        if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "geodistance") return;
        switchSubTab(currentSubTab);
    });

    document.addEventListener("authenticated", () => {
        if (recordsLoaded) loadRecords();
    });

    function onRecordsTabActivated() {
        if (!recordsLoaded) {
            recordsLoaded = true;
            loadRecords();
        }
    }

    async function loadRecords() {
        recordsRoot.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/geodistance/records");
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

    function classPathLabel(classPath) {
        return classPath === CLASS_PATH_CNAME ? "CNAME" : "Address";
    }

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="gdsRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Geo Distance APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">APP records return whichever server is geographically closest to the client. Add one per domain that needs distance-based responses.</p>
                        <div id="gdsRecordsContainer" class="list-group"></div>
                        <button id="btnGdsAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="gdsRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnGdsAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("gdsRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No Geo Distance APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            const serverCount = (rec.data && Array.isArray(rec.data)) ? rec.data.length : 0;

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> <span class="label label-info">${classPathLabel(rec.classPath)}</span> <span class="label label-default">${serverCount} server(s)</span> ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops Geo Distance responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/geodistance/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, classPath: CLASS_PATH_ADDRESS, ttl: defaultRecordTtl, data: [] };
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
                data: Array.isArray(rec.data) ? JSON.parse(JSON.stringify(rec.data)) : []
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("gdsRecordsListView").style.display = "none";
        document.getElementById("gdsRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("gdsRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("gdsRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnGdsRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="gdsRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="gdsRecName" placeholder="e.g. example - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="gdsRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Record Type</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="gdsRecClassPath">
                                    <option value="${CLASS_PATH_ADDRESS}" ${editBuffer.classPath === CLASS_PATH_ADDRESS ? "selected" : ""}>Address (A/AAAA)</option>
                                    <option value="${CLASS_PATH_CNAME}" ${editBuffer.classPath === CLASS_PATH_CNAME ? "selected" : ""}>CNAME</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="gdsRecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <h4>Servers</h4>
                    <p class="text-muted">The app answers with whichever server below is geographically closest to the client. Coordinates are decimal degrees (DD), e.g. 19.07283, -0.12574.</p>
                    <div id="gdsRecServersContainer"></div>
                    <button id="btnGdsRecAddServer" class="btn btn-default btn-xs"><span class="fa fa-plus"></span> Add Server</button>

                    <div style="margin-top:16px;">
                        <button id="btnGdsRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnGdsRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("gdsRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("gdsRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const classPathSelect = document.getElementById("gdsRecClassPath");
        classPathSelect.addEventListener("change", async (e) => {
            const newClassPath = e.target.value;

            if (editBuffer.data.length > 0) {
                if (!(await uiConfirm("Switching the record type clears each server's address/CNAME value below. Continue?"))) {
                    classPathSelect.value = editBuffer.classPath;
                    return;
                }
                editBuffer.data.forEach((server) => {
                    delete server.addresses;
                    delete server.cname;
                });
            }

            editBuffer.classPath = newClassPath;
            renderServers();
        });

        const ttlInput = document.getElementById("gdsRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById("btnGdsRecAddServer").addEventListener("click", () => {
            const server = editBuffer.classPath === CLASS_PATH_CNAME
                ? { name: "", lat: "", long: "", cname: "" }
                : { name: "", lat: "", long: "", addresses: [""] };

            editBuffer.data.push(server);
            renderServers();
        });

        document.getElementById("btnGdsRecSave").addEventListener("click", saveRecord);

        renderServers();
    }

    function renderServers() {
        const container = document.getElementById("gdsRecServersContainer");
        const isAddress = editBuffer.classPath !== CLASS_PATH_CNAME;

        if (editBuffer.data.length === 0) {
            container.innerHTML = '<p class="text-muted">No servers yet - add one below.</p>';
            return;
        }

        container.innerHTML = editBuffer.data.map((server, idx) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm gds-server-name" data-index="${idx}" value="${escapeHtml(server.name || "")}" placeholder="Label (e.g. mumbai) - not used for matching" style="flex:1; margin-right:8px;" />
                <button class="btn btn-danger btn-xs gds-server-remove" data-index="${idx}"><span class="fa fa-trash"></span></button>
            </div>
            <div class="form-horizontal" style="margin-bottom:8px;">
                <div class="form-group" style="margin-bottom:6px;">
                    <label class="col-sm-2 control-label" style="font-weight:normal;">Latitude</label>
                    <div class="col-sm-4"><input type="text" class="form-control input-sm gds-server-lat" data-index="${idx}" value="${escapeHtml(server.lat || "")}" placeholder="e.g. 19.07283" /></div>
                    <label class="col-sm-2 control-label" style="font-weight:normal;">Longitude</label>
                    <div class="col-sm-4"><input type="text" class="form-control input-sm gds-server-long" data-index="${idx}" value="${escapeHtml(server.long || "")}" placeholder="e.g. 72.88261" /></div>
                </div>
            </div>
            ${isAddress
                ? `<label style="font-weight:normal;">Addresses</label><div id="gdsServerAddr-${idx}"></div>`
                : `<label style="font-weight:normal;">CNAME Target</label><input type="text" class="form-control input-sm gds-server-cname" data-index="${idx}" value="${escapeHtml(server.cname || "")}" placeholder="e.g. mumbai.example.com" />`
            }
        </div>`).join("");

        container.querySelectorAll(".gds-server-name").forEach((inp) => {
            inp.addEventListener("input", () => { editBuffer.data[parseInt(inp.getAttribute("data-index"), 10)].name = inp.value; });
        });

        container.querySelectorAll(".gds-server-lat").forEach((inp) => {
            inp.addEventListener("input", () => { editBuffer.data[parseInt(inp.getAttribute("data-index"), 10)].lat = inp.value; });
        });

        container.querySelectorAll(".gds-server-long").forEach((inp) => {
            inp.addEventListener("input", () => { editBuffer.data[parseInt(inp.getAttribute("data-index"), 10)].long = inp.value; });
        });

        container.querySelectorAll(".gds-server-cname").forEach((inp) => {
            inp.addEventListener("input", () => { editBuffer.data[parseInt(inp.getAttribute("data-index"), 10)].cname = inp.value; });
        });

        container.querySelectorAll(".gds-server-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                editBuffer.data.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                renderServers();
            });
        });

        if (isAddress) {
            editBuffer.data.forEach((server, idx) => {
                if (!Array.isArray(server.addresses)) server.addresses = [];
                AppHelpers.renderStringList(`gdsServerAddr-${idx}`, server.addresses, "e.g. 1.1.1.1", () => { });
            });
        }
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }
        if (editBuffer.data.length === 0) { await uiAlert("Add at least one server."); return; }

        const saveBtn = document.getElementById("btnGdsRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/geodistance/records/delete", {
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

            const res = await apiFetch("/api/geodistance/records", {
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
