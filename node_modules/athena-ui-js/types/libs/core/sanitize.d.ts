/** True for http(s), mailto, tel, anchors and relative paths. Rejects javascript:, data:, vbscript: and the like. */
export function isSafeUrl(url: any): boolean;
/** Cleans HTML from the editor, the clipboard or the application. Returns the safe HTML string. */
export function sanitizeHtml(html: any): string;
/** The text of an HTML string, without tags. */
export function htmlToText(html: any): string;
