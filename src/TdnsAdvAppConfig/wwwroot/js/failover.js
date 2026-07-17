(function () {
    "use strict";

    const foPane = document.getElementById("mainTabPaneFailover");
    const root = document.getElementById("foConfigRoot");
    const recordsRoot = document.getElementById("foRecordsRoot");

    const CLASS_PATH_ADDRESS = "Failover.Address";
    const CLASS_PATH_CNAME = "Failover.CNAME";

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "records";

    let currentHcIndex = -1;
    let currentEaIndex = -1;

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
        const badge = document.getElementById("foConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("foConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};
        if (!Array.isArray(raw.healthChecks)) raw.healthChecks = [];
        if (!Array.isArray(raw.emailAlerts)) raw.emailAlerts = [];
        if (!Array.isArray(raw.webHooks)) raw.webHooks = [];
        if (!Array.isArray(raw.underMaintenance)) raw.underMaintenance = [];
        return raw;
    }

    function healthCheckNames() {
        return config.healthChecks.map((h) => h.name).filter((n) => typeof n === "string" && n !== "");
    }

    function emailAlertNames() {
        return config.emailAlerts.map((e) => e.name).filter((n) => typeof n === "string" && n !== "");
    }

    function webHookNames() {
        return config.webHooks.map((w) => w.name).filter((n) => typeof n === "string" && n !== "");
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/failover/config/raw");
            const data = await res.json();
            if (!data.success) {
                root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            config = normalizeConfig(data.config || {});
            currentHcIndex = -1;
            currentEaIndex = -1;
            clearDirty();
            renderRoot();
        } catch (err) {
            root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(err.message)}</p>`;
        }
    }

    async function save() {
        try {
            const res = await apiFetch("/api/failover/config/raw", {
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
        foPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        foPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        foPane.querySelectorAll(".tab-content > .tab-pane").forEach((tp) => tp.classList.remove("active"));

        foPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "config" ? "foTabPaneConfig" : "foTabPaneRecords").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
        else if (subtab === "records") onRecordsTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "failover") return;
        switchSubTab(currentSubTab);
    });

    document.addEventListener("authenticated", () => {
        if (loaded && !dirty) load();
        if (recordsLoaded) loadRecords();
    });

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-body">
                    <div class="group-row">
                        <div><span id="foConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnFoConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnFoConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="foConfigListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Health Checks</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Monitoring profiles referenced by name from APP records - ping, TCP port, or HTTP/HTTPS checks.</p>
                        <div id="foHcContainer" class="list-group"></div>
                        <button id="btnFoAddHc" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Health Check</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Email Alerts</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">SMTP notification profiles, referenced by name from a Health Check.</p>
                        <div id="foEaContainer" class="list-group"></div>
                        <button id="btnFoAddEa" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Email Alert</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Web Hooks</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">HTTP POST notification profiles, referenced by name from a Health Check.</p>
                        <div id="foWhContainer"></div>
                        <button id="btnFoAddWh" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Web Hook</button>
                    </div>
                </div>

                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Maintenance Networks</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">A network here always reports Maintenance status while enabled - removes it from rotation without touching its health check or APP record.</p>
                        <div id="foUmContainer"></div>
                        <button id="btnFoAddUm" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Maintenance Network</button>
                    </div>
                </div>
            </div>

            <div id="foHcEditorView" style="display:none;"></div>
            <div id="foEaEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnFoConfigSave").addEventListener("click", save);
        document.getElementById("btnFoConfigDiscard").addEventListener("click", discard);
        document.getElementById("btnFoAddHc").addEventListener("click", addHealthCheck);
        document.getElementById("btnFoAddEa").addEventListener("click", addEmailAlert);
        document.getElementById("btnFoAddWh").addEventListener("click", addWebHook);
        document.getElementById("btnFoAddUm").addEventListener("click", addMaintenanceNetwork);

        renderHcList();
        renderEaList();
        renderWhList();
        renderUmList();
    }

    function renderHcList() {
        const container = document.getElementById("foHcContainer");

        if (config.healthChecks.length === 0) {
            container.innerHTML = '<p class="text-muted">No health checks configured.</p>';
            return;
        }

        container.innerHTML = config.healthChecks.map((h, idx) => `<div class="list-group-item group-row">
            <div><span class="group-name">${escapeHtml(h.name || "")}</span> <span class="label label-info">${escapeHtml((h.type || "tcp").toUpperCase())}</span></div>
            <div class="group-actions">
                <button class="btn btn-default btn-xs hc-edit" data-index="${idx}">Edit</button>
                <button class="btn btn-danger btn-xs hc-delete" data-index="${idx}">Delete</button>
            </div>
        </div>`).join("");

        container.querySelectorAll(".hc-edit").forEach((btn) => {
            btn.addEventListener("click", () => openHcEditor(parseInt(btn.getAttribute("data-index"), 10)));
        });

        container.querySelectorAll(".hc-delete").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                const h = config.healthChecks[idx];
                if (!(await uiConfirm(`Delete health check "${h.name}"? Any APP record still referencing it by name will fail every query.`))) return;

                config.healthChecks.splice(idx, 1);
                markDirty();
                renderHcList();
            });
        });
    }

    async function addHealthCheck() {
        let name = await uiPrompt("New health check name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (healthCheckNames().includes(name)) {
            await uiAlert(`A health check called "${name}" already exists.`);
            return;
        }

        config.healthChecks.push({ name, type: "tcp", interval: 60, retries: 3, timeout: 10, port: 80, url: null, emailAlert: null, webHook: null });
        markDirty();
        renderHcList();
    }

    function openHcEditor(index) {
        currentHcIndex = index;
        document.getElementById("foConfigListView").style.display = "none";
        document.getElementById("foHcEditorView").style.display = "block";
        renderHcEditor();
    }

    function closeHcEditor() {
        currentHcIndex = -1;
        document.getElementById("foHcEditorView").style.display = "none";
        document.getElementById("foConfigListView").style.display = "block";
        renderHcList();
    }

    function renderHcEditor() {
        const h = config.healthChecks[currentHcIndex];
        const type = (h.type || "tcp").toLowerCase();
        const editorEl = document.getElementById("foHcEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Edit Health Check</h3></div>
                <div class="panel-body">
                    <button id="btnFoHcBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Health Checks</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="foHcName" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Type</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="foHcType">
                                    <option value="ping" ${type === "ping" ? "selected" : ""}>Ping (ICMP)</option>
                                    <option value="tcp" ${type === "tcp" ? "selected" : ""}>TCP Port</option>
                                    <option value="http" ${type === "http" ? "selected" : ""}>HTTP</option>
                                    <option value="https" ${type === "https" ? "selected" : ""}>HTTPS</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Interval (seconds)</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="foHcInterval" min="1" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Retries</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="foHcRetries" min="0" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Timeout (seconds)</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="foHcTimeout" min="1" /></div>
                        </div>
                        <div class="form-group" id="foHcPortGroup" style="display:none;">
                            <label class="col-sm-3 control-label">Port</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="foHcPort" min="1" max="65535" /></div>
                        </div>
                        <div class="form-group" id="foHcUrlGroup" style="display:none;">
                            <label class="col-sm-3 control-label">URL</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="foHcUrl" placeholder="leave blank to auto-generate from the queried domain" />
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Email Alert</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="foHcEmailAlert">
                                    <option value="">None</option>
                                    ${emailAlertNames().map((n) => `<option value="${escapeHtml(n)}" ${h.emailAlert === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Web Hook</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="foHcWebHook">
                                    <option value="">None</option>
                                    ${webHookNames().map((n) => `<option value="${escapeHtml(n)}" ${h.webHook === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnFoHcBack").addEventListener("click", closeHcEditor);

        const nameInput = document.getElementById("foHcName");
        nameInput.value = h.name;
        nameInput.addEventListener("blur", async () => {
            const newName = nameInput.value.trim();
            if (!newName) { nameInput.value = h.name; return; }
            if (newName === h.name) return;

            if (config.healthChecks.some((hc, idx) => idx !== currentHcIndex && hc.name === newName)) {
                await uiAlert("A health check with that name already exists.");
                nameInput.value = h.name;
                return;
            }

            h.name = newName;
            markDirty();
        });

        function updateTypeVisibility() {
            document.getElementById("foHcPortGroup").style.display = h.type === "tcp" ? "block" : "none";
            document.getElementById("foHcUrlGroup").style.display = (h.type === "http" || h.type === "https") ? "block" : "none";
        }

        const typeSelect = document.getElementById("foHcType");
        typeSelect.addEventListener("change", (e) => { h.type = e.target.value; markDirty(); updateTypeVisibility(); });
        updateTypeVisibility();

        const intervalInput = document.getElementById("foHcInterval");
        intervalInput.value = typeof h.interval === "number" ? h.interval : 60;
        intervalInput.addEventListener("input", (e) => { h.interval = parseInt(e.target.value, 10) || 0; markDirty(); });

        const retriesInput = document.getElementById("foHcRetries");
        retriesInput.value = typeof h.retries === "number" ? h.retries : 3;
        retriesInput.addEventListener("input", (e) => { h.retries = parseInt(e.target.value, 10) || 0; markDirty(); });

        const timeoutInput = document.getElementById("foHcTimeout");
        timeoutInput.value = typeof h.timeout === "number" ? h.timeout : 10;
        timeoutInput.addEventListener("input", (e) => { h.timeout = parseInt(e.target.value, 10) || 0; markDirty(); });

        const portInput = document.getElementById("foHcPort");
        portInput.value = typeof h.port === "number" ? h.port : 80;
        portInput.addEventListener("input", (e) => { h.port = parseInt(e.target.value, 10) || 0; markDirty(); });

        const urlInput = document.getElementById("foHcUrl");
        urlInput.value = typeof h.url === "string" ? h.url : "";
        urlInput.addEventListener("input", (e) => { h.url = e.target.value.trim() === "" ? null : e.target.value; markDirty(); });

        document.getElementById("foHcEmailAlert").addEventListener("change", (e) => { h.emailAlert = e.target.value === "" ? null : e.target.value; markDirty(); });
        document.getElementById("foHcWebHook").addEventListener("change", (e) => { h.webHook = e.target.value === "" ? null : e.target.value; markDirty(); });
    }

    function renderEaList() {
        const container = document.getElementById("foEaContainer");

        if (config.emailAlerts.length === 0) {
            container.innerHTML = '<p class="text-muted">No email alerts configured.</p>';
            return;
        }

        container.innerHTML = config.emailAlerts.map((ea, idx) => {
            const badge = ea.enabled ? '<span class="label label-success">Enabled</span>' : '<span class="label label-default">Disabled</span>';
            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(ea.name || "")}</span> ${badge}</div>
                <div class="group-actions">
                    <button class="btn btn-default btn-xs ea-edit" data-index="${idx}">Edit</button>
                    <button class="btn btn-danger btn-xs ea-delete" data-index="${idx}">Delete</button>
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll(".ea-edit").forEach((btn) => {
            btn.addEventListener("click", () => openEaEditor(parseInt(btn.getAttribute("data-index"), 10)));
        });

        container.querySelectorAll(".ea-delete").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                const ea = config.emailAlerts[idx];
                if (!(await uiConfirm(`Delete email alert "${ea.name}"? Any health check still referencing it by name will simply stop sending alerts.`))) return;

                config.emailAlerts.splice(idx, 1);
                markDirty();
                renderEaList();
            });
        });
    }

    async function addEmailAlert() {
        let name = await uiPrompt("New email alert name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (emailAlertNames().includes(name)) {
            await uiAlert(`An email alert called "${name}" already exists.`);
            return;
        }

        config.emailAlerts.push({
            name, enabled: false, alertTo: [], smtpServer: "", smtpPort: 465, startTls: false, smtpOverTls: true,
            username: "", password: "", mailFrom: "", mailFromName: "DNS Server Alert"
        });
        markDirty();
        renderEaList();
    }

    function openEaEditor(index) {
        currentEaIndex = index;
        document.getElementById("foConfigListView").style.display = "none";
        document.getElementById("foEaEditorView").style.display = "block";
        renderEaEditor();
    }

    function closeEaEditor() {
        currentEaIndex = -1;
        document.getElementById("foEaEditorView").style.display = "none";
        document.getElementById("foConfigListView").style.display = "block";
        renderEaList();
        renderHcList();
    }

    function renderEaEditor() {
        const ea = config.emailAlerts[currentEaIndex];
        const editorEl = document.getElementById("foEaEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Edit Email Alert</h3></div>
                <div class="panel-body">
                    <button id="btnFoEaBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Email Alerts</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="foEaName" /></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="foEaEnabled" /> Enabled</label></div>
                        </div>
                    </div>

                    <h4>Recipients</h4>
                    <div id="foEaAlertToContainer"></div>

                    <div class="form-horizontal" style="margin-top:16px;">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">SMTP Server</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="foEaSmtpServer" placeholder="smtp.example.com" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">SMTP Port</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="foEaSmtpPort" min="1" max="65535" /></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="foEaStartTls" /> Use STARTTLS</label></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="foEaSmtpOverTls" /> Use implicit TLS (SMTPS)</label></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Username</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="foEaUsername" autocomplete="off" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Password</label>
                            <div class="col-sm-9"><input type="password" class="form-control" id="foEaPassword" autocomplete="new-password" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">From Address</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="foEaMailFrom" placeholder="alerts@example.com" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">From Name</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="foEaMailFromName" placeholder="DNS Server Alert" /></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnFoEaBack").addEventListener("click", closeEaEditor);

        const nameInput = document.getElementById("foEaName");
        nameInput.value = ea.name;
        nameInput.addEventListener("blur", async () => {
            const newName = nameInput.value.trim();
            if (!newName) { nameInput.value = ea.name; return; }
            if (newName === ea.name) return;

            if (config.emailAlerts.some((e, idx) => idx !== currentEaIndex && e.name === newName)) {
                await uiAlert("An email alert with that name already exists.");
                nameInput.value = ea.name;
                return;
            }

            ea.name = newName;
            markDirty();
        });

        document.getElementById("foEaEnabled").checked = !!ea.enabled;
        document.getElementById("foEaEnabled").addEventListener("change", (e) => { ea.enabled = e.target.checked; markDirty(); });

        if (!Array.isArray(ea.alertTo)) ea.alertTo = [];
        AppHelpers.renderStringList("foEaAlertToContainer", ea.alertTo, "e.g. admin@example.com", markDirty);

        const smtpServerInput = document.getElementById("foEaSmtpServer");
        smtpServerInput.value = ea.smtpServer || "";
        smtpServerInput.addEventListener("input", (e) => { ea.smtpServer = e.target.value; markDirty(); });

        const smtpPortInput = document.getElementById("foEaSmtpPort");
        smtpPortInput.value = typeof ea.smtpPort === "number" ? ea.smtpPort : 465;
        smtpPortInput.addEventListener("input", (e) => { ea.smtpPort = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("foEaStartTls").checked = !!ea.startTls;
        document.getElementById("foEaStartTls").addEventListener("change", (e) => { ea.startTls = e.target.checked; markDirty(); });

        document.getElementById("foEaSmtpOverTls").checked = !!ea.smtpOverTls;
        document.getElementById("foEaSmtpOverTls").addEventListener("change", (e) => { ea.smtpOverTls = e.target.checked; markDirty(); });

        const usernameInput = document.getElementById("foEaUsername");
        usernameInput.value = ea.username || "";
        usernameInput.addEventListener("input", (e) => { ea.username = e.target.value; markDirty(); });

        const passwordInput = document.getElementById("foEaPassword");
        passwordInput.value = ea.password || "";
        passwordInput.addEventListener("input", (e) => { ea.password = e.target.value; markDirty(); });

        const mailFromInput = document.getElementById("foEaMailFrom");
        mailFromInput.value = ea.mailFrom || "";
        mailFromInput.addEventListener("input", (e) => { ea.mailFrom = e.target.value; markDirty(); });

        const mailFromNameInput = document.getElementById("foEaMailFromName");
        mailFromNameInput.value = ea.mailFromName || "";
        mailFromNameInput.addEventListener("input", (e) => { ea.mailFromName = e.target.value; markDirty(); });
    }

    function renderWhList() {
        const container = document.getElementById("foWhContainer");

        if (config.webHooks.length === 0) {
            container.innerHTML = '<p class="text-muted">No web hooks configured.</p>';
            return;
        }

        container.innerHTML = config.webHooks.map((wh, idx) => `<div class="well well-sm" style="margin-bottom:8px;">
            <div class="group-row" style="margin-bottom:8px;">
                <input type="text" class="form-control input-sm wh-name" data-index="${idx}" value="${escapeHtml(wh.name || "")}" style="flex:1; margin-right:8px; font-weight:600;" />
                <label style="font-weight:normal; margin: 0 12px; white-space:nowrap;"><input type="checkbox" class="wh-enabled" data-index="${idx}" ${wh.enabled ? "checked" : ""} /> Enabled</label>
                <button class="btn btn-danger btn-xs wh-remove" data-index="${idx}"><span class="fa fa-trash"></span></button>
            </div>
            <label style="font-weight:normal;">URLs</label>
            <div id="foWhUrls-${idx}"></div>
        </div>`).join("");

        config.webHooks.forEach((wh, idx) => {
            if (!Array.isArray(wh.urls)) wh.urls = [];
            AppHelpers.renderStringList(`foWhUrls-${idx}`, wh.urls, "https://example.com/webhook", markDirty);
        });

        container.querySelectorAll(".wh-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const idx = parseInt(inp.getAttribute("data-index"), 10);
                const newName = inp.value.trim();
                const oldName = config.webHooks[idx].name;

                if (newName === "") { inp.value = oldName; return; }
                if (newName === oldName) return;

                if (webHookNames().some((n, i) => i !== idx && n === newName)) {
                    await uiAlert(`A web hook called "${newName}" already exists.`);
                    inp.value = oldName;
                    return;
                }

                config.webHooks[idx].name = newName;
                markDirty();
                renderHcList();
            });
        });

        container.querySelectorAll(".wh-enabled").forEach((chk) => {
            chk.addEventListener("change", () => { config.webHooks[parseInt(chk.getAttribute("data-index"), 10)].enabled = chk.checked; markDirty(); });
        });

        container.querySelectorAll(".wh-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                if (!(await uiConfirm(`Delete web hook "${config.webHooks[idx].name}"? Any health check still referencing it by name will simply stop calling it.`))) return;

                config.webHooks.splice(idx, 1);
                markDirty();
                renderWhList();
            });
        });
    }

    async function addWebHook() {
        let name = await uiPrompt("New web hook name:");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (webHookNames().includes(name)) {
            await uiAlert(`A web hook called "${name}" already exists.`);
            return;
        }

        config.webHooks.push({ name, enabled: false, urls: [] });
        markDirty();
        renderWhList();
    }

    function renderUmList() {
        const container = document.getElementById("foUmContainer");

        if (config.underMaintenance.length === 0) {
            container.innerHTML = '<p class="text-muted">No maintenance networks configured.</p>';
            return;
        }

        container.innerHTML = `<table class="table table-hover table-condensed">
            <thead><tr><th>Network (CIDR or single IP)</th><th style="width:120px;">Enabled</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${config.underMaintenance.map((um, idx) => `<tr>
                    <td><input type="text" class="form-control input-sm um-network" data-index="${idx}" value="${escapeHtml(um.network || "")}" placeholder="192.168.1.0/24" /></td>
                    <td><input type="checkbox" class="um-enabled" data-index="${idx}" ${um.enabled ? "checked" : ""} /></td>
                    <td><button class="btn btn-danger btn-xs um-remove" data-index="${idx}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".um-network").forEach((inp) => {
            inp.addEventListener("input", () => { config.underMaintenance[parseInt(inp.getAttribute("data-index"), 10)].network = inp.value; markDirty(); });
        });

        container.querySelectorAll(".um-enabled").forEach((chk) => {
            chk.addEventListener("change", () => { config.underMaintenance[parseInt(chk.getAttribute("data-index"), 10)].enabled = chk.checked; markDirty(); });
        });

        container.querySelectorAll(".um-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                config.underMaintenance.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                markDirty();
                renderUmList();
            });
        });
    }

    function addMaintenanceNetwork() {
        config.underMaintenance.push({ network: "", enabled: true });
        markDirty();
        renderUmList();
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
            const res = await apiFetch("/api/failover/records");
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

    async function fetchHealthCheckNames() {
        if (config && Array.isArray(config.healthChecks)) return healthCheckNames();

        try {
            const res = await apiFetch("/api/failover/config/raw");
            const data = await res.json();
            if (data.success && data.config && Array.isArray(data.config.healthChecks))
                return data.config.healthChecks.map((h) => h.name).filter((n) => typeof n === "string" && n !== "");
        } catch {
        }

        return [];
    }

    function classPathLabel(classPath) {
        return classPath === CLASS_PATH_CNAME ? "CNAME" : "Address";
    }

    function renderRecordsRoot() {
        recordsRoot.innerHTML = `
            <div id="foRecordsListView">
                <div class="panel panel-default">
                    <div class="panel-heading"><h3 class="panel-title">Failover APP Records</h3></div>
                    <div class="panel-body">
                        <p class="text-muted">Native A/AAAA/CNAME records at the same domain always win over an APP record - only use APP records at FQDNs with no other records.</p>
                        <div id="foRecordsContainer" class="list-group"></div>
                        <button id="btnFoAddRecord" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Record</button>
                    </div>
                </div>
            </div>

            <div id="foRecordEditorView" style="display:none;"></div>
        `;

        document.getElementById("btnFoAddRecord").addEventListener("click", async () => {
            if (zones.length === 0) {
                await uiAlert("No writable primary or forwarder zones were found on the DNS server. Create a zone first.");
                return;
            }
            openRecordEditor(-1);
        });

        renderRecordsList();
    }

    function renderRecordsList() {
        const container = document.getElementById("foRecordsContainer");

        if (records.length === 0) {
            container.innerHTML = '<p class="text-muted">No Failover APP records found in any writable zone.</p>';
            return;
        }

        container.innerHTML = records.map((rec, idx) => {
            const badge = rec.disabled
                ? '<span class="label label-default">Disabled</span>'
                : '<span class="label label-success">Enabled</span>';
            const hc = (rec.data && rec.data.healthCheck) ? `<span class="label label-info">${escapeHtml(rec.data.healthCheck)}</span>` : "";

            return `<div class="list-group-item group-row">
                <div><span class="group-name">${escapeHtml(rec.domain)}</span> <span class="label label-info">${classPathLabel(rec.classPath)}</span> ${hc} ${badge}</div>
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

                if (!(await uiConfirm(`Delete the APP record for "${rec.domain}"? This immediately stops failover responses for it.`))) return;

                try {
                    const res = await apiFetch("/api/failover/records/delete", {
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

    function defaultDataFor(classPath) {
        return classPath === CLASS_PATH_CNAME
            ? { primary: "", secondary: [], serverDown: "", healthCheck: "", healthCheckUrl: "", allowTxtStatus: false }
            : { primary: [""], secondary: [], serverDown: [], healthCheck: "", healthCheckUrl: "", allowTxtStatus: false };
    }

    function openRecordEditor(index) {
        editingIndex = index;

        if (index === -1) {
            const zone = zones[0] || "";
            editBuffer = { name: "", domain: zone, zone, classPath: CLASS_PATH_ADDRESS, ttl: defaultRecordTtl, data: defaultDataFor(CLASS_PATH_ADDRESS) };
            editOriginalDomain = null;
            editOriginalZone = null;
        } else {
            const rec = records[index];
            const data = (rec.data && typeof rec.data === "object") ? JSON.parse(JSON.stringify(rec.data)) : defaultDataFor(rec.classPath);

            editBuffer = {
                name: relativeNameFor(rec.domain, rec.zone),
                domain: rec.domain,
                zone: rec.zone,
                classPath: rec.classPath,
                ttl: rec.ttl,
                data
            };
            editOriginalDomain = rec.domain;
            editOriginalZone = rec.zone;
        }

        document.getElementById("foRecordsListView").style.display = "none";
        document.getElementById("foRecordEditorView").style.display = "block";
        renderRecordEditor();
    }

    function updateDomainFromName() {
        const name = (editBuffer.name || "").trim();
        editBuffer.domain = name ? `${name}.${editBuffer.zone}` : editBuffer.zone;

        const fullNameEl = document.getElementById("foRecFullName");
        if (fullNameEl) fullNameEl.textContent = editBuffer.domain;
    }

    function closeRecordEditor() {
        editingIndex = -1;
        editBuffer = null;
        renderRecordsRoot();
    }

    let healthCheckNamesCache = [];

    async function renderRecordEditor() {
        healthCheckNamesCache = await fetchHealthCheckNames();

        const editorEl = document.getElementById("foRecordEditorView");

        editorEl.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">${editingIndex === -1 ? "Add" : "Edit"} APP Record</h3></div>
                <div class="panel-body">
                    <button id="btnFoRecordBack" class="btn btn-default btn-sm"><span class="fa fa-arrow-left"></span> Back to Records</button>
                    <hr />

                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Zone</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="foRecZone">
                                    ${zones.map((z) => `<option value="${escapeHtml(z)}" ${z === editBuffer.zone ? "selected" : ""}>${escapeHtml(z)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Name</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="foRecName" placeholder="e.g. app - leave blank for the zone apex" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">FQDN: <strong id="foRecFullName"></strong></p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Record Type</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="foRecClassPath">
                                    <option value="${CLASS_PATH_ADDRESS}" ${editBuffer.classPath === CLASS_PATH_ADDRESS ? "selected" : ""}>Address (A/AAAA)</option>
                                    <option value="${CLASS_PATH_CNAME}" ${editBuffer.classPath === CLASS_PATH_CNAME ? "selected" : ""}>CNAME</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">TTL (seconds)</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="foRecTtl" min="0" /></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Health Check</label>
                            <div class="col-sm-9">
                                ${healthCheckNamesCache.length === 0
                                    ? '<p class="text-danger" style="margin-top:7px;">No health checks are defined yet - add one on the Config tab first.</p>'
                                    : `<select class="form-control" id="foRecHealthCheck">${healthCheckNamesCache.map((n) => `<option value="${escapeHtml(n)}" ${editBuffer.data.healthCheck === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select>`
                                }
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Health Check URL</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="foRecHealthCheckUrl" placeholder="optional - overrides the health check's own URL for HTTP/HTTPS checks" />
                            </div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="foRecAllowTxtStatus" /> Allow status queries via TXT record</label></div>
                        </div>
                    </div>

                    <div id="foRecDataContainer"></div>

                    <div style="margin-top:16px;">
                        <button id="btnFoRecSave" class="btn btn-primary btn-sm">Save Record</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnFoRecordBack").addEventListener("click", closeRecordEditor);

        const zoneSelect = document.getElementById("foRecZone");
        zoneSelect.value = editBuffer.zone;
        zoneSelect.addEventListener("change", (e) => { editBuffer.zone = e.target.value; updateDomainFromName(); });

        const nameInput = document.getElementById("foRecName");
        nameInput.value = editBuffer.name;
        nameInput.addEventListener("input", (e) => { editBuffer.name = e.target.value; updateDomainFromName(); });

        updateDomainFromName();

        const classPathSelect = document.getElementById("foRecClassPath");
        classPathSelect.addEventListener("change", async (e) => {
            const newClassPath = e.target.value;

            if (!(await uiConfirm("Switching the record type clears the primary/secondary/server-down values below (they use different shapes for Address vs CNAME). Continue?"))) {
                classPathSelect.value = editBuffer.classPath;
                return;
            }

            editBuffer.classPath = newClassPath;
            const healthCheck = editBuffer.data.healthCheck;
            const healthCheckUrl = editBuffer.data.healthCheckUrl;
            const allowTxtStatus = editBuffer.data.allowTxtStatus;
            editBuffer.data = defaultDataFor(newClassPath);
            editBuffer.data.healthCheck = healthCheck;
            editBuffer.data.healthCheckUrl = healthCheckUrl;
            editBuffer.data.allowTxtStatus = allowTxtStatus;

            renderRecordDataEditor();
        });

        const ttlInput = document.getElementById("foRecTtl");
        ttlInput.value = editBuffer.ttl;
        ttlInput.addEventListener("input", (e) => { editBuffer.ttl = parseInt(e.target.value, 10) || 0; });

        const hcSelect = document.getElementById("foRecHealthCheck");
        if (hcSelect) hcSelect.addEventListener("change", (e) => { editBuffer.data.healthCheck = e.target.value; });

        const hcUrlInput = document.getElementById("foRecHealthCheckUrl");
        hcUrlInput.value = editBuffer.data.healthCheckUrl || "";
        hcUrlInput.addEventListener("input", (e) => { editBuffer.data.healthCheckUrl = e.target.value; });

        document.getElementById("foRecAllowTxtStatus").checked = !!editBuffer.data.allowTxtStatus;
        document.getElementById("foRecAllowTxtStatus").addEventListener("change", (e) => { editBuffer.data.allowTxtStatus = e.target.checked; });

        document.getElementById("btnFoRecSave").addEventListener("click", saveRecord);

        renderRecordDataEditor();
    }

    function renderRecordDataEditor() {
        if (editBuffer.classPath === CLASS_PATH_CNAME)
            renderCnameDataEditor();
        else
            renderAddressDataEditor();
    }

    function renderAddressDataEditor() {
        const container = document.getElementById("foRecDataContainer");
        const d = editBuffer.data;

        if (!Array.isArray(d.primary)) d.primary = [""];
        if (!Array.isArray(d.secondary)) d.secondary = [];
        if (!Array.isArray(d.serverDown)) d.serverDown = [];

        container.innerHTML = `
            <h4>Primary Addresses</h4>
            <p class="text-muted">Returned while at least one is healthy.</p>
            <div id="foRecPrimary"></div>

            <h4 style="margin-top:16px;">Secondary Addresses</h4>
            <p class="text-muted">Used only when every primary address is unhealthy.</p>
            <div id="foRecSecondary"></div>

            <h4 style="margin-top:16px;">Server-Down Addresses</h4>
            <p class="text-muted">Used only when every primary and secondary address is unhealthy - meant for a status page, not real content.</p>
            <div id="foRecServerDown"></div>
        `;

        AppHelpers.renderStringList("foRecPrimary", d.primary, "e.g. 192.0.2.1", () => { });
        AppHelpers.renderStringList("foRecSecondary", d.secondary, "e.g. 198.51.100.1", () => { });
        AppHelpers.renderStringList("foRecServerDown", d.serverDown, "e.g. 203.0.113.1", () => { });
    }

    function renderCnameDataEditor() {
        const container = document.getElementById("foRecDataContainer");
        const d = editBuffer.data;

        if (typeof d.primary !== "string") d.primary = "";
        if (!Array.isArray(d.secondary)) d.secondary = [];
        if (typeof d.serverDown !== "string") d.serverDown = "";

        container.innerHTML = `
            <div class="form-horizontal">
                <div class="form-group">
                    <label class="col-sm-3 control-label">Primary Domain</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="foRecCnamePrimary" placeholder="e.g. server1.example.com" /></div>
                </div>
            </div>

            <h4>Secondary Domains</h4>
            <p class="text-muted">Tried in order; the app returns the first one that's healthy once the primary domain fails.</p>
            <div id="foRecCnameSecondary"></div>

            <div class="form-horizontal" style="margin-top:16px;">
                <div class="form-group">
                    <label class="col-sm-3 control-label">Server-Down Domain</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="foRecCnameServerDown" placeholder="optional - e.g. status.example.com" /></div>
                </div>
            </div>
        `;

        const primaryInput = document.getElementById("foRecCnamePrimary");
        primaryInput.value = d.primary;
        primaryInput.addEventListener("input", (e) => { d.primary = e.target.value; });

        AppHelpers.renderStringList("foRecCnameSecondary", d.secondary, "e.g. server2.example.com", () => { });

        const serverDownInput = document.getElementById("foRecCnameServerDown");
        serverDownInput.value = d.serverDown;
        serverDownInput.addEventListener("input", (e) => { d.serverDown = e.target.value; });
    }

    async function saveRecord() {
        const domain = editBuffer.domain.trim();
        if (!domain) { await uiAlert("Domain is required."); return; }
        if (!editBuffer.zone) { await uiAlert("Zone is required."); return; }
        if (!editBuffer.data.healthCheck) { await uiAlert("Select a health check."); return; }

        if (!editBuffer.data.healthCheckUrl) delete editBuffer.data.healthCheckUrl;

        const saveBtn = document.getElementById("btnFoRecSave");
        saveBtn.disabled = true;

        try {
            const isRename = editingIndex !== -1 && (domain !== editOriginalDomain || editBuffer.zone !== editOriginalZone);

            if (isRename) {
                const delRes = await apiFetch("/api/failover/records/delete", {
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

            const res = await apiFetch("/api/failover/records", {
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
