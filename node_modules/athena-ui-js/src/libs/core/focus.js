//focus helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

const FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
].join(",");

export function focusableIn(container) {
    return [...container.querySelectorAll(FOCUSABLE)].filter(node => node.getClientRects().length > 0);
}

/**
 * Keeps Tab inside the container, calls onEscape on Esc and moves the focus into the container.
 * Returns a release function that restores the previous focus.
 */
export function trapFocus(container, { onEscape } = {}) {
    const previous = document.activeElement;
    const onKeydown = event => {
        if (event.key === "Escape" && onEscape) {
            event.stopPropagation();
            onEscape();
        } else if (event.key === "Tab") {
            const nodes = focusableIn(container);
            if (!nodes.length) {
                event.preventDefault();
                return;
            }
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    };
    container.addEventListener("keydown", onKeydown);
    if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
    (focusableIn(container)[0] ?? container).focus();
    return () => {
        container.removeEventListener("keydown", onKeydown);
        if (previous?.isConnected) previous.focus();
    };
}
