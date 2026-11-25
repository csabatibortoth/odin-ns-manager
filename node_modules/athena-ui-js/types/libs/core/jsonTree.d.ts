/** The text as an object or an array when it is JSON of that kind; otherwise null. */
export function parseJson(text: any): any;
/** A path as a programmer writes it: req.id, items[2].name, headers["x-request-id"]. */
export function pathOf(parts: any): any;
/**
 * A JSON value as a tree. Options: parent, class, open (levels open at first, default 2),
 * maxDepth, maxChildren, maxText. Returns the usual handle with expandAll() and collapseAll().
 */
export function generateJsonTree(value: any, options?: {}): any;
export const MAX_DEPTH: 12;
export const MAX_CHILDREN: 200;
export const MAX_TEXT: 1000;
export const MAX_NODES: 5000;
export function valueText(value: any): string;
