(function () {
    "use strict";

    const bpPane = document.getElementById("mainTabPaneBlockPage");
    const root = document.getElementById("blockPageConfigRoot");

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
        const badge = document.getElementById("bpConfigDirtyBadge");
        if (badge) badge.style.display = "inline";
    }

    function clearDirty() {
        dirty = false;
        const badge = document.getElementById("bpConfigDirtyBadge");
        if (badge) badge.style.display = "none";
    }

    function newProfile(name) {
        return {
            name: name,
            enableWebServer: true,
            webServerLocalAddresses: ["0.0.0.0", "::"],
            webServerUseSelfSignedTlsCertificate: true,
            webServerTlsCertificateFilePath: null,
            webServerTlsCertificatePassword: null,
            webServerEnableOnlineCertificateSigning: true,
            webServerRootPath: "wwwroot",
            serveBlockPageFromWebServerRoot: false,
            blockPageTitle: "Website Blocked",
            blockPageHeading: "Website Blocked",
            blockPageMessage: "This website has been blocked by your network administrator.",
            includeBlockingInfo: true
        };
    }

    function normalizeConfig(raw) {
        if (!Array.isArray(raw)) raw = [];

        raw.forEach((p, i) => {
            if (typeof p !== "object" || p === null) { raw[i] = p = {}; }

            if (typeof p.name !== "string" || p.name === "") p.name = "default";
            if (typeof p.enableWebServer !== "boolean") p.enableWebServer = true;
            if (!Array.isArray(p.webServerLocalAddresses)) p.webServerLocalAddresses = ["0.0.0.0", "::"];
            if (typeof p.webServerUseSelfSignedTlsCertificate !== "boolean") p.webServerUseSelfSignedTlsCertificate = true;
            if (typeof p.webServerTlsCertificateFilePath === "undefined") p.webServerTlsCertificateFilePath = null;
            if (typeof p.webServerTlsCertificatePassword === "undefined") p.webServerTlsCertificatePassword = null;
            if (typeof p.webServerEnableOnlineCertificateSigning !== "boolean") p.webServerEnableOnlineCertificateSigning = true;
            if (typeof p.webServerRootPath !== "string" || p.webServerRootPath === "") p.webServerRootPath = "wwwroot";
            if (typeof p.serveBlockPageFromWebServerRoot !== "boolean") p.serveBlockPageFromWebServerRoot = false;
            if (typeof p.blockPageTitle === "undefined") p.blockPageTitle = "Website Blocked";
            if (typeof p.blockPageHeading === "undefined") p.blockPageHeading = "Website Blocked";
            if (typeof p.blockPageMessage === "undefined") p.blockPageMessage = "This website has been blocked by your network administrator.";
            if (typeof p.includeBlockingInfo !== "boolean") p.includeBlockingInfo = true;
        });

        return raw;
    }

    async function load() {
        root.innerHTML = "<p>Loading&hellip;</p>";
        try {
            const res = await apiFetch("/api/blockpage/config/raw");
            const data = await res.json();
            if (!data.success) {
                root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(data.error || "unknown error")}</p>`;
                return;
            }

            config = normalizeConfig(data.config || []);
            clearDirty();
            renderRoot();
        } catch (err) {
            root.innerHTML = `<p class="text-danger">Failed to load config: ${escapeHtml(err.message)}</p>`;
        }
    }

    async function save() {
        try {
            const res = await apiFetch("/api/blockpage/config/raw", {
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
        bpPane.querySelectorAll(".nav-tabs a[data-subtab]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                switchSubTab(link.getAttribute("data-subtab"));
            });
        });
    }

    function switchSubTab(subtab) {
        currentSubTab = subtab;

        bpPane.querySelectorAll(".nav-tabs > li").forEach((li) => li.classList.remove("active"));
        bpPane.querySelectorAll(".tab-content > .tab-pane").forEach((pane) => pane.classList.remove("active"));

        bpPane.querySelector(`.nav-tabs a[data-subtab="${subtab}"]`).closest("li").classList.add("active");
        document.getElementById("bpTabPaneConfig").classList.add("active");

        if (subtab === "config") onConfigTabActivated();
    }

    document.addEventListener("tabchange", (e) => {
        if (e.detail.tab !== "blockpage") return;
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
                        <div><span id="bpConfigDirtyBadge" class="label label-warning" style="display:none;">Unsaved changes</span></div>
                        <div>
                            <button id="btnBpConfigDiscard" class="btn btn-default btn-sm">Discard</button>
                            <button id="btnBpConfigSave" class="btn btn-primary btn-sm">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>

            <p class="text-muted">Each entry below is an independent web server profile (most setups only need one). Set the Blocking Type to Custom Address in the server's blocking settings and point Custom Blocking Addresses at this server's own IP for the block page to actually be shown to users.</p>

            <div id="bpProfilesContainer"></div>
            <button id="btnBpAddProfile" class="btn btn-default btn-sm"><span class="fa fa-plus"></span> Add Web Server Profile</button>
        `;

        document.getElementById("btnBpConfigSave").addEventListener("click", save);
        document.getElementById("btnBpConfigDiscard").addEventListener("click", discard);
        document.getElementById("btnBpAddProfile").addEventListener("click", addProfile);

        renderProfiles();
    }

    function profileNames() {
        return config.map((p) => p.name);
    }

    function renderProfiles() {
        const container = document.getElementById("bpProfilesContainer");

        if (config.length === 0) {
            container.innerHTML = '<p class="text-muted">No web server profiles configured - the block page will never be served.</p>';
            return;
        }

        container.innerHTML = config.map((p, idx) => {
            const dupWarning = profileNames().filter((n) => n === p.name).length > 1
                ? '<p class="text-danger" style="margin-bottom:8px;">Another profile also uses this name - only the last one with a given name actually takes effect.</p>'
                : "";

            return `<div class="well" style="margin-bottom:8px;">
                <div class="group-row" style="margin-bottom:8px;">
                    <input type="text" class="form-control input-sm profile-name" data-index="${idx}" value="${escapeHtml(p.name)}" style="flex:1; margin-right:8px; font-weight:600;" />
                    <button class="btn btn-danger btn-xs profile-remove" data-index="${idx}"><span class="fa fa-trash"></span></button>
                </div>

                ${dupWarning}

                <div class="form-horizontal">
                    <div class="form-group" style="margin-bottom:6px;">
                        <div class="col-sm-12">
                            <label style="font-weight:normal;"><input type="checkbox" class="profile-enable-webserver" data-index="${idx}" ${p.enableWebServer ? "checked" : ""} /> Enable Web Server</label>
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Local Addresses</label>
                        <div class="col-sm-9"><div id="bpProfileAddrs-${idx}"></div></div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Web Root Path</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm profile-rootpath" data-index="${idx}" value="${escapeHtml(p.webServerRootPath)}" placeholder="wwwroot" /></div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <div class="col-sm-12">
                            <label style="font-weight:normal;"><input type="checkbox" class="profile-serve-from-root" data-index="${idx}" ${p.serveBlockPageFromWebServerRoot ? "checked" : ""} /> Serve Block Page From Web Root (falls back to the built-in page if no index.html is found there)</label>
                        </div>
                    </div>

                    <p class="text-muted profile-fallback-note" data-index="${idx}" style="margin-bottom:6px; ${p.serveBlockPageFromWebServerRoot ? "" : "display:none;"}">Title/Heading/Message below are only a fallback, shown when no <code>index.html</code> is found in the Web Root Path above - they're ignored once you've placed one there.</p>

                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Page Title</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm profile-title" data-index="${idx}" value="${escapeHtml(p.blockPageTitle || "")}" /></div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Page Heading</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm profile-heading" data-index="${idx}" value="${escapeHtml(p.blockPageHeading || "")}" /></div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Page Message</label>
                        <div class="col-sm-9"><textarea class="form-control input-sm profile-message" data-index="${idx}" rows="2">${escapeHtml(p.blockPageMessage || "")}</textarea></div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <div class="col-sm-12">
                            <label style="font-weight:normal;"><input type="checkbox" class="profile-blocking-info" data-index="${idx}" ${p.includeBlockingInfo ? "checked" : ""} /> Include Blocking Info (why the domain was blocked)</label>
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom:0;">
                        <div class="col-sm-12"><strong>TLS</strong></div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <div class="col-sm-12">
                            <label style="font-weight:normal;"><input type="checkbox" class="profile-self-signed" data-index="${idx}" ${p.webServerUseSelfSignedTlsCertificate ? "checked" : ""} /> Use Self-Signed Certificate (ignored if a certificate file is set below)</label>
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <div class="col-sm-12">
                            <label style="font-weight:normal;"><input type="checkbox" class="profile-online-signing" data-index="${idx}" ${p.webServerEnableOnlineCertificateSigning ? "checked" : ""} /> Enable Online Certificate Signing</label>
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom:6px;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Certificate File</label>
                        <div class="col-sm-9"><input type="text" class="form-control input-sm profile-cert-path" data-index="${idx}" value="${escapeHtml(p.webServerTlsCertificateFilePath || "")}" placeholder="optional - .pfx or .p12 path" /></div>
                    </div>

                    <div class="form-group" style="margin-bottom:0;">
                        <label class="col-sm-3 control-label" style="font-weight:normal;">Certificate Password</label>
                        <div class="col-sm-9"><input type="password" class="form-control input-sm profile-cert-password" data-index="${idx}" value="${escapeHtml(p.webServerTlsCertificatePassword || "")}" placeholder="optional" /></div>
                    </div>
                </div>
            </div>`;
        }).join("");

        config.forEach((p, idx) => {
            AppHelpers.renderStringList(`bpProfileAddrs-${idx}`, p.webServerLocalAddresses, "0.0.0.0 or ::", markDirty);
        });

        container.querySelectorAll(".profile-name").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const idx = parseInt(inp.getAttribute("data-index"), 10);
                const newName = inp.value.trim();

                if (newName === "") { inp.value = config[idx].name; return; }
                if (newName === config[idx].name) return;

                if (config.some((p, i) => i !== idx && p.name === newName)) {
                    await uiAlert(`A profile called "${newName}" already exists.`);
                    inp.value = config[idx].name;
                    return;
                }

                config[idx].name = newName;
                markDirty();
                renderProfiles();
            });
        });

        container.querySelectorAll(".profile-enable-webserver").forEach((chk) => {
            chk.addEventListener("change", () => { config[parseInt(chk.getAttribute("data-index"), 10)].enableWebServer = chk.checked; markDirty(); });
        });
        container.querySelectorAll(".profile-rootpath").forEach((inp) => {
            inp.addEventListener("input", () => { config[parseInt(inp.getAttribute("data-index"), 10)].webServerRootPath = inp.value; markDirty(); });
        });
        container.querySelectorAll(".profile-serve-from-root").forEach((chk) => {
            chk.addEventListener("change", () => {
                const idx = chk.getAttribute("data-index");
                config[parseInt(idx, 10)].serveBlockPageFromWebServerRoot = chk.checked;
                markDirty();

                const note = container.querySelector(`.profile-fallback-note[data-index="${idx}"]`);
                if (note) note.style.display = chk.checked ? "" : "none";
            });
        });
        container.querySelectorAll(".profile-title").forEach((inp) => {
            inp.addEventListener("input", () => { config[parseInt(inp.getAttribute("data-index"), 10)].blockPageTitle = inp.value; markDirty(); });
        });
        container.querySelectorAll(".profile-heading").forEach((inp) => {
            inp.addEventListener("input", () => { config[parseInt(inp.getAttribute("data-index"), 10)].blockPageHeading = inp.value; markDirty(); });
        });
        container.querySelectorAll(".profile-message").forEach((inp) => {
            inp.addEventListener("input", () => { config[parseInt(inp.getAttribute("data-index"), 10)].blockPageMessage = inp.value; markDirty(); });
        });
        container.querySelectorAll(".profile-blocking-info").forEach((chk) => {
            chk.addEventListener("change", () => { config[parseInt(chk.getAttribute("data-index"), 10)].includeBlockingInfo = chk.checked; markDirty(); });
        });
        container.querySelectorAll(".profile-self-signed").forEach((chk) => {
            chk.addEventListener("change", () => { config[parseInt(chk.getAttribute("data-index"), 10)].webServerUseSelfSignedTlsCertificate = chk.checked; markDirty(); });
        });
        container.querySelectorAll(".profile-online-signing").forEach((chk) => {
            chk.addEventListener("change", () => { config[parseInt(chk.getAttribute("data-index"), 10)].webServerEnableOnlineCertificateSigning = chk.checked; markDirty(); });
        });
        container.querySelectorAll(".profile-cert-path").forEach((inp) => {
            inp.addEventListener("input", () => { config[parseInt(inp.getAttribute("data-index"), 10)].webServerTlsCertificateFilePath = inp.value || null; markDirty(); });
        });
        container.querySelectorAll(".profile-cert-password").forEach((inp) => {
            inp.addEventListener("input", () => { config[parseInt(inp.getAttribute("data-index"), 10)].webServerTlsCertificatePassword = inp.value || null; markDirty(); });
        });

        container.querySelectorAll(".profile-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                if (!(await uiConfirm(`Delete profile "${config[idx].name}"?`))) return;

                config.splice(idx, 1);
                markDirty();
                renderProfiles();
            });
        });
    }

    async function addProfile() {
        let name = await uiPrompt("Profile name:", "default");
        if (!name) return;
        name = name.trim();
        if (!name) return;

        if (profileNames().includes(name)) {
            await uiAlert(`A profile called "${name}" already exists.`);
            return;
        }

        config.push(newProfile(name));
        markDirty();
        renderProfiles();
    }

    initSubTabs();
})();
