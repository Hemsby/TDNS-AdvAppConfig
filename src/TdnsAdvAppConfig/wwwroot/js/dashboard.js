(function () {
    "use strict";

    const root = document.getElementById("dashboardAppTogglesRoot");

    let items = [];

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    async function load() {
        if (!root) return;

        root.innerHTML = "<p>Loading&hellip;</p>";

        try {
            const [togglesRes, statusRes] = await Promise.all([
                apiFetch("/api/dashboard/apptoggles"),
                apiFetch("/api/status")
            ]);
            const togglesData = await togglesRes.json();
            const statusData = await statusRes.json();

            if (!togglesData.success) {
                root.innerHTML = `<p class="text-danger">Failed to load app toggles: ${escapeHtml(togglesData.error || "unknown error")}</p>`;
                return;
            }

            items = togglesData.toggles.map((t) => ({ ...t, special: null }));

            if (statusData.connected) {
                items.push({
                    key: "advancedblocking",
                    displayName: "Advanced Blocking",
                    enabled: statusData.rootEnableBlocking,
                    error: null,
                    special: "advancedblocking"
                });
            }

            items.sort((a, b) => a.displayName.localeCompare(b.displayName));

            renderRoot();
        } catch (err) {
            root.innerHTML = `<p class="text-danger">Failed to load app toggles: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderRoot() {
        root.innerHTML = `
            <div class="panel panel-default">
                <div class="panel-heading"><h3 class="panel-title">App Toggles</h3></div>
                <div class="panel-body">
                    <p class="text-muted">Installed apps with a single on/off master switch. Toggling here saves immediately - the same as flipping it on that app's own Config tab.</p>
                    <div id="dashboardAppTogglesContainer"></div>
                </div>
            </div>
        `;

        renderList();
    }

    function renderRow(item) {
        return `<div class="list-group-item group-row">
            <div>
                <a href="#" class="dashboard-app-link" data-key="${escapeHtml(item.key)}">${escapeHtml(item.displayName)}</a>
                ${item.error ? `<span class="text-danger" style="font-size:12px; margin-left:8px;">${escapeHtml(item.error)}</span>` : ""}
            </div>
            <div>
                <label class="toggle-switch">
                    <input type="checkbox" class="dashboard-app-toggle" data-key="${escapeHtml(item.key)}" ${item.enabled ? "checked" : ""} ${item.error ? "disabled" : ""} />
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>`;
    }

    function renderSection(title, sectionItems) {
        if (sectionItems.length === 0) return "";

        return `<h4 style="margin-top:16px;">${escapeHtml(title)} <span class="text-muted" style="font-weight:normal; font-size:13px;">(${sectionItems.length})</span></h4>
            <div class="list-group">${sectionItems.map(renderRow).join("")}</div>`;
    }

    function renderList() {
        const container = document.getElementById("dashboardAppTogglesContainer");

        if (items.length === 0) {
            container.innerHTML = '<p class="text-muted">None of the installed apps have a single on/off master switch.</p>';
            return;
        }

        const enabledItems = items.filter((i) => !i.error && i.enabled === true);
        const disabledItems = items.filter((i) => !i.error && i.enabled === false);
        const errorItems = items.filter((i) => i.error);

        container.innerHTML =
            renderSection("Enabled", enabledItems) +
            renderSection("Disabled", disabledItems) +
            renderSection("Unavailable", errorItems);

        container.querySelectorAll(".dashboard-app-link").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                window.mainTabs.switchTab(link.getAttribute("data-key"));
            });
        });

        container.querySelectorAll(".dashboard-app-toggle").forEach((checkbox) => {
            checkbox.addEventListener("change", async () => {
                const key = checkbox.getAttribute("data-key");
                const item = items.find((i) => i.key === key);
                const newEnabled = checkbox.checked;

                checkbox.disabled = true;

                try {
                    const url = item.special === "advancedblocking" ? "/api/root/toggle" : "/api/dashboard/apptoggles/set";
                    const body = item.special === "advancedblocking" ? { enabled: newEnabled } : { key, enabled: newEnabled };

                    const res = await apiFetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body)
                    });
                    const data = await res.json();

                    if (!data.success) {
                        checkbox.checked = !newEnabled;
                        checkbox.disabled = false;
                        await uiAlert(`Failed to ${newEnabled ? "enable" : "disable"} "${item.displayName}": ` + (data.error || "unknown error"));
                        return;
                    }

                    item.enabled = newEnabled;
                    checkbox.disabled = false;
                    renderList();
                } catch (err) {
                    checkbox.checked = !newEnabled;
                    checkbox.disabled = false;
                    await uiAlert(`Failed to ${newEnabled ? "enable" : "disable"} "${item.displayName}": ` + err.message);
                }
            });
        });
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "dashboard") return;
        load();
    });

    document.addEventListener("authenticated", load);

    load();
})();
