window.apiFetch = (function () {
    "use strict";

    const STORAGE_KEY = "apiSecret";
    const overlay = document.getElementById("authOverlay");
    const secretInput = document.getElementById("authSecretInput");
    const errorEl = document.getElementById("authError");
    const submitBtn = document.getElementById("authSubmitBtn");

    function getStoredSecret() {
        return localStorage.getItem(STORAGE_KEY) || "";
    }

    function setStoredSecret(value) {
        localStorage.setItem(STORAGE_KEY, value);
    }

    function showOverlay(message) {
        errorEl.style.display = message ? "block" : "none";
        errorEl.textContent = message || "";
        overlay.classList.add("visible");
        secretInput.focus();
    }

    function hideOverlay() {
        overlay.classList.remove("visible");
    }

    async function apiFetch(url, options) {
        options = options || {};
        options.headers = Object.assign({}, options.headers, {
            Authorization: "Bearer " + getStoredSecret()
        });

        const res = await fetch(url, options);

        if (res.status === 401) {
            showOverlay("Incorrect or missing secret.");
            throw new Error("Unauthorized");
        }

        return res;
    }

    async function trySubmittedSecret() {
        const candidate = secretInput.value;
        if (!candidate) return;

        setStoredSecret(candidate);
        submitBtn.disabled = true;

        try {
            const res = await fetch("/api/version", { headers: { Authorization: "Bearer " + candidate } });
            if (res.ok) {
                hideOverlay();
                document.dispatchEvent(new CustomEvent("authenticated"));
            } else {
                showOverlay("Incorrect secret. Try again.");
            }
        } catch (err) {
            showOverlay("Could not reach the addon: " + err.message);
        } finally {
            submitBtn.disabled = false;
        }
    }

    submitBtn.addEventListener("click", trySubmittedSecret);
    secretInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") trySubmittedSecret();
    });

    return apiFetch;
})();

(function () {
    "use strict";

    const statusPanel = document.getElementById("statusPanel");
    const groupsList = document.getElementById("groupsList");
    const versionLabel = document.getElementById("versionLabel");
    const btnCheckUpdate = document.getElementById("btnCheckUpdate");
    const btnApplyUpdate = document.getElementById("btnApplyUpdate");
    const updateStatus = document.getElementById("updateStatus");
    const liUpdateStatus = document.getElementById("liUpdateStatus");
    const liApplyUpdate = document.getElementById("liApplyUpdate");
    const mnuOptions = document.getElementById("mnuOptions");
    const mnuOptionsToggle = document.getElementById("mnuOptionsToggle");

    let latestReleaseUrl = null;

    const mainTabPaneIds = {
        dashboard: "mainTabPaneDashboard",
        advancedblocking: "mainTabPaneAdvancedBlocking",
        advancedforwarding: "mainTabPaneAdvancedForwarding",
        splithorizon: "mainTabPaneSplitHorizon",
        blockpage: "mainTabPaneBlockPage",
        defaultrecords: "mainTabPaneDefaultRecords",
        dnsblocklist: "mainTabPaneDnsBlockList",
        dnsrebindingprotection: "mainTabPaneDnsRebindingProtection",
        autoptr: "mainTabPaneAutoPtr",
        dns64: "mainTabPaneDns64",
        droprequests: "mainTabPaneDropRequests",
        filteraaaa: "mainTabPaneFilterAaaa",
        geocontinent: "mainTabPaneGeoContinent",
        geocountry: "mainTabPaneGeoCountry",
        geodistance: "mainTabPaneGeoDistance",
        failover: "mainTabPaneFailover",
        logexporter: "mainTabPaneLogExporter",
        nodata: "mainTabPaneNoData",
        nxdomain: "mainTabPaneNxDomain",
        nxdomainoverride: "mainTabPaneNxDomainOverride",
        querylogsmysql: "mainTabPaneQueryLogsMySql",
        querylogspostgresql: "mainTabPaneQueryLogsPostgreSql",
        querylogssqlserver: "mainTabPaneQueryLogsSqlServer",
        querylogssqlite: "mainTabPaneQueryLogsSqlite",
        weightedroundrobin: "mainTabPaneWeightedRoundRobin",
        whatismydns: "mainTabPaneWhatIsMyDns",
        wildip: "mainTabPaneWildIp",
        zonealias: "mainTabPaneZoneAlias",
        appstore: "mainTabPaneAppStore"
    };

    function wireTabLink(link) {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            switchTab(link.getAttribute("data-tab"));
        });
    }

    function initTabs() {
        document.querySelectorAll("#content > .container > .nav-tabs a[data-tab]").forEach(wireTabLink);
    }

    function switchTab(tab) {
        document.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        document.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        document.querySelector(`.nav-tabs a[data-tab="${tab}"]`).closest("li").classList.add("active");
        document.getElementById(mainTabPaneIds[tab]).classList.add("active");

        document.dispatchEvent(new CustomEvent("tabchange", { detail: { tab } }));
    }

    window.mainTabs = {
        registerPane: (key, paneId) => { mainTabPaneIds[key] = paneId; },
        unregisterPane: (key) => { delete mainTabPaneIds[key]; },
        wireTabLink,
        switchTab
    };

    const abPane = document.getElementById("mainTabPaneAdvancedBlocking");
    let abCurrentSubTab = "dashboard";

    function initAbSubTabs() {
        abPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchAbSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchAbSubTab(subtab) {
        abCurrentSubTab = subtab;

        abPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        abPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        abPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "dashboard" ? "abTabPaneDashboard" : "abTabPaneConfig").classList.add("active");

        document.dispatchEvent(new CustomEvent("abtabchange", { detail: { subtab } }));
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab === "advancedblocking") switchAbSubTab(abCurrentSubTab);
    });

    mnuOptionsToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        mnuOptions.classList.toggle("open");
    });

    document.addEventListener("click", () => {
        mnuOptions.classList.remove("open");
    });

    mnuOptions.querySelector(".dropdown-menu").addEventListener("click", (e) => {
        e.stopPropagation();
    });

    function applyLightMode() {
        document.body.className = "light-mode";
    }

    function applyDarkMode() {
        document.body.className = "dark-mode";
    }

    function applyAmberMode() {
        document.body.className = "amber-mode";
    }

    function changeTheme(newTheme) {
        switch (newTheme) {
            case "light": applyLightMode(); break;
            case "dark": applyDarkMode(); break;
            case "amber": applyAmberMode(); break;
            default:
                if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
                    applyDarkMode();
                else
                    applyLightMode();
                break;
        }

        if (newTheme)
            localStorage.setItem("theme", newTheme);
        else
            localStorage.removeItem("theme");

        updateThemeSwitcherUI(newTheme);
    }

    function themeLinks() {
        return mnuOptions.querySelectorAll("a[data-theme]");
    }

    function updateThemeSwitcherUI(currentTheme) {
        themeLinks().forEach((a) => {
            const isActive = (a.getAttribute("data-theme") === "system" && !currentTheme) || a.getAttribute("data-theme") === currentTheme;
            a.classList.toggle("active", isActive);
        });
    }

    function initTheme() {
        if (window.matchMedia) {
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
                const currentTheme = localStorage.getItem("theme");
                if (currentTheme) return;

                if (e.matches)
                    applyDarkMode();
                else
                    applyLightMode();
            });
        }

        const currentTheme = localStorage.getItem("theme");
        updateThemeSwitcherUI(currentTheme);

        themeLinks().forEach((a) => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                const theme = a.getAttribute("data-theme");
                changeTheme(theme === "system" ? null : theme);
            });
        });
    }

    function isDurationEditInProgress() {
        const active = document.activeElement;
        if (active && typeof active.closest === "function" && active.closest(".pause-duration, .custom-duration-value, .custom-duration-unit")) {
            return true;
        }

        return Array.from(document.querySelectorAll(".pause-duration")).some((sel) => sel.value === "custom");
    }

    async function fetchStatus() {
        if (isDurationEditInProgress()) return;

        try {
            const res = await apiFetch("/api/status");
            const data = await res.json();
            renderStatus(data);
        } catch (err) {
            statusPanel.innerHTML = `<p class="text-danger">Failed to reach the addon backend: ${escapeHtml(err.message)}</p>`;
            groupsList.innerHTML = "";
        }
    }

    function renderStatus(data) {
        if (!data.connected) {
            statusPanel.innerHTML = `<p class="text-danger"><span class="fa fa-exclamation-triangle"></span> Could not reach the Technitium DNS Server: ${escapeHtml(data.error || "unknown error")}</p>`;
            groupsList.innerHTML = "";
            return;
        }

        const rootBadge = data.rootEnableBlocking
            ? '<span class="label label-success">Advanced Blocking Enabled</span>'
            : '<span class="label label-danger">Advanced Blocking Disabled for All Groups</span>';

        const rootCountdownHtml = (!data.rootEnableBlocking && data.rootResumeAt)
            ? ` <span class="text-muted">resumes in <span class="countdown" data-resume-at="${escapeHtml(data.rootResumeAt)}">${formatDuration(remainingSeconds(data.rootResumeAt))}</span></span>`
            : "";

        const rootActionsHtml = data.rootEnableBlocking
            ? `<span id="rootActions">${durationControlsHtml()}
               <button class="btn btn-danger btn-sm" id="btnRootToggle" data-enabled="false">Pause All Groups</button></span>`
            : `<button class="btn btn-success btn-sm" id="btnRootToggle" data-enabled="true">${data.rootResumeAt ? "Resume Now" : "Resume All Groups"}</button>`;

        statusPanel.innerHTML = `<div class="group-row">
            <div>${rootBadge}${rootCountdownHtml}</div>
            <div>${rootActionsHtml}</div>
        </div>`;

        document.getElementById("btnRootToggle").addEventListener("click", onRootToggleClick);
        wireDurationControls(statusPanel);

        if (!data.rootEnableBlocking) {
            groupsList.innerHTML = '<div class="list-group-item text-muted">All groups below are overridden by the master switch while it is off.</div>' + (data.groups || []).map(renderGroupRow).join("");
            groupsList.querySelectorAll("button[data-group]").forEach((btn) => {
                btn.addEventListener("click", onToggleClick);
            });
            wireDurationControls(groupsList);
            return;
        }

        if (!data.groups || data.groups.length === 0) {
            groupsList.innerHTML = '<div class="list-group-item">No groups configured.</div>';
            return;
        }

        groupsList.innerHTML = data.groups.map(renderGroupRow).join("");

        groupsList.querySelectorAll("button[data-group]").forEach((btn) => {
            btn.addEventListener("click", onToggleClick);
        });
        wireDurationControls(groupsList);
    }

    function durationControlsHtml() {
        return `<select class="form-control input-sm pause-duration">
                <option value="0">Indefinitely</option>
                <option value="5">5 min</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">1 hour</option>
                <option value="custom">Custom&hellip;</option>
            </select>
            <span class="custom-duration-inputs" style="display:none;">
                <input type="number" class="form-control input-sm custom-duration-value" min="1" value="10" />
                <select class="form-control input-sm custom-duration-unit">
                    <option value="minutes">min</option>
                    <option value="hours">hrs</option>
                </select>
            </span>`;
    }

    function wireDurationControls(scopeEl) {
        scopeEl.querySelectorAll(".pause-duration").forEach((sel) => {
            sel.addEventListener("change", () => {
                const customInputs = sel.parentElement.querySelector(".custom-duration-inputs");
                if (customInputs) customInputs.style.display = sel.value === "custom" ? "inline-block" : "none";
            });
        });
    }

    function readDurationMinutes(scopeEl) {
        const sel = scopeEl.querySelector(".pause-duration");
        if (!sel) return null;

        if (sel.value === "custom") {
            const valueInput = scopeEl.querySelector(".custom-duration-value");
            const unitSelect = scopeEl.querySelector(".custom-duration-unit");
            const rawValue = valueInput ? parseFloat(valueInput.value) : NaN;

            if (!rawValue || rawValue <= 0) return undefined;

            const unit = unitSelect ? unitSelect.value : "minutes";
            const minutes = unit === "hours" ? rawValue * 60 : rawValue;
            return Math.max(1, Math.round(minutes));
        }

        const val = parseInt(sel.value, 10);
        return val > 0 ? val : null;
    }

    function renderGroupRow(group) {
        const isActive = group.enableBlocking;
        const badge = isActive
            ? '<span class="label label-success">Active</span>'
            : '<span class="label label-default">Paused</span>';

        const countdownHtml = (!isActive && group.resumeAt)
            ? ` <span class="text-muted">resumes in <span class="countdown" data-resume-at="${escapeHtml(group.resumeAt)}">${formatDuration(remainingSeconds(group.resumeAt))}</span></span>`
            : "";

        const actionsHtml = isActive
            ? `${durationControlsHtml()}
               <button class="btn btn-warning btn-xs" data-group="${escapeHtml(group.name)}" data-enabled="false">Pause</button>`
            : `<button class="btn btn-success btn-xs" data-group="${escapeHtml(group.name)}" data-enabled="true">${group.resumeAt ? "Resume Now" : "Resume"}</button>`;

        return `<div class="list-group-item group-row">
            <div><span class="group-name">${escapeHtml(group.name)}</span> ${badge}${countdownHtml}</div>
            <div class="group-actions">${actionsHtml}</div>
        </div>`;
    }

    async function onRootToggleClick(e) {
        const btn = e.currentTarget;
        const enabled = btn.getAttribute("data-enabled") === "true";

        let durationMinutes = null;

        if (!enabled) {
            if (!(await uiConfirm("Pause blocking for ALL groups? This overrides every group's individual setting."))) return;

            durationMinutes = readDurationMinutes(document.getElementById("rootActions"));
            if (durationMinutes === undefined) {
                await uiAlert("Enter a valid custom duration.");
                return;
            }
        }

        btn.disabled = true;

        try {
            const res = await apiFetch("/api/root/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled, durationMinutes })
            });
            const data = await res.json();

            if (!data.success) {
                await uiAlert("Failed to update master switch: " + (data.error || "unknown error"));
                btn.disabled = false;
                return;
            }

            renderStatus({ connected: true, rootEnableBlocking: data.rootEnableBlocking, rootResumeAt: data.rootResumeAt, groups: data.groups });
        } catch (err) {
            await uiAlert("Failed to update master switch: " + err.message);
            btn.disabled = false;
        }
    }

    async function onToggleClick(e) {
        const btn = e.currentTarget;
        const name = btn.getAttribute("data-group");
        const enabled = btn.getAttribute("data-enabled") === "true";

        let durationMinutes = null;

        if (!enabled) {
            const row = btn.closest(".list-group-item");
            durationMinutes = row ? readDurationMinutes(row) : null;
            if (durationMinutes === undefined) {
                await uiAlert("Enter a valid custom duration.");
                return;
            }
        }

        btn.disabled = true;

        try {
            const res = await apiFetch("/api/groups/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, enabled, durationMinutes })
            });
            const data = await res.json();

            if (!data.success) {
                await uiAlert("Failed to update group: " + (data.error || "unknown error"));
                btn.disabled = false;
                return;
            }

            renderStatus({ connected: true, rootEnableBlocking: data.rootEnableBlocking, rootResumeAt: data.rootResumeAt, groups: data.groups });
        } catch (err) {
            await uiAlert("Failed to update group: " + err.message);
            btn.disabled = false;
        }
    }

    async function fetchVersion() {
        try {
            const res = await apiFetch("/api/version");
            const data = await res.json();
            versionLabel.textContent = "v" + data.version;
        } catch {
            versionLabel.textContent = "";
        }
    }

    async function checkForUpdates() {
        liUpdateStatus.style.display = "block";
        updateStatus.textContent = "Checking…";
        liApplyUpdate.style.display = "none";

        try {
            const res = await apiFetch("/api/updates/check");
            const data = await res.json();

            if (data.error) {
                updateStatus.textContent = "Check failed: " + data.error;
                return;
            }

            if (data.updateAvailable) {
                updateStatus.textContent = `Update available: v${data.latestVersion}`;
                latestReleaseUrl = data.releaseNotesUrl;
                liApplyUpdate.style.display = "block";
            } else {
                updateStatus.textContent = "Up to date (v" + data.currentVersion + ")";
            }
        } catch (err) {
            updateStatus.textContent = "Check failed: " + err.message;
        }
    }

    async function applyUpdate() {
        if (!(await uiConfirm("Apply the update now? The addon will restart automatically."))) return;

        liApplyUpdate.style.display = "none";
        updateStatus.textContent = "Updating…";

        try {
            const res = await apiFetch("/api/updates/apply", { method: "POST" });
            const data = await res.json();

            if (!data.success) {
                updateStatus.textContent = data.message || data.error || "Update could not be applied.";
                return;
            }

            updateStatus.textContent = "Restarting…";
            pollHealth();
        } catch (err) {
            updateStatus.textContent = "Update failed: " + err.message;
        }
    }

    function pollHealth() {
        let attempts = 0;
        const interval = setInterval(async () => {
            attempts++;
            try {
                const res = await apiFetch("/api/health");
                if (res.ok) {
                    clearInterval(interval);
                    location.reload();
                    return;
                }
            } catch {
            }

            if (attempts > 60) {
                clearInterval(interval);
                updateStatus.textContent = "Still restarting… refresh manually once it's back.";
            }
        }, 2000);
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function formatDuration(totalSeconds) {
        if (totalSeconds <= 0) return "0:00";

        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const mm = String(m).padStart(2, "0");
        const ss = String(s).padStart(2, "0");

        return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
    }

    function remainingSeconds(resumeAtIso) {
        const resumeAt = new Date(resumeAtIso).getTime();
        return Math.max(0, Math.floor((resumeAt - Date.now()) / 1000));
    }

    function tickCountdowns() {
        document.querySelectorAll(".countdown").forEach((el) => {
            const remaining = remainingSeconds(el.getAttribute("data-resume-at"));
            el.textContent = formatDuration(remaining);

            if (remaining === 0) setTimeout(fetchStatus, 1500);
        });
    }

    btnCheckUpdate.addEventListener("click", (e) => { e.preventDefault(); checkForUpdates(); });
    btnApplyUpdate.addEventListener("click", (e) => { e.preventDefault(); applyUpdate(); });

    document.addEventListener("authenticated", () => {
        fetchStatus();
        fetchVersion();
    });

    initTheme();
    initTabs();
    initAbSubTabs();
    fetchStatus();
    fetchVersion();
    setInterval(fetchStatus, 15000);
    setInterval(tickCountdowns, 1000);
})();
