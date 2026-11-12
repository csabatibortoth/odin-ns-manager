//modalGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $ */

const DEFAULT_MODAL_ID = "myModal";

export function openModal(id = DEFAULT_MODAL_ID) {
    $(`#${id}`).css("display", "block");
}

export function closeModal(id = DEFAULT_MODAL_ID) {
    $(`#${id}`).css("display", "none");
}

// One delegated handler serves every close button (x), including modals added later.
$(document).on("click.athenaModal", ".close", function () {
    const modal = $(this).closest(".modal");
    (modal.length ? modal : $(`#${DEFAULT_MODAL_ID}`)).css("display", "none");
});
