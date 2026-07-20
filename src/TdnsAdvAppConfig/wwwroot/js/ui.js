(function () {
    "use strict";

    const overlay = document.getElementById("uiDialogOverlay");
    const titleEl = document.getElementById("uiDialogTitle");
    const messageEl = document.getElementById("uiDialogMessage");
    const inputEl = document.getElementById("uiDialogInput");
    const selectEl = document.getElementById("uiDialogSelect");
    const okBtn = document.getElementById("uiDialogOkBtn");
    const cancelBtn = document.getElementById("uiDialogCancelBtn");

    let queue = Promise.resolve();

    function showDialog({ title, message, showInput, inputValue, showSelect, selectOptions, selectValue, showCancel }) {
        return new Promise((resolve) => {
            titleEl.textContent = title;
            messageEl.textContent = message;

            inputEl.style.display = showInput ? "block" : "none";
            inputEl.value = showInput ? (inputValue || "") : "";

            selectEl.style.display = showSelect ? "block" : "none";
            if (showSelect) {
                selectEl.innerHTML = "";
                (selectOptions || []).forEach((opt) => {
                    selectEl.appendChild(new Option(opt, opt, false, opt === selectValue));
                });
            }

            cancelBtn.style.display = showCancel ? "inline-block" : "none";

            function finish(result) {
                overlay.classList.remove("visible");
                okBtn.removeEventListener("click", onOk);
                cancelBtn.removeEventListener("click", onCancel);
                document.removeEventListener("keydown", onKeydown);
                resolve(result);
            }

            function onOk() {
                if (showSelect) finish(selectEl.value);
                else finish(showInput ? inputEl.value : true);
            }

            function onCancel() {
                finish((showInput || showSelect) ? null : false);
            }

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
            } else if (showSelect) {
                selectEl.focus();
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
    window.uiSelectPrompt = (message, options, selectValue, title) => enqueue({ title: title || "Selection Required", message, showSelect: true, selectOptions: options, selectValue, showCancel: true });
})();
