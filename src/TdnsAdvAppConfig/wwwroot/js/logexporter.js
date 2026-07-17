(function () {
    "use strict";

    const lgePane = document.getElementById("mainTabPaneLogExporter");
    const root = document.getElementById("logExporterConfigRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "config";

    const SYSLOG_PROTOCOLS = [
        { value: "udp", label: "UDP" },
        { value: "tcp", label: "TCP" },
        { value: "tls", label: "TCP over TLS" },
        { value: "local", label: "Local (Unix syslog)" }
    ];

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("lgeConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("lgeConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.maxQueueSize !== "number") raw.maxQueueSize = 1000000;
        if (typeof raw.enableEdnsLogging !== "boolean") raw.enableEdnsLogging = false;

        if (typeof raw.file !== "object" || raw.file === null) raw.file = {};
        if (typeof raw.file.enabled !== "boolean") raw.file.enabled = false;
        if (typeof raw.file.path !== "string") raw.file.path = "./dns_logs.json";

        if (typeof raw.http !== "object" || raw.http === null) raw.http = {};
        if (typeof raw.http.enabled !== "boolean") raw.http.enabled = false;
        if (typeof raw.http.endpoint !== "string") raw.http.endpoint = "http://localhost:5000/logs";
        if (typeof raw.http.headers !== "object" || raw.http.headers === null) raw.http.headers = {};

        if (typeof raw.syslog !== "object" || raw.syslog === null) raw.syslog = {};
        if (typeof raw.syslog.enabled !== "boolean") raw.syslog.enabled = false;
        if (typeof raw.syslog.address !== "string") raw.syslog.address = "127.0.0.1";
        if (typeof raw.syslog.port !== "number") raw.syslog.port = 514;
        if (typeof raw.syslog.protocol !== "string") raw.syslog.protocol = "udp";

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/logexporter/config/raw");
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
            const res = await apiFetch("/api/logexporter/config/raw", {
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
        lgePane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        lgePane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        lgePane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        lgePane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("lgeTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "logexporter") return;
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
                        <div><span id="lgeConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnLgeConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnLgeConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Max Queue Size</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="lgeMaxQueueSize" min="0" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">Log entries queued in memory awaiting export. Older entries are dropped once this many are queued.</p>
                            </div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="lgeEnableEdnsLogging" /> Include EDNS details in exported logs</label></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">File Export</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="lgeFileEnabled" /> Enabled</label></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">File Path</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="lgeFilePath" placeholder="./dns_logs.json" /></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">HTTP Export</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="lgeHttpEnabled" /> Enabled</label></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Endpoint URL</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="lgeHttpEndpoint" placeholder="https://example.com/logs" /></div>
                        </div>
                    </div>
                    <h4>Request Headers</h4>
                    <div id="lgeHttpHeadersContainer"></div>
                    <button id="btnLgeAddHeader" class="btn btn-default btn-xs"><span class="fa fa-plus"></span> Add Header</button>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Syslog Export</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="lgeSyslogEnabled" /> Enabled</label></div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">Protocol</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="lgeSyslogProtocol">
                                    ${SYSLOG_PROTOCOLS.map((p) => `<option value="${p.value}" ${p.value === (config.syslog.protocol || "udp").toLowerCase() ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="form-group" id="lgeSyslogAddressGroup">
                            <label class="col-sm-3 control-label">Address</label>
                            <div class="col-sm-9"><input type="text" class="form-control" id="lgeSyslogAddress" placeholder="127.0.0.1 or syslog.example.com" /></div>
                        </div>
                        <div class="form-group" id="lgeSyslogPortGroup">
                            <label class="col-sm-3 control-label">Port</label>
                            <div class="col-sm-9"><input type="number" class="form-control" id="lgeSyslogPort" min="1" max="65535" /></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btnLgeConfigSave").addEventListener("click", save);
        document.getElementById("btnLgeConfigDiscard").addEventListener("click", discard);

        const maxQueueInput = document.getElementById("lgeMaxQueueSize");
        maxQueueInput.value = config.maxQueueSize;
        maxQueueInput.addEventListener("input", (e) => { config.maxQueueSize = parseInt(e.target.value, 10) || 0; markDirty(); });

        document.getElementById("lgeEnableEdnsLogging").checked = config.enableEdnsLogging;
        document.getElementById("lgeEnableEdnsLogging").addEventListener("change", (e) => { config.enableEdnsLogging = e.target.checked; markDirty(); });

        document.getElementById("lgeFileEnabled").checked = config.file.enabled;
        document.getElementById("lgeFileEnabled").addEventListener("change", (e) => { config.file.enabled = e.target.checked; markDirty(); });

        const filePathInput = document.getElementById("lgeFilePath");
        filePathInput.value = config.file.path;
        filePathInput.addEventListener("input", (e) => { config.file.path = e.target.value; markDirty(); });

        document.getElementById("lgeHttpEnabled").checked = config.http.enabled;
        document.getElementById("lgeHttpEnabled").addEventListener("change", (e) => { config.http.enabled = e.target.checked; markDirty(); });

        const httpEndpointInput = document.getElementById("lgeHttpEndpoint");
        httpEndpointInput.value = config.http.endpoint;
        httpEndpointInput.addEventListener("input", (e) => { config.http.endpoint = e.target.value; markDirty(); });

        document.getElementById("btnLgeAddHeader").addEventListener("click", addHttpHeader);
        renderHttpHeaders();

        document.getElementById("lgeSyslogEnabled").checked = config.syslog.enabled;
        document.getElementById("lgeSyslogEnabled").addEventListener("change", (e) => { config.syslog.enabled = e.target.checked; markDirty(); });

        const protocolSelect = document.getElementById("lgeSyslogProtocol");
        protocolSelect.addEventListener("change", (e) => { config.syslog.protocol = e.target.value; markDirty(); updateSyslogFieldVisibility(); });
        updateSyslogFieldVisibility();

        const addressInput = document.getElementById("lgeSyslogAddress");
        addressInput.value = config.syslog.address;
        addressInput.addEventListener("input", (e) => { config.syslog.address = e.target.value; markDirty(); });

        const portInput = document.getElementById("lgeSyslogPort");
        portInput.value = config.syslog.port;
        portInput.addEventListener("input", (e) => { config.syslog.port = parseInt(e.target.value, 10) || 0; markDirty(); });
    }

    function updateSyslogFieldVisibility() {
        const isLocal = (config.syslog.protocol || "").toLowerCase() === "local";
        document.getElementById("lgeSyslogAddressGroup").style.display = isLocal ? "none" : "block";
        document.getElementById("lgeSyslogPortGroup").style.display = isLocal ? "none" : "block";
    }

    function renderHttpHeaders() {
        const container = document.getElementById("lgeHttpHeadersContainer");
        const keys = Object.keys(config.http.headers);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No custom headers configured.</p>';
        } else {
            container.innerHTML = `<table class="table table-hover table-condensed">
                <thead><tr><th>Header Name</th><th>Value</th><th style="width:40px;"></th></tr></thead>
                <tbody>
                    ${keys.map((key) => `<tr>
                        <td><input type="text" class="form-control input-sm header-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" placeholder="Authorization" /></td>
                        <td><input type="text" class="form-control input-sm header-value" data-key="${escapeHtml(key)}" value="${escapeHtml(config.http.headers[key] || "")}" placeholder="Bearer abc123" /></td>
                        <td><button class="btn btn-danger btn-xs header-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                    </tr>`).join("")}
                </tbody>
            </table>`;
        }

        container.querySelectorAll(".header-value").forEach((inp) => {
            inp.addEventListener("input", () => {
                config.http.headers[inp.getAttribute("data-key")] = inp.value;
                markDirty();
            });
        });

        container.querySelectorAll(".header-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete config.http.headers[btn.getAttribute("data-key")];
                markDirty();
                renderHttpHeaders();
            });
        });

        container.querySelectorAll(".header-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(config.http.headers, newKey)) {
                    await uiAlert(`A header called "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                config.http.headers[newKey] = config.http.headers[oldKey];
                delete config.http.headers[oldKey];
                markDirty();
                renderHttpHeaders();
            });
        });
    }

    function addHttpHeader() {
        let name = "Header-Name";
        let suffix = 1;
        while (Object.prototype.hasOwnProperty.call(config.http.headers, name)) {
            name = `Header-Name-${++suffix}`;
        }

        config.http.headers[name] = "";
        markDirty();
        renderHttpHeaders();
    }

    initSubTabs();
})();
