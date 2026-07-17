(function () {
    "use strict";

    const CLASS_PATH_ADDRESS = "WeightedRoundRobin.Address";
    const CLASS_PATH_CNAME = "WeightedRoundRobin.CNAME";

    const wrrPane = document.getElementById("mainTabPaneWeightedRoundRobin");
    const recordsRoot = document.getElementById("weightedRoundRobinRecordsRoot");

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
        wrrPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        wrrPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        wrrPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        wrrPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "wrrTabPaneConfig" : "wrrTabPaneRecords").classList.add("active");

        if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "weightedroundrobin") return;
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
            const res = await apiFetch("/api/weightedroundrobin/records");
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

    function classPathLabel(classPath) {
        return classPath === CLASS_PATH_CNAME ? "CNAME" : "Address";
    }

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="wrrRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Weighted Round Robin APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Add one per domain that should return a randomly-weighted A/AAAA or CNAME answer from a set of candidates.</p>
                        <div id="wrrRecordsContainer" class="list-group"></div>
                        <button id="btnWrrAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="wrrRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnWrrAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("wrrRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No Weighted Round Robin APP records found in any writable zone.</p>';
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops Weighted Round Robin responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/weightedroundrobin/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, classPath: CLASS_PATH_ADDRESS, ttl: defaultRecordTtl, data: {} };
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

        document.getElementById("wrrRecordsListView").style.display = "none";
        document.getElementById("wrrRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("wrrRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("wrrRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnWrrRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="wrrRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="wrrRecName" placeholder="e.g. www - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="wrrRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Record Type</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="wrrRecClassPath">
                                    <option value="${CLASS_PATH_ADDRESS}" ${editBuffer.classPath === CLASS_PATH_ADDRESS ? "selected" : ""}>Address (A/AAAA)</option>
                                    <option value="${CLASS_PATH_CNAME}" ${editBuffer.classPath === CLASS_PATH_CNAME ? "selected" : ""}>CNAME</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="wrrRecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <div id="wrrRecDataContainer"></div>

                    <div style="margin-top:16px;">
                        <button id="btnWrrRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnWrrRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("wrrRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("wrrRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const classPathSelect = document.getElementById("wrrRecClassPath");
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

        const ttlInput = document.getElementById("wrrRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        document.getElementById("btnWrrRecSave").addEventListener("click", saveRecord);

        renderRecordDataEditor();
    }

    function renderRecordDataEditor() {
        const container = document.getElementById("wrrRecDataContainer");
        const d = editBuffer.data;

        if (editBuffer.classPath === CLASS_PATH_CNAME) {
            if (!Array.isArray(d.cnames)) d.cnames = [];

            container.innerHTML = `
                <h4>Weighted CNAME Targets</h4>
                <p class="text-muted">One is chosen at random on each query, in proportion to its weight relative to the others. A disabled entry is never selected.</p>
                <div id="wrrCnamesList"></div>
            `;

            renderWeightedList("wrrCnamesList", d.cnames, "domain", "e.g. target.example.com");
        } else {
            if (!Array.isArray(d.ipv4Addresses)) d.ipv4Addresses = [];
            if (!Array.isArray(d.ipv6Addresses)) d.ipv6Addresses = [];

            container.innerHTML = `
                <h4>Weighted IPv4 Addresses</h4>
                <p class="text-muted">Answers an A query. One is chosen at random on each query, in proportion to its weight relative to the others. A disabled entry is never selected.</p>
                <div id="wrrIpv4List"></div>

                <h4 style="margin-top:16px;">Weighted IPv6 Addresses</h4>
                <p class="text-muted">Answers an AAAA query, same weighting rule as above.</p>
                <div id="wrrIpv6List"></div>
            `;

            renderWeightedList("wrrIpv4List", d.ipv4Addresses, "address", "e.g. 192.0.2.1");
            renderWeightedList("wrrIpv6List", d.ipv6Addresses, "address", "e.g. 2001:db8::1");
        }
    }

    function renderWeightedList(containerId, arrayRef, valueField, valuePlaceholder) {
        const container = document.getElementById(containerId);

        function redraw() {
            if (arrayRef.length === 0) {
                container.innerHTML = `<p class="text-muted">No entries yet.</p><button class="btn btn-default btn-xs wl-add">+ Add Entry</button>`;
                container.querySelector(".wl-add").addEventListener("click", () => {
                    arrayRef.push({ [valueField]: "", weight: 1, enabled: true });
                    redraw();
                });
                return;
            }

            container.innerHTML = `
                <table class="table table-hover table-condensed">
                    <thead><tr><th>Value</th><th style="width:100px;">Weight</th><th style="width:80px;">Enabled</th><th style="width:40px;"></th></tr></thead>
                    <tbody>
                        ${arrayRef.map((entry, i) => `<tr>
                            <td><input type="text" class="form-control input-sm wl-value" data-index="${i}" value="${escapeHtml(entry[valueField] || "")}" placeholder="${escapeHtml(valuePlaceholder)}" /></td>
                            <td><input type="number" class="form-control input-sm wl-weight" data-index="${i}" min="1" step="1" value="${entry.weight || 1}" /></td>
                            <td style="text-align:center;"><input type="checkbox" class="wl-enabled" data-index="${i}" ${entry.enabled !== false ? "checked" : ""} /></td>
                            <td><button class="btn btn-danger btn-xs wl-remove" data-index="${i}"><span class="fa fa-trash"></span></button></td>
                        </tr>`).join("")}
                    </tbody>
                </table>
                <button class="btn btn-default btn-xs wl-add">+ Add Entry</button>
            `;

            container.querySelectorAll(".wl-value").forEach((inp) => {
                inp.addEventListener("input", () => { arrayRef[parseInt(inp.getAttribute("data-index"), 10)][valueField] = inp.value; });
            });

            container.querySelectorAll(".wl-weight").forEach((inp) => {
                inp.addEventListener("input", () => {
                    const value = parseInt(inp.value, 10);
                    arrayRef[parseInt(inp.getAttribute("data-index"), 10)].weight = (Number.isNaN(value) || value < 1) ? 1 : value;
                });
            });

            container.querySelectorAll(".wl-enabled").forEach((inp) => {
                inp.addEventListener("change", () => { arrayRef[parseInt(inp.getAttribute("data-index"), 10)].enabled = inp.checked; });
            });

            container.querySelectorAll(".wl-remove").forEach((btn) => {
                btn.addEventListener("click", () => {
                    arrayRef.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                    redraw();
                });
            });

            container.querySelector(".wl-add").addEventListener("click", () => {
                arrayRef.push({ [valueField]: "", weight: 1, enabled: true });
                redraw();
            });
        }

        redraw();
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }

        const d = editBuffer.data;
        const hasEntries = editBuffer.classPath === CLASS_PATH_CNAME
            ? (d.cnames || []).length > 0
            : (d.ipv4Addresses || []).length > 0 || (d.ipv6Addresses || []).length > 0;

        if (!hasEntries) { await uiAlert("Add at least one weighted entry."); return; }

        const saveBtn = document.getElementById("btnWrrRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/weightedroundrobin/records/delete", {
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

            const res = await apiFetch("/api/weightedroundrobin/records", {
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
