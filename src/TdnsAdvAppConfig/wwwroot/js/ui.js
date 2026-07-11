// In-app replacement for the browser's native alert()/confirm()/prompt(),
// which read as jarring browser chrome rather than part of the app. Reuses
// the #authOverlay pattern (fixed overlay + panel, .visible toggles display),
// no bootstrap.min.js dependency. Loaded before app.js/config.js/splithorizon.js
// so window.uiAlert/uiConfirm/uiPrompt exist before those modules run.
//
// Unlike the native calls they replace (which block all JS until dismissed,
// so could never overlap), these are async - a dialog requested while one is
// already open queues behind it rather than clobbering the visible one.
(function () {
    "use strict";

    const overlay = document.getElementById("uiDialogOverlay");
    const titleEl = document.getElementById("uiDialogTitle");
    const messageEl = document.getElementById("uiDialogMessage");
    const inputEl = document.getElementById("uiDialogInput");
    const okBtn = document.getElementById("uiDialogOkBtn");
    const cancelBtn = document.getElementById("uiDialogCancelBtn");

    let queue = Promise.resolve();

    function showDialog({ title, message, showInput, inputValue, showCancel }) {
        return new Promise((resolve) => {
            titleEl.textContent = title;
            messageEl.textContent = message;

            inputEl.style.display = showInput ? "block" : "none";
            inputEl.value = showInput ? (inputValue || "") : "";

            cancelBtn.style.display = showCancel ? "inline-block" : "none";

            function finish(result) {
                overlay.classList.remove("visible");
                okBtn.removeEventListener("click", onOk);
                cancelBtn.removeEventListener("click", onCancel);
                document.removeEventListener("keydown", onKeydown);
                resolve(result);
            }

            function onOk() {
                finish(showInput ? inputEl.value : true);
            }

            function onCancel() {
                finish(showInput ? null : false);
            }

            // Document-level (not just on the input) so Enter/Escape work
            // whether or not the input field is shown/focused.
            function onKeydown(e) {
                if (e.key === "Enter") { e.preventDefault(); onOk(); }
                else if (e.key === "Escape") { if (showCancel) onCancel(); else onOk(); }
            }

            okBtn.addEventListener("click", onOk);
            cancelBtn.addEventListener("click", onCancel);
            document.addEventListener("keydown", onKeydown);

            overlay.classList.add("visible");
            if (showInput) {
                inputEl.focus();
                inputEl.select();
            } else {
                okBtn.focus();
            }
        });
    }

    function enqueue(options) {
        const result = queue.then(() => showDialog(options));
        queue = result;
        return result;
    }

    window.uiAlert = (message, title) => enqueue({ title: title || "Notice", message, showInput: false, showCancel: false });
    window.uiConfirm = (message, title) => enqueue({ title: title || "Confirm", message, showInput: false, showCancel: true });
    window.uiPrompt = (message, inputValue, title) => enqueue({ title: title || "Input Required", message, showInput: true, inputValue, showCancel: true });
})();
