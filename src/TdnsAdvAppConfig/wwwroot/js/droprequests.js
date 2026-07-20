(function () {
    "use strict";

    const dreqPane = document.getElementById("mainTabPaneDropRequests");
    const root = document.getElementById("dropRequestsConfigRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "config";

    const RECORD_TYPES = AppHelpers.RECORD_TYPES;

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("dreqConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("dreqConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.enableBlocking !== "boolean") raw.enableBlocking = true;
        if (typeof raw.dropMalformedRequests !== "boolean") raw.dropMalformedRequests = false;
        if (!Array.isArray(raw.allowedNetworks)) raw.allowedNetworks = [];
        if (!Array.isArray(raw.blockedNetworks)) raw.blockedNetworks = [];
        if (!Array.isArray(raw.allowedLocalEndPoints)) raw.allowedLocalEndPoints = [];
        if (!Array.isArray(raw.blockedQuestions)) raw.blockedQuestions = [];

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/droprequests/config/raw");
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
        const emptyRuleIndex = config.blockedQuestions.findIndex((q) => !q.name && !q.type);
        if (emptyRuleIndex !== -1) {
            await uiAlert(`Blocked Question rule #${emptyRuleIndex + 1} has neither a Domain nor a Type set, which would match and silently drop every request not already allowed. Set at least one of the two, or remove the rule, before saving.`);
            return;
        }

        try {
            const res = await apiFetch("/api/droprequests/config/raw", {
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
        dreqPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        dreqPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        dreqPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        dreqPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("dreqTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "droprequests") return;
        switchSubTab(currentSubTab);
    });

    document.addEventListener("authenticated", () => {
        if (loaded && !dirty) load();
    });

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default action-bar-sticky">
                <div class="panel-body">
                    <div class="group-row">
                        <div><span id="dreqConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnDreqConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnDreqConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General Settings</h3></div>
                <div class="panel-body">
                    <div style="margin-bottom:8px;">
                        <label><input type="checkbox" id="dreqCfgEnable" /> Enable Blocking</label>
                    </div>
                    <div>
                        <label><input type="checkbox" id="dreqCfgDropMalformed" /> Drop Malformed Requests</label>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Allowed Networks</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Requests from these networks always get through, checked before every other rule below.</p>
                    <div id="dreqAllowedNetworksContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Blocked Networks</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Requests from these networks are silently dropped, unless already allowed above.</p>
                    <div id="dreqBlockedNetworksContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Allowed Local End Points</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Advanced: for services like DoT/DoH/DoQ. When any entry is added here, only requests arriving via one of these listed server end points are allowed - every other end point gets silently dropped, regardless of Blocked Networks above. Leave empty to not restrict by end point at all. Each entry is an IP or domain, optionally with <code>:port</code> (a bare address or omitted port matches any port).</p>
                    <div id="dreqAllowedLocalEndPointsContainer"></div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Blocked Questions</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Drops a request matching a domain and/or record type. Leave Domain blank to match any domain, or Type as "(any type)" to match any type - at least one of the two should be set for a rule to do anything.</p>
                    <div id="dreqBlockedQuestionsContainer"></div>
                    <button id="btnDreqAddBlockedQuestion" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Rule</button>
                </div>
            </div>
        `;

        document.getElementById("btnDreqConfigSave").addEventListener("click", save);
        document.getElementById("btnDreqConfigDiscard").addEventListener("click", discard);

        document.getElementById("dreqCfgEnable").checked = config.enableBlocking;
        document.getElementById("dreqCfgEnable").addEventListener("change", (e) => { config.enableBlocking = e.target.checked; markDirty(); });

        document.getElementById("dreqCfgDropMalformed").checked = config.dropMalformedRequests;
        document.getElementById("dreqCfgDropMalformed").addEventListener("change", (e) => { config.dropMalformedRequests = e.target.checked; markDirty(); });

        document.getElementById("btnDreqAddBlockedQuestion").addEventListener("click", addBlockedQuestion);

        AppHelpers.renderStringList("dreqAllowedNetworksContainer", config.allowedNetworks, "e.g. 10.0.0.0/8", markDirty);
        AppHelpers.renderStringList("dreqBlockedNetworksContainer", config.blockedNetworks, "e.g. 203.0.113.0/24", markDirty);
        AppHelpers.renderStringList("dreqAllowedLocalEndPointsContainer", config.allowedLocalEndPoints, "e.g. 10.0.0.1:853 or doh.example.com", markDirty);

        renderBlockedQuestions();
    }

    function renderBlockedQuestions() {
        const container = document.getElementById("dreqBlockedQuestionsContainer");

        if (config.blockedQuestions.length === 0) {
            container.innerHTML = '<p class="text-muted">No blocked-question rules configured.</p>';
            return;
        }

        container.innerHTML = `<table class="table table-condensed">
            <thead><tr><th>Domain</th><th>Include Subdomains</th><th>Type</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${config.blockedQuestions.map((q, idx) => `<tr>
                    <td><input type="text" class="form-control input-sm bq-name" data-index="${idx}" value="${escapeHtml(q.name || "")}" placeholder="e.g. example.com" /></td>
                    <td><label style="font-weight:normal;"><input type="checkbox" class="bq-blockzone" data-index="${idx}" ${q.blockZone ? "checked" : ""} /></label></td>
                    <td>
                        <select class="form-control input-sm bq-type" data-index="${idx}">
                            <option value="">(any type)</option>
                            ${RECORD_TYPES.map((t) => `<option value="${t}" ${q.type === t ? "selected" : ""}>${t}</option>`).join("")}
                        </select>
                    </td>
                    <td><button class="btn btn-danger btn-xs bq-remove" data-index="${idx}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".bq-name").forEach((inp) => {
            inp.addEventListener("input", () => {
                const q = config.blockedQuestions[parseInt(inp.getAttribute("data-index"), 10)];
                if (inp.value.trim() === "") delete q.name;
                else q.name = inp.value;
                markDirty();
            });
        });

        container.querySelectorAll(".bq-blockzone").forEach((chk) => {
            chk.addEventListener("change", () => {
                config.blockedQuestions[parseInt(chk.getAttribute("data-index"), 10)].blockZone = chk.checked;
                markDirty();
            });
        });

        container.querySelectorAll(".bq-type").forEach((sel) => {
            sel.addEventListener("change", () => {
                const q = config.blockedQuestions[parseInt(sel.getAttribute("data-index"), 10)];
                if (sel.value === "") delete q.type;
                else q.type = sel.value;
                markDirty();
            });
        });

        container.querySelectorAll(".bq-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                config.blockedQuestions.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                markDirty();
                renderBlockedQuestions();
            });
        });
    }

    function addBlockedQuestion() {
        config.blockedQuestions.push({});
        markDirty();
        renderBlockedQuestions();
    }

    initSubTabs();
})();
