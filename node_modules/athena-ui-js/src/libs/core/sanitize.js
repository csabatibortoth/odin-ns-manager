//sanitize for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Allow-list HTML sanitizer for the rich text editor. Everything that is not listed is unwrapped
// (its text stays), dangerous elements are removed with their content, and every attribute is dropped
// except a checked `href` on links. The input is parsed in an inert document, so nothing runs
// while it is being cleaned.

const ALLOWED = new Set([
    "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "blockquote", "code", "pre", "a", "hr", "sub", "sup"
]);
const RENAMED = { div: "p", strike: "s", del: "s", b: "strong", i: "em" };
const DROPPED = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "link", "meta", "title", "form", "textarea", "select", "button", "input", "head"]);
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.{1,2}\/)/i;

/** True for http(s), mailto, tel, anchors and relative paths. Rejects javascript:, data:, vbscript: and the like. */
export function isSafeUrl(url) {
    // Browsers ignore control characters and spaces inside the scheme ("java\tscript:").
    const compact = String(url ?? "").replace(/[\u0000- \u007f-\u009f]/g, "");
    return compact !== "" && SAFE_URL.test(compact);
}

function clean(node, target, doc) {
    for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
            target.append(doc.createTextNode(child.nodeValue));
        } else if (child.nodeType === 1) {
            const tag = child.tagName.toLowerCase();
            if (DROPPED.has(tag)) continue;
            const name = RENAMED[tag] ?? tag;
            if (!ALLOWED.has(name)) {
                clean(child, target, doc);                 // unwrap: keep the text, lose the element
                continue;
            }
            const copy = doc.createElement(name);
            if (name === "a") {
                const href = child.getAttribute("href");
                if (href && isSafeUrl(href)) {
                    copy.setAttribute("href", href.trim());
                    copy.setAttribute("rel", "noopener noreferrer");
                    if (!href.trim().startsWith("#")) copy.setAttribute("target", "_blank");
                }
            }
            clean(child, copy, doc);
            target.append(copy);
        }
    }
}

/** Cleans HTML from the editor, the clipboard or the application. Returns the safe HTML string. */
export function sanitizeHtml(html) {
    const parsed = new DOMParser().parseFromString(`<body>${html ?? ""}</body>`, "text/html");
    const out = parsed.implementation.createHTMLDocument("");
    clean(parsed.body, out.body, out);
    return out.body.innerHTML;
}

/** The text of an HTML string, without tags. */
export function htmlToText(html) {
    const parsed = new DOMParser().parseFromString(`<body>${html ?? ""}</body>`, "text/html");
    return parsed.body.textContent ?? "";
}
