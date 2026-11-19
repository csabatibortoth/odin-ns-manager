//hungarianControls for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui
//Moved here from the hungarianInputControls addon of HTMLControlGenerator (https://github.com/csabatibortoth/HTMLControlGenerator).

import { el } from "./dom.js";
import { buildControl, registerControl } from "./controls.js";

// Number of digits in each field of the control.
const SEGMENTS = {
    hunPIN: [3, 3, 3],   // personal insurance number
    hunCRID: [2, 2, 6],  // company registration ID
    hunTID: [8, 1, 2]    // TAX number
};

function segmentedInput(options, lengths) {
    const value = String(options.value ?? "");
    const group = el("span", { id: options.id, class: options.class });
    let offset = 0;
    lengths.forEach((length, index) => {
        if (index > 0) group.append(el("span", { id: `${options.id}_spacer_${index - 1}`, class: `${options.id}SpacerClass`, text: " - " }));
        group.append(buildControl({
            inputType: "number",
            id: `${options.id}_${index}`,
            class: options.inputClass,
            value: value.slice(offset, offset + length),
            min: 0,
            max: 10 ** length - 1
        }));
        offset += length;
    });
    return group;
}

/** Adds the input types hunPIN, hunCRID and hunTID (Hungarian personal insurance, company registration and tax numbers, in segments). */
export function registerHungarianInputControls() {
    for (const [inputType, lengths] of Object.entries(SEGMENTS)) {
        registerControl(inputType, options => segmentedInput(options, lengths));
    }
}
