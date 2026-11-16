//modalGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $ */

import { trapFocus } from "../../core/focus.js";

const DEFAULT_MODAL_ID = "myModal";

// Release functions of the open modals, they restore the focus when a modal closes.
const releases = new Map();

export function openModal(id = DEFAULT_MODAL_ID) {
    const modal = $(`#${id}`);
    modal.css("display", "block").attr({ role: "dialog", "aria-modal": "true" });
    if (modal[0] && !releases.has(id)) {
        releases.set(id, trapFocus(modal[0], { onEscape: () => closeModal(id) }));
    }
}

export function closeModal(id = DEFAULT_MODAL_ID) {
    $(`#${id}`).css("display", "none");
    releases.get(id)?.();
    releases.delete(id);
}

// One delegated handler serves every close button (x), including modals added later.
$(document).on("click.athenaModal", ".close", function () {
    const modal = $(this).closest(".modal");
    closeModal(modal.length ? modal.attr("id") : DEFAULT_MODAL_ID);
});
