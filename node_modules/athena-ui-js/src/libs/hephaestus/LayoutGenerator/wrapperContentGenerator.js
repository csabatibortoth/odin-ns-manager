//wrapperContentGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { getNav } from "../../config/hooks.js";

export function generateWrapperContent() {
    getNav()?.();
}
