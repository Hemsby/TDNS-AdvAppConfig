(function () {
    "use strict";

    const wimdPane = document.getElementById("mainTabPaneWhatIsMyDns");
    const recordsRoot = document.getElementById("whatIsMyDnsRecordsRoot");

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
        wimdPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        wimdPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        wimdPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        wimdPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "wimdTabPaneConfig" : "wimdTabPaneRecords").classList.add("active");

        if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "whatismydns") return;
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
            const res = await apiFetch("/api/whatismydns/records");
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
            <div id="wimdRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">What Is My Dns APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Add one at the name clients should query to see their own IP address reflected back - handy as a quick "am I using this DNS server" check.</p>
                        <div id="wimdRecordsContainer" class="list-group"></div>
                        <button id="btnWimdAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="wimdRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnWimdAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("wimdRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No What Is My Dns APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops What Is My Dns responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/whatismydns/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, ttl: defaultRecordTtl };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                ttl: rec.ttl
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("wimdRecordsListView").style.display = "none";
        document.getElementById("wimdRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("wimdRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("wimdRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnWimdRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="wimdRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="wimdRecName" placeholder="e.g. whatismydns - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="wimdRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="wimdRecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <p class="text-muted">No other configuration needed - querying this name for A, AAAA, or TXT returns the querying client's own IP address.</p>

                    <div style="margin-top:16px;">
                        <button id="btnWimdRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnWimdRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("wimdRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("wimdRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const ttlInput = document.getElementById("wimdRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById("btnWimdRecSave").addEventListener("click", saveRecord);
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }

        const saveBtn = document.getElementById("btnWimdRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/whatismydns/records/delete", {
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

            const res = await apiFetch("/api/whatismydns/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain, zone: editBuffer.zone, ttl: editBuffer.ttl })
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
