//modalGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { trapFocus } from "../../core/focus.js";

const DEFAULT_MODAL_ID = "myModal";

// Release functions of the open modals, they restore the focus when a modal closes.
const releases = new Map();

export function openModal(id = DEFAULT_MODAL_ID) {
    const modal = document.getElementById(id);
    if (!modal) return;
    installCloseHandler();
    modal.classList.add("is-open");
    modal.style.display = "block";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    if (!releases.has(id)) releases.set(id, trapFocus(modal, { onEscape: () => closeModal(id) }));
}

export function closeModal(id = DEFAULT_MODAL_ID) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove("is-open");
        modal.style.display = "none";
    }
    releases.get(id)?.();
    releases.delete(id);
}

// One delegated handler serves every close button (x), including modals added later.
// One delegated handler serves every close button (x), including modals added later. It is installed when the first modal is opened,
// so importing this file has no side effect.
let closeHandlerInstalled = false;
function installCloseHandler() {
    if (closeHandlerInstalled) return;
    closeHandlerInstalled = true;
    document.addEventListener("click", event => {
        const button = event.target.closest?.(".close");
        if (!button) return;
        closeModal(button.closest(".modal")?.id || DEFAULT_MODAL_ID);
    });
}
