(function () {
    "use strict";

    const wiPane = document.getElementById("mainTabPaneWildIp");
    const recordsRoot = document.getElementById("wildIpRecordsRoot");

    let currentSubTab = "records";

    let records = [];
    let zones = [];
    let defaultRecordTtl = 3600;
    let recordsLoaded = false;
    let editingIndex = -1;
    let editBuffer = null;
    let editOriginalDomain = null;
    let editOriginalZone = null;

    const DEFAULT_ALLOWED_NETWORKS = ["0.0.0.0/0", "::/0"];

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function initSubTabs() {
        wiPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        wiPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        wiPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        wiPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "wiTabPaneConfig" : "wiTabPaneRecords").classList.add("active");

        if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "wildip") return;
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
            const res = await apiFetch("/api/wildip/records");
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
            <div id="wildIpRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Wild IP APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Add one to a primary or forwarder zone to return the IP address embedded in the queried subdomain for A/AAAA queries - works like sslip.io (e.g. <code>192-168-1-10.ip.example.com</code> resolves to <code>192.168.1.10</code>).</p>
                        <div id="wildIpRecordsContainer" class="list-group"></div>
                        <button id="btnWildIpAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="wildIpRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnWildIpAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("wildIpRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No Wild IP APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';

            const d = rec.data && typeof rec.data === "object" ? rec.data : {};
            const networks = Array.isArray(d.allowedNetworks) ? d.allowedNetworks : null;
            const summary = networks === null
                ? "any address"
                : networks.length === 0
                    ? "no addresses (returns nothing)"
                    : `${networks.length} allowed range${networks.length === 1 ? "" : "s"}`;

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> <span class="label label-info">${escapeHtml(summary)}</span> ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops Wild IP answers for it.`))) return;

                try {
                    const res = await apiFetch("/api/wildip/records/delete", {
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
            editBuffer = { name: "", domain: zone, zone, ttl: defaultRecordTtl, restrictAnswers: false, allowedNetworks: [...DEFAULT_ALLOWED_NETWORKS] };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            const d = rec.data && typeof rec.data === "object" ? rec.data : {};
            const networks = Array.isArray(d.allowedNetworks) ? d.allowedNetworks : null;

            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                ttl: rec.ttl,
                restrictAnswers: networks !== null,
                allowedNetworks: networks !== null ? [...networks] : [...DEFAULT_ALLOWED_NETWORKS]
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("wildIpRecordsListView").style.display = "none";
        document.getElementById("wildIpRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("wildIpRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    function renderRecordEditor() {
        const editorEl = document.getElementById("wildIpRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnWildIpRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="wildIpRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="wildIpRecName" placeholder="e.g. ip - queries land at &lt;embedded-ip&gt;.ip.&lt;zone&gt;" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="wildIpRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="wildIpRecTtl" min="0" />
                            </div>
                        </div>
                    </div>

                    <p class="text-muted">The subdomain between the record name and this record's base name is parsed as an embedded IPv4 (dot/dash separated octets) or IPv6 (dashed or 32-char hex) address and returned as an A or AAAA answer.</p>

                    <hr />

                    <label><input type="checkbox" id="wildIpRecRestrict" /> Restrict which answer addresses are allowed</label>
                    <p class="text-muted" style="font-size:12px;">Unchecked: any address parsed out of the subdomain is answered. Checked: only an embedded address falling inside one of these ranges is answered - anything else gets NODATA. This limits what this record can be used to resolve to, not who can query it.</p>
                    <div id="wildIpRecNetworksContainer" style="display:none;"></div>

                    <div style="margin-top:16px;">
                        <button id="btnWildIpRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnWildIpRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("wildIpRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("wildIpRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const ttlInput = document.getElementById("wildIpRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        const restrictCheckbox = document.getElementById("wildIpRecRestrict");
        restrictCheckbox.checked = editBuffer.restrictAnswers;
        renderNetworksList();
        restrictCheckbox.addEventListener("change", (e) => {
            editBuffer.restrictAnswers = e.target.checked;
            if (editBuffer.restrictAnswers && editBuffer.allowedNetworks.length === 0)
                editBuffer.allowedNetworks = [...DEFAULT_ALLOWED_NETWORKS];
            renderNetworksList();
        });

        document.getElementById("btnWildIpRecSave").addEventListener("click", saveRecord);
    }

    function renderNetworksList() {
        const container = document.getElementById("wildIpRecNetworksContainer");
        container.style.display = editBuffer.restrictAnswers ? "" : "none";
        if (editBuffer.restrictAnswers)
            AppHelpers.renderStringList("wildIpRecNetworksContainer", editBuffer.allowedNetworks, "e.g. 203.0.113.0/24 or ::/0", () => {});
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }

        if (editBuffer.restrictAnswers && editBuffer.allowedNetworks.length === 0) {
            if (!(await uiConfirm("The allowed-answer list is empty. This record will stop answering entirely - every query through it gets NODATA. Save anyway?")))
                return;
        }

        const saveBtn = document.getElementById("btnWildIpRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/wildip/records/delete", {
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

            const data = editBuffer.restrictAnswers ? { allowedNetworks: editBuffer.allowedNetworks } : {};

            const res = await apiFetch("/api/wildip/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    domain,
                    zone: editBuffer.zone,
                    ttl: editBuffer.ttl,
                    data
                })
            });
            const resData = await res.json();

            if (!resData.success) {
                await uiAlert("Failed to save record: " + (resData.error || "unknown error"));
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
