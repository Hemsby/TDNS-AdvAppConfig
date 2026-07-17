(function () {
    "use strict";

    const ndPane = document.getElementById("mainTabPaneNoData");
    const recordsRoot = document.getElementById("noDataRecordsRoot");

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
        ndPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        ndPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        ndPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        ndPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "ndTabPaneConfig" : "ndTabPaneRecords").classList.add("active");

        if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "nodata") return;
        switchSubTab(currentSubTab);
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
            const res = await apiFetch("/api/nodata/records");
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

    document.addEventListener("authenticated", () => {
        if (recordsLoaded) loadRecords();
    });

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="noDataRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">No Data APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Returns NOERROR with no answer for the record types you pick - useful in Conditional Forwarder zones to suppress specific queries instead of letting them fall through.</p>
                        <div id="noDataRecordsContainer" class="list-group"></div>
                        <button id="btnNoDataAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="noDataRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnNoDataAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("noDataRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No "No Data" APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            const types = (rec.data && Array.isArray(rec.data.blockedTypes)) ? rec.data.blockedTypes : [];
            const typesBadge = types.length > 0
                ? `<span class="label label-info">${types.map(escapeHtml).join(", ")}</span>`
                : '<span class="label label-danger">no types</span>';

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> ${typesBadge} ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops NODATA responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/nodata/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, ttl: defaultRecordTtl, blockedTypes: ["A", "AAAA"] };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            const types = (rec.data && Array.isArray(rec.data.blockedTypes)) ? rec.data.blockedTypes.slice() : [];

            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                ttl: rec.ttl,
                blockedTypes: types
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("noDataRecordsListView").style.display = "none";
        document.getElementById("noDataRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("noDataRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("noDataRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnNoDataRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="noDataRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="noDataRecName" placeholder="e.g. example - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="noDataRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="noDataRecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <h4>Blocked Record Types</h4>
                    <p class="text-muted">A query for any of these types gets NOERROR with no answer instead of its real answer. "ANY" covers every type in one entry.</p>
                    <div id="noDataRecTypesContainer"></div>

                    <div style="margin-top:16px;">
                        <button id="btnNoDataRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnNoDataRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("noDataRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("noDataRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const ttlInput = document.getElementById("noDataRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById("btnNoDataRecSave").addEventListener("click", saveRecord);

        renderTypesList();
    }

    function renderTypesList() {
        AppHelpers.renderBadgePicker("noDataRecTypesContainer", editBuffer.blockedTypes, () => AppHelpers.RECORD_TYPES, () => { }, {
            emptyText: "No types selected yet - add one below.",
            addLabel: "Add Type"
        });
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }
        if (editBuffer.blockedTypes.length === 0) { await uiAlert("Select at least one record type."); return; }

        const saveBtn = document.getElementById("btnNoDataRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/nodata/records/delete", {
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

            const res = await apiFetch("/api/nodata/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain, zone: editBuffer.zone, ttl: editBuffer.ttl, data: { blockedTypes: editBuffer.blockedTypes } })
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
