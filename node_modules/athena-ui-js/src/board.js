//board entry of Athena UI: a Kanban board of columns and cards (createBoard) and the maths of where a dragged card lands
//Import only what you use: `import { createBoard } from "athena-ui-js/board"`.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

export * from "./libs/hephaestus/boardGenerator/boardGenerator.js";
export { columnAt, indexAt, stepOf, focusStep, scrollSpeed } from "./libs/core/boardLayout.js";
