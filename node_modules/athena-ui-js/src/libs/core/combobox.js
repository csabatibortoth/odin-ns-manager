//combobox for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { cx, el, uid } from "./dom.js";
import { translate } from "./i18n.js";

const asItem = option => typeof option === "object" ? { value: option.value, text: option.text ?? String(option.value) } : { value: option, text: String(option) };

/**
 * Internal: input with a suggestion list. Single mode is an autocomplete, multiple mode a tag selector.
 * `source` is an array of options, or a function (query) => options | Promise<options>.
 */
export function createCombobox(options = {}) {
    const { multiple = false, minChars = multiple ? 0 : 1, strict = multiple, allowFreeText = false, onChange, onSelect, onEnter } = options;
    const source = options.options ?? [];
    const listId = uid("listbox");
    const known = new Map();           // value -> text, for the chips and for the single value
    let selected = [];                  // values
    let items = [];                     // currently listed items
    let activeIndex = -1;
    let token = 0;

    const input = el("input", {
        id: options.id,
        class: "combobox-input",
        attrs: {
            type: "text", role: "combobox", autocomplete: "off", placeholder: options.placeholder, name: options.name,
            "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId
        },
        prop: { disabled: Boolean(options.disabled) }
    });
    const list = el("ul", { class: "combobox-list", id: listId, attrs: { role: "listbox", hidden: true } });
    const chips = el("span", { class: "combobox-chips" });
    const element = el("div", { class: cx("combobox", multiple && "combobox-multiple", options.class) }, chips, input, list);

    const notify = () => {
        input.dispatchEvent(new (input.ownerDocument.defaultView.Event)("change", { bubbles: true }));
        onChange?.(getValue());
    };
    const isOpen = () => !list.hidden;
    function open() {
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
    }
    function close() {
        list.hidden = true;
        activeIndex = -1;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    }
    function setActive(index) {
        activeIndex = index;
        [...list.children].forEach((li, i) => {
            li.classList.toggle("combobox-active", i === index);
            if (i === index) {
                input.setAttribute("aria-activedescendant", li.id);
                li.scrollIntoView?.({ block: "nearest" });
            }
        });
    }
    function renderChips() {
        chips.replaceChildren(...selected.map(value => el("span", { class: "chip" },
            el("span", { text: known.get(value) ?? value }),
            el("button", {
                class: "chip-remove",
                text: "×",
                attrs: { type: "button", "aria-label": `${translate("close")} ${known.get(value) ?? value}` },
                on: { click: () => { selected = selected.filter(v => v !== value); renderChips(); notify(); input.focus(); } }
            }))));
    }
    function renderList() {
        list.replaceChildren();
        if (!items.length) {
            list.append(el("li", { class: "combobox-empty", text: translate("noResults"), attrs: { role: "presentation" } }));
            return;
        }
        items.forEach((item, index) => {
            const isSelected = multiple && selected.includes(item.value);
            const li = el("li", {
                id: `${listId}-${index}`,
                class: cx("combobox-option", isSelected && "combobox-selected"),
                text: (isSelected ? "✓ " : "") + item.text,
                attrs: { role: "option", "aria-selected": String(isSelected) }
            });
            // mousedown, so the choice is made before the input loses focus
            li.addEventListener("mousedown", event => { event.preventDefault(); choose(item); });
            list.append(li);
        });
    }
    function choose(item) {
        known.set(item.value, item.text);
        if (multiple) {
            selected = selected.includes(item.value) ? selected.filter(v => v !== item.value) : [...selected, item.value];
            input.value = "";
            renderChips();
            renderList();
        } else {
            selected = [item.value];
            input.value = item.text;
            close();
        }
        onSelect?.(item);
        notify();
    }
    async function search() {
        const query = input.value.trim();
        if (query.length < minChars) {
            close();
            return;
        }
        const mine = ++token;
        const found = typeof source === "function"
            ? await source(query)
            : source.filter(option => asItem(option).text.toLowerCase().includes(query.toLowerCase()));
        if (mine !== token) return;
        items = found.map(asItem);
        items.forEach(item => known.set(item.value, item.text));
        renderList();
        open();
        // With free text the typed value is a valid answer, so do not pre-highlight the first
        // option (which may be the typed text itself: Enter would then choose nothing new).
        setActive(!allowFreeText && items.length ? 0 : -1);
    }

    input.addEventListener("input", () => {
        if (!multiple) {
            selected = [];
            notify();
        }
        search();
    });
    input.addEventListener("focus", () => { if (multiple && minChars === 0) search(); });
    input.addEventListener("blur", () => {
        close();
        // A strict single combobox only keeps a text that was chosen from the list.
        if (!multiple && strict && !allowFreeText && !selected.length) input.value = "";
    });
    input.addEventListener("keydown", event => {
        // During IME composition Enter commits the characters, it does not choose or submit.
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!isOpen()) search();
            else setActive(Math.min(activeIndex + 1, items.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(activeIndex - 1, 0));
        } else if (event.key === "Enter") {
            if (isOpen() && activeIndex >= 0 && items[activeIndex]) {
                event.preventDefault();
                choose(items[activeIndex]);
            } else if (allowFreeText) {
                // The typed text is the answer: it must not be swallowed by the suggestion list.
                event.preventDefault();
                const text = input.value.trim();
                close();
                if (text) {
                    onEnter?.(text);
                    if (!multiple) { selected = []; notify(); }
                }
            }
        } else if (event.key === "Escape" && isOpen()) {
            event.stopPropagation();
            close();
        } else if (event.key === "Backspace" && multiple && !input.value && selected.length) {
            selected = selected.slice(0, -1);
            renderChips();
            notify();
        }
    });

    function getValue() {
        if (multiple) return [...selected];
        return selected.length ? selected[0] : (strict ? "" : input.value);
    }
    function setValue(value) {
        if (multiple) {
            selected = [].concat(value ?? []);
            (Array.isArray(source) ? source : []).forEach(option => known.set(asItem(option).value, asItem(option).text));
            renderChips();
        } else if (value == null || value === "") {
            selected = [];
            input.value = "";
        } else {
            const match = (Array.isArray(source) ? source : []).map(asItem).find(item => item.value === value);
            selected = match ? [match.value] : [];
            input.value = match?.text ?? String(value);
        }
    }
    setValue(options.value);
    return { element, input, getValue, setValue };
}
