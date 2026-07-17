(function () {
    "use strict";

    const apPane = document.getElementById("mainTabPaneAutoPtr");
    const recordsRoot = document.getElementById("autoPtrRecordsRoot");

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
        apPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        apPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        apPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        apPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "apTabPaneConfig" : "apTabPaneRecords").classList.add("active");

        if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "autoptr") return;
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
            const res = await apiFetch("/api/autoptr/records");
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
            <div id="autoPtrRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Auto PTR APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Add one to a reverse-lookup zone (in-addr.arpa / ip6.arpa) to auto-generate PTR responses instead of creating one by hand for every address.</p>
                        <div id="autoPtrRecordsContainer" class="list-group"></div>
                        <button id="btnAutoPtrAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="autoPtrRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnAutoPtrAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a reverse-lookup zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("autoPtrRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No Auto PTR APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            const d = rec.data && typeof rec.data === "object" ? rec.data : {};
            const summary = `${escapeHtml(d.prefix || "")}&hellip;${escapeHtml(d.ipSeparator || "")}&hellip;${escapeHtml(d.suffix || "")}`;

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> <span class="label label-info">${summary}</span> ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops auto-generated PTR responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/autoptr/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, ttl: defaultRecordTtl, prefix: "", suffix: "", ipSeparator: "" };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            const d = rec.data && typeof rec.data === "object" ? rec.data : {};

            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                ttl: rec.ttl,
                prefix: d.prefix || "",
                suffix: d.suffix || "",
                ipSeparator: d.ipSeparator || ""
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("autoPtrRecordsListView").style.display = "none";
        document.getElementById("autoPtrRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("autoPtrRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("autoPtrRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnAutoPtrRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="autoPtrRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="autoPtrRecName" placeholder="leave blank for the zone apex - the usual choice for a reverse zone" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="autoPtrRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="autoPtrRecTtl" min="0" />
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Prefix</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="autoPtrRecPrefix" placeholder="optional, e.g. host-" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">IP Separator</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="autoPtrRecSeparator" placeholder="optional, e.g. - or ." /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Suffix</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="autoPtrRecSuffix" placeholder="optional, e.g. .example.com" /></div>
                        </div>
                    </div>

                    <p class="text-muted">Generated hostname: prefix + each address byte (decimal for IPv4, hex for IPv6) joined by the separator + suffix. E.g. prefix "host-", separator "-", suffix ".example.com" turns 192.168.1.5 into <code>host-192-168-1-5.example.com</code>.</p>

                    <div style="margin-top:16px;">
                        <button id="btnAutoPtrRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnAutoPtrRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("autoPtrRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("autoPtrRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const ttlInput = document.getElementById("autoPtrRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById("autoPtrRecPrefix").value = editBuffer.prefix;
        document.getElementById("autoPtrRecPrefix").addEventListener("input", (e) => { editBuffer.prefix = e.target.value; });

        document.getElementById("autoPtrRecSeparator").value = editBuffer.ipSeparator;
        document.getElementById("autoPtrRecSeparator").addEventListener("input", (e) => { editBuffer.ipSeparator = e.target.value; });

        document.getElementById("autoPtrRecSuffix").value = editBuffer.suffix;
        document.getElementById("autoPtrRecSuffix").addEventListener("input", (e) => { editBuffer.suffix = e.target.value; });

        document.getElementById("btnAutoPtrRecSave").addEventListener("click", saveRecord);
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }

        const saveBtn = document.getElementById("btnAutoPtrRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/autoptr/records/delete", {
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

            const res = await apiFetch("/api/autoptr/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    domain,
                    zone: editBuffer.zone,
                    ttl: editBuffer.ttl,
                    data: {
                        prefix: editBuffer.prefix || "",
                        suffix: editBuffer.suffix || "",
                        ipSeparator: editBuffer.ipSeparator || ""
                    }
                })
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
