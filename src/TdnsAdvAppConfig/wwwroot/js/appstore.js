(function () {
    "use strict";

    const asPane = document.getElementById("mainTabPaneAppStore");
    const installedRoot = document.getElementById("appStoreInstalledRoot");
    const availableRoot = document.getElementById("appStoreAvailableRoot");

    let currentSubTab = "installed";
    let installedLoaded = false;
    let availableLoaded = false;

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function initSubTabs() {
        asPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        asPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        asPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        asPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById(subtab === "installed" ? "asTabPaneInstalled" : "asTabPaneAvailable").classList.add("active");

        if (subtab === "installed") onInstalledTabActivated();
        else onAvailableTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "appstore") return;
        switchSubTab(currentSubTab);
    });

    document.addEventListener("authenticated", () => {
        if (installedLoaded) loadInstalled();
        if (availableLoaded) loadAvailable();
    });

    function onInstalledTabActivated() {
        if (!installedLoaded) {
            installedLoaded = true;
            loadInstalled();
        }
    }

    function onAvailableTabActivated() {
        if (!availableLoaded) {
            availableLoaded = true;
            loadAvailable();
        }
    }

    async function loadInstalled() {
        installedRoot.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/appstore/installed");
            const data = await res.json();
            if (!data.success) {
                installedRoot.innerHTML = `<p class="text-danger">Failed to load installed apps: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }
            renderInstalled(data.apps || []);
        } catch (err) {
            installedRoot.innerHTML = `<p class="text-danger">Failed to load installed apps: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderInstalled(apps) {
        if (apps.length === 0) {
            installedRoot.innerHTML = '<p class="text-muted">No DNS apps installed.</p>';
            return;
        }

        installedRoot.innerHTML = `<div class="list-group">${apps.map((app) => `
            <div class="list-group-item group-row">
                <div>
                    <span class="group-name">${escapeHtml(app.name)}</span>
                    <span class="label label-default">v${escapeHtml(app.version)}</span>
                    ${app.updateAvailable ? `<span class="label label-info">Update to v${escapeHtml(app.updateVersion)} available</span>` : ""}
                    <div class="text-muted" style="margin-top:4px;">${escapeHtml(app.description || "")}</div>
                </div>
                <div class="group-actions">
                    <button class="btn btn-danger btn-xs as-uninstall" data-name="${escapeHtml(app.name)}">Uninstall</button>
                </div>
            </div>
        `).join("")}</div>`;

        installedRoot.querySelectorAll(".as-uninstall").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const name = btn.getAttribute("data-name");
                if (!(await uiConfirm(`Uninstall "${name}"? This immediately stops it from processing DNS requests and deletes its configuration.`))) return;

                btn.disabled = true;
                try {
                    const res = await apiFetch("/api/appstore/uninstall", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name })
                    });
                    const data = await res.json();
                    if (!data.success) {
                        await uiAlert("Failed to uninstall: " + (data.error || "unknown error"));
                        btn.disabled = false;
                        return;
                    }

                    availableLoaded = false;
                    await loadInstalled();
                    if (window.refreshInstalledAppTabs) window.refreshInstalledAppTabs();
                } catch (err) {
                    await uiAlert("Failed to uninstall: " + err.message);
                    btn.disabled = false;
                }
            });
        });
    }

    async function loadAvailable() {
        availableRoot.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/appstore/available");
            const data = await res.json();
            if (!data.success) {
                availableRoot.innerHTML = `<p class="text-danger">Failed to load available apps: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }
            renderAvailable(data.apps || []);
        } catch (err) {
            availableRoot.innerHTML = `<p class="text-danger">Failed to load available apps: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderAvailable(apps) {
        if (apps.length === 0) {
            availableRoot.innerHTML = '<p class="text-muted">Everything in the store is already installed.</p>';
            return;
        }

        availableRoot.innerHTML = `<div class="list-group">${apps.map((app) => `
            <div class="list-group-item group-row">
                <div>
                    <span class="group-name">${escapeHtml(app.name)}</span>
                    <span class="label label-default">v${escapeHtml(app.version)}</span>
                    ${app.size ? `<span class="label label-default">${escapeHtml(app.size)}</span>` : ""}
                    <div class="text-muted" style="margin-top:4px;">${escapeHtml(app.description || "")}</div>
                </div>
                <div class="group-actions">
                    <button class="btn btn-default btn-xs as-install" data-name="${escapeHtml(app.name)}" data-url="${escapeHtml(app.url)}">Install</button>
                </div>
            </div>
        `).join("")}</div>`;

        availableRoot.querySelectorAll(".as-install").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const name = btn.getAttribute("data-name");
                const url = btn.getAttribute("data-url");
                if (!(await uiConfirm(`Install "${name}"? It starts processing DNS requests immediately once installed.`))) return;

                btn.disabled = true;
                btn.textContent = "Installing…";
                try {
                    const res = await apiFetch("/api/appstore/install", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, url })
                    });
                    const data = await res.json();
                    if (!data.success) {
                        await uiAlert("Failed to install: " + (data.error || "unknown error"));
                        btn.disabled = false;
                        btn.textContent = "Install";
                        return;
                    }

                    installedLoaded = false;
                    await loadAvailable();
                    if (window.refreshInstalledAppTabs) window.refreshInstalledAppTabs();
                } catch (err) {
                    await uiAlert("Failed to install: " + err.message);
                    btn.disabled = false;
                    btn.textContent = "Install";
                }
            });
        });
    }

    initSubTabs();
})();
