//classic build of Athena UI: puts the whole API on globalThis (as window.generateTable, window.AthenaUI, ...)
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui
//
// The ES module entry points have no side effects. This file is the opt-in for pages that use inline handlers or classic scripts:
//
//   <script type="module" src="athena-ui/src/classic.js"></script>

import * as AthenaUI from "./athena-ui.js";

Object.assign(globalThis, AthenaUI, { AthenaUI });
