(function () {
    "use strict";

    const nxdPane = document.getElementById("mainTabPaneNxDomain");
    const root = document.getElementById("nxDomainConfigRoot");

    let config = null;
    let loaded = false;
    let dirty = false;
    let currentSubTab = "config";

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function markDirty() {
        dirty = true;
        const badge = document.getElementById("nxdConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("nxdConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function normalizeConfig(raw) {
        if (typeof raw !== "object" || raw === null) raw = {};

        if (typeof raw.appPreference !== "number") raw.appPreference = 20;
        if (typeof raw.enableBlocking !== "boolean") raw.enableBlocking = true;
        if (typeof raw.allowTxtBlockingReport !== "boolean") raw.allowTxtBlockingReport = false;
        if (!Array.isArray(raw.blocked)) raw.blocked = [];

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/nxdomain/config/raw");
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
        config.blocked = config.blocked.map((d) => (d || "").trim().toLowerCase()).filter((d) => d !== "");

        const duplicates = config.blocked.filter((d, i) => config.blocked.indexOf(d) !== i);
        if (duplicates.length > 0) {
            await uiAlert(`"${duplicates[0]}" is listed more than once in the blocked list - the app fails to reload with a duplicate entry. Remove the repeat before saving.`);
            return;
        }

        try {
            const res = await apiFetch("/api/nxdomain/config/raw", {
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
            renderRoot();
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
        nxdPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        nxdPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        nxdPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        nxdPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("nxdTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "nxdomain") return;
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
                        <div><span id="nxdConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnNxdConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnNxdConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">General</h3></div>
                <div class="panel-body">
                    <div class="form-horizontal">
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3"><label><input type="checkbox" id="nxdEnableBlocking" /> Enable Blocking</label></div>
                        </div>
                        <div class="form-group">
                            <div class="col-sm-9 col-sm-offset-3">
                                <label><input type="checkbox" id="nxdAllowTxtReport" /> Allow TXT Blocking Reports</label>
                                <p class="text-muted" style="font-size:12px; margin: 4px 0 0 20px;">Reveals which domain triggered the block to whoever queries - useful for debugging, but only enable if that's acceptable for your clients.</p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="col-sm-3 control-label">App Preference</label>
                            <div class="col-sm-9">
                                <input type="number" class="form-control" id="nxdAppPreference" min="0" max="255" />
                                <p class="text-muted" style="font-size:12px; margin-top:4px;">Execution order relative to other apps - lower runs earlier. Leave at the default unless you know you need to change it.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">Blocked Domains</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Blocking a domain also blocks every subdomain beneath it. Queries for a blocked domain get NXDOMAIN.</p>
                    <div id="nxdBlockedContainer"></div>
                </div>
            </div>
        `;

        document.getElementById("btnNxdConfigSave").addEventListener("click", save);
        document.getElementById("btnNxdConfigDiscard").addEventListener("click", discard);

        document.getElementById("nxdEnableBlocking").checked = config.enableBlocking;
        document.getElementById("nxdEnableBlocking").addEventListener("change", (e) => { config.enableBlocking = e.target.checked; markDirty(); });

        document.getElementById("nxdAllowTxtReport").checked = config.allowTxtBlockingReport;
        document.getElementById("nxdAllowTxtReport").addEventListener("change", (e) => { config.allowTxtBlockingReport = e.target.checked; markDirty(); });

        const preferenceInput = document.getElementById("nxdAppPreference");
        preferenceInput.value = config.appPreference;
        preferenceInput.addEventListener("input", (e) => { config.appPreference = parseInt(e.target.value, 10) || 0; markDirty(); });

        AppHelpers.renderStringList("nxdBlockedContainer", config.blocked, "e.g. example.com", markDirty);
    }

    initSubTabs();
})();
