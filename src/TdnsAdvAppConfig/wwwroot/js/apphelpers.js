window.AppHelpers = (function () {
    "use strict";

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function parseNetworkKeyForSort(key) {
        try {
            const trimmed = String(key).trim();
            const slashIdx = trimmed.indexOf("/");
            const addr = slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
            const prefixStr = slashIdx === -1 ? null : trimmed.slice(slashIdx + 1);

            let family, value, defaultPrefix;

            if (addr.indexOf(":") !== -1) {
                family = 1;
                defaultPrefix = 128;

                const dblIdx = addr.indexOf("::");
                let groups;

                if (dblIdx !== -1) {
                    if (addr.indexOf("::", dblIdx + 1) !== -1) throw new Error("multiple ::");
                    const left = addr.slice(0, dblIdx);
                    const right = addr.slice(dblIdx + 2);
                    const leftGroups = left === "" ? [] : left.split(":");
                    const rightGroups = right === "" ? [] : right.split(":");
                    const missing = 8 - (leftGroups.length + rightGroups.length);
                    if (missing < 0) throw new Error("too many groups");
                    groups = leftGroups.concat(new Array(missing).fill("0")).concat(rightGroups);
                } else {
                    groups = addr.split(":");
                    if (groups.length !== 8) throw new Error("wrong group count");
                }

                if (groups.length !== 8) throw new Error("wrong group count");

                value = 0n;
                for (const g of groups) {
                    if (g.indexOf(".") !== -1) {
                        // IPv4-mapped tail (e.g. ::ffff:192.168.1.1) - not expected here, treat as invalid
                        throw new Error("embedded IPv4 not supported");
                    }
                    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new Error("bad hex group");
                    value = value * 65536n + BigInt(parseInt(g, 16));
                }
            } else {
                family = 0;
                defaultPrefix = 32;

                const parts = addr.split(".");
                if (parts.length !== 4) throw new Error("wrong octet count");

                value = 0n;
                for (const p of parts) {
                    if (!/^\d{1,3}$/.test(p)) throw new Error("bad octet");
                    const n = parseInt(p, 10);
                    if (n < 0 || n > 255) throw new Error("octet out of range");
                    value = value * 256n + BigInt(n);
                }
            }

            let prefixLen = defaultPrefix;
            if (prefixStr !== null) {
                if (!/^\d{1,3}$/.test(prefixStr)) throw new Error("bad prefix");
                prefixLen = parseInt(prefixStr, 10);
                if (prefixLen < 0 || prefixLen > defaultPrefix) throw new Error("prefix out of range");
            }

            const isCatchAll = value === 0n && prefixLen === 0;

            return { ok: true, family, value, prefixLen, isCatchAll };
        } catch (e) {
            return { ok: false };
        }
    }

    function compareNetworkKeys(a, b) {
        const pa = parseNetworkKeyForSort(a);
        const pb = parseNetworkKeyForSort(b);

        const rank = (p) => (!p.ok ? 2 : (p.isCatchAll ? 1 : 0));
        const ra = rank(pa), rb = rank(pb);
        if (ra !== rb) return ra - rb;
        if (ra === 2) return String(a).localeCompare(String(b));

        if (pa.family !== pb.family) return pa.family - pb.family;
        if (pa.value !== pb.value) return pa.value < pb.value ? -1 : 1;
        return pa.prefixLen - pb.prefixLen;
    }

    function renderGroupMapTable(containerId, mapObj, keyLabel, keyPlaceholder, groupNamesFn, markDirty, groupNoun, sortAsNetwork) {
        groupNoun = groupNoun || "group";

        const container = document.getElementById(containerId);
        const keys = Object.keys(mapObj);
        if (sortAsNetwork) keys.sort(compareNetworkKeys);
        const rerender = () => renderGroupMapTable(containerId, mapObj, keyLabel, keyPlaceholder, groupNamesFn, markDirty, groupNoun, sortAsNetwork);

        if (keys.length === 0) {
            container.innerHTML = '<p class="text-muted">No mappings configured.</p>';
            return;
        }

        const groupNames = groupNamesFn();

        if (groupNames.length === 0) {
            container.innerHTML = `<p class="text-danger">Create a ${escapeHtml(groupNoun)} below before mapping to one.</p>`;
            return;
        }

        container.innerHTML = `<table class="table table-hover table-condensed">
            <thead><tr><th>${escapeHtml(keyLabel)}</th><th>Group</th><th style="width:40px;"></th></tr></thead>
            <tbody>
                ${keys.map((key) => `<tr>
                    <td><input type="text" class="form-control input-sm map-key" data-orig-key="${escapeHtml(key)}" value="${escapeHtml(key)}" placeholder="${escapeHtml(keyPlaceholder)}" /></td>
                    <td><select class="form-control input-sm map-value" data-key="${escapeHtml(key)}">
                        ${groupNames.map((g) => `<option value="${escapeHtml(g)}" ${g === mapObj[key] ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}
                    </select></td>
                    <td><button class="btn btn-danger btn-xs map-remove" data-key="${escapeHtml(key)}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;

        container.querySelectorAll(".map-value").forEach((sel) => {
            sel.addEventListener("change", () => {
                mapObj[sel.getAttribute("data-key")] = sel.value;
                markDirty();
            });
        });

        container.querySelectorAll(".map-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                delete mapObj[btn.getAttribute("data-key")];
                markDirty();
                rerender();
            });
        });

        container.querySelectorAll(".map-key").forEach((inp) => {
            inp.addEventListener("blur", async () => {
                const oldKey = inp.getAttribute("data-orig-key");
                const newKey = inp.value.trim();

                if (newKey === oldKey) return;

                if (newKey === "") {
                    inp.value = oldKey;
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(mapObj, newKey)) {
                    await uiAlert(`A mapping for "${newKey}" already exists.`);
                    inp.value = oldKey;
                    return;
                }

                mapObj[newKey] = mapObj[oldKey];
                delete mapObj[oldKey];
                markDirty();
                rerender();
            });
        });
    }

    function renderStringList(containerId, arrayRef, placeholder, markDirty) {
        const container = document.getElementById(containerId);
        const rerender = () => renderStringList(containerId, arrayRef, placeholder, markDirty);

        container.innerHTML = `<table class="table table-condensed" style="margin-bottom:8px;">
            <tbody>
                ${arrayRef.map((val, i) => `<tr>
                    <td><input type="text" class="form-control input-sm string-list-item" data-index="${i}" value="${escapeHtml(val)}" placeholder="${escapeHtml(placeholder)}" /></td>
                    <td style="width:40px;"><button class="btn btn-danger btn-xs string-list-remove" data-index="${i}"><span class="fa fa-trash"></span></button></td>
                </tr>`).join("")}
            </tbody>
        </table>
        <button class="btn btn-default btn-xs string-list-add"><span class="fa fa-plus"></span> Add</button>`;

        container.querySelectorAll(".string-list-item").forEach((inp) => {
            inp.addEventListener("input", () => {
                arrayRef[parseInt(inp.getAttribute("data-index"), 10)] = inp.value;
                markDirty();
            });
        });

        container.querySelectorAll(".string-list-remove").forEach((btn) => {
            btn.addEventListener("click", () => {
                arrayRef.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
                markDirty();
                rerender();
            });
        });

        container.querySelector(".string-list-add").addEventListener("click", () => {
            arrayRef.push("");
            markDirty();
            rerender();
            const inputs = container.querySelectorAll(".string-list-item");
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
    }

    function renderBadgePicker(containerId, arrayRef, optionsFn, markDirty, opts) {
        opts = opts || {};
        const labelFn = opts.labelFn || ((v) => v);

        const container = document.getElementById(containerId);
        const rerender = () => renderBadgePicker(containerId, arrayRef, optionsFn, markDirty, opts);

        const allOptions = optionsFn();
        const available = allOptions.filter((o) => !arrayRef.includes(o));

        let html = "";

        if (arrayRef.length === 0) {
            html += `<p class="text-muted">${escapeHtml(opts.emptyText || "None selected yet.")}</p>`;
        } else {
            html += `<div style="margin-bottom:6px;">${arrayRef.map((v) => `<span class="label label-default" style="margin-right:6px; font-size:100%;">
                ${escapeHtml(labelFn(v))} <a href="#" class="badge-picker-remove" data-value="${escapeHtml(v)}" style="color:inherit; text-decoration:none; margin-left:4px;">&times;</a>
            </span>`).join("")}</div>`;
        }

        if (available.length > 0) {
            html += `<div class="group-row">
                <select class="form-control input-sm badge-picker-select" style="max-width:220px; margin-right:8px;">
                    ${available.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(labelFn(o))}</option>`).join("")}
                </select>
                <button class="btn btn-default btn-xs badge-picker-add"><span class="fa fa-plus"></span> ${escapeHtml(opts.addLabel || "Add")}</button>
            </div>`;
        } else if (allOptions.length === 0 && opts.noOptionsText) {
            html += `<p class="text-danger" style="font-size:12px;">${escapeHtml(opts.noOptionsText)}</p>`;
        }

        container.innerHTML = html;

        container.querySelectorAll(".badge-picker-remove").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const v = link.getAttribute("data-value");
                const idx = arrayRef.indexOf(v);
                if (idx !== -1) arrayRef.splice(idx, 1);
                markDirty();
                rerender();
            });
        });

        const addBtn = container.querySelector(".badge-picker-add");
        if (addBtn) {
            addBtn.addEventListener("click", () => {
                const select = container.querySelector(".badge-picker-select");
                const v = select.value;
                if (!v || arrayRef.includes(v)) return;

                arrayRef.push(v);
                markDirty();
                rerender();
            });
        }
    }

    const RECORD_TYPES = [
        "A", "A6", "AAAA", "AFSDB", "ALIAS", "AMTRELAY", "ANAME", "ANY", "APL", "APP", "ATMA", "AVC", "AXFR",
        "CAA", "CDNSKEY", "CDS", "CERT", "CHILD_NS", "CLA", "CNAME", "CSYNC", "DHCID", "DLV", "DNAME",
        "DNSKEY", "DOA", "DS", "EID", "EUI48", "EUI64", "FWD", "GID", "GPOS", "HINFO", "HIP",
        "HTTPS", "IPN", "IPSECKEY", "ISDN", "IXFR", "KEY", "KX", "L32", "L64", "LOC",
        "LP", "MAILA", "MAILB", "MB", "MD", "MF", "MG", "MINFO", "MR", "MX",
        "NAPTR", "NID", "NIMLOC", "NINFO", "NS", "NSAP", "NSAP_PTR", "NSEC", "NSEC3", "NSEC3PARAM",
        "NULL", "NXNAME", "NXT", "OPENPGPKEY", "OPT", "PARENT_NS", "PTR", "PX", "RESINFO", "RKEY", "RP", "RRSIG",
        "RT", "SIG", "SINK", "SMIMEA", "SOA", "SPF", "SRV", "SSHFP", "SVCB", "TA",
        "TALINK", "TKEY", "TLSA", "TSIG", "TXT", "UID", "UINFO", "UNSPEC", "URI", "WALLET",
        "WKS", "X25", "ZONEMD"
    ];

    return { escapeHtml, renderGroupMapTable, renderStringList, renderBadgePicker, RECORD_TYPES };
})();
