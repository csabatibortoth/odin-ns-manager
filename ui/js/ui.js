// The building blocks of the pages: elements, controls, tables, notices and
// dialogs. They are made with Athena UI: buttons, badges, cards, stats,
// pagination, breadcrumbs, the fields of the forms, the toasts and the
// dialogs; the plain controls with its HTMLControlGenerator. What a page asks
// for is the same as before, so the pages do not know which is which.

/* global $ */

import {
    showToast, showDialog as athenaDialog, showFormDialog, generateForm, generateTable, generateButton, generateBadge, generateCard, generatePagination, generateStat, generateBreadcrumbs,
} from '../vendor/athena-ui/athena-ui.js';
import { HTMLControlGenerator } from '../vendor/athena-ui/controls.js';

///--- Elements

// el('p', { class: 'hint', text: 'Hello' }, child, ...). Texts are never read as HTML.
export function el(tag, props = {}, ...children) {
    const { text, class: className, ...attributes } = props;
    const $element = $(document.createElement(tag));
    if (className) $element.addClass(className);
    if (text !== undefined && text !== null) $element.text(text);
    for (const [name, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null && value !== false) $element.attr(name, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
        if (child === undefined || child === null || child === false) continue;
        $element.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return $element;
}

// The plain controls of Athena UI come back as elements (they were jQuery objects before 2.0): the pages work with jQuery objects
export const control = (options) => $(HTMLControlGenerator.create(options));

// A button that shows a spinner while its action runs; a failure is shown as a notice.
// kind: 'primary', 'danger', 'small', or two of them.
export function button(label, action, kind = '') {
    const kinds = kind.split(' ');
    const generated = generateButton({
        text: label,
        variant: kinds.includes('danger') ? 'danger' : kinds.includes('primary') ? 'primary' : 'secondary',
        size: kinds.includes('small') ? 'small' : undefined,
        onclick: async () => {
            generated.setLoading(true);
            try {
                await action();
            } catch (err) {
                showError(err);
            } finally {
                generated.setLoading(false);
            }
        },
    });
    return $(generated.element);
}

export function select(items, value, attributes = {}) {
    return control({
        inputType: 'select',
        class: 'input',
        items: items.map((item) => ({ ...item, selected: String(item.value) === String(value) })),
    }).attr(attributes);
}

// kind: 'ok', 'warn' or 'danger'; without one the badge is neutral
const BADGE_VARIANTS = { ok: 'success', warn: 'warning', danger: 'error' };
export const badge = (text, kind = '') => $(generateBadge({ text, variant: BADGE_VARIANTS[kind] || 'neutral' }));
export const activeBadge = (active) => (active ? badge('Active', 'ok') : badge('Inactive', 'warn'));

// A figure of the dashboard: the stat of Athena UI, with a note below it
export function stat(label, value, note) {
    const { element } = generateStat({ label, value });
    if (note) element.append(el('div', { class: 'tile-note muted', text: note })[0]);
    return $(element);
}

///--- Texts

export function formatDate(value) {
    if (!value) return '–';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '–' : date.toLocaleString();
}

export function formatDuration(seconds) {
    const parts = [
        [Math.floor(seconds / 86400), 'd'],
        [Math.floor((seconds % 86400) / 3600), 'h'],
        [Math.floor((seconds % 3600) / 60), 'min'],
    ].filter(([amount]) => amount > 0);
    return parts.length ? parts.map(([amount, unit]) => `${amount} ${unit}`).join(' ') : `${seconds} s`;
}

export const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function errorText(err) {
    const details = err?.details && typeof err.details === 'object' ? Object.values(err.details) : [];
    return details.length ? `${err.message}: ${details.join('; ')}` : err?.message || 'Something went wrong';
}

///--- Notices

// kind: 'ok', 'info' or 'error'. A failure stays until it is dismissed; the others go away by themselves.
const TOAST_TYPES = { ok: 'success', info: 'warning', error: 'error' };
let errorToast = null;

export function notice(kind, text) {
    if (kind === 'error') errorToast?.close(); // one failure at a time
    const toast = showToast({ message: text, type: TOAST_TYPES[kind] || 'info', duration: kind === 'error' ? 0 : 6000 });
    if (kind === 'error') errorToast = toast;
}

export const clearNotices = () => $('.toast-container').empty();

// An expired session is reported once, by the handler of the session
export function showError(err) {
    if (err?.status !== 401) notice('error', errorText(err));
}

///--- Tables

// columns: [{ title, cell: (row) => text or element(s), class }]
// The table of Athena UI draws it; a cell is a block of its own, so it can hold a badge, a link or buttons. Every cell has the title of its column
// in data-label: on a narrow screen every row is shown as a block, with the titles next to the values: see theme.css
export function table(columns, rows, empty = 'Nothing to show.') {
    if (!rows.length) return el('p', { class: 'empty', text: empty });
    const $holder = el('div', { class: 'table-scroll' });
    generateTable({
        parent: $holder[0],
        class: 'grid',
        sortable: false,
        columns: columns.map((column, index) => ({
            key: `column${index}`,
            label: column.title,
            render: (row) => el('div', { class: 'cell' }, column.cell(row))[0],
        })),
        cellClass: (row, column) => columns[Number(column.key.slice('column'.length))].class,
        rows,
    });
    // The classes of the columns (num, actions, value) are the ones of the head as well
    $holder.find('thead th').each((index, head) => {
        if (columns[index]?.class) head.classList.add(columns[index].class);
    });
    return $holder;
}

// result is the list envelope of the API: { page, pages, total }
export function pager(result, go) {
    const $pager = el('div', { class: 'pager' }, el('span', { text: `${result.total} in total` }));
    if (result.pages > 1) {
        const pagination = generatePagination({
            total: result.total,
            // The pages of the API are the ones to show
            pageSize: result.limit || Math.ceil(result.total / result.pages),
            page: result.page,
            label: 'Pages',
            onChange: (page) => Promise.resolve(go(page)).catch(showError),
        });
        $pager.append(pagination.element);
    }
    return $pager;
}

// Calls action a moment after the last change, for search fields
export function debounce(action, wait = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => action(...args), wait);
    };
}

///--- Dialogs

export function closeDialog() {
    document.querySelectorAll('dialog.dialog .dialog-close').forEach((closeButton) => closeButton.click());
}

// The fields of the pages, as the form of Athena UI wants them.
// fields: [{ name, label, type, value, options, required, hint, placeholder, disabled, blank, show: (raw) => boolean }]
// - label may be a function of the raw values; show hides a field (and it is not sent) while it returns false;
// - the names are nested by their dots: 'soa.host' is the host of soa in the values to send;
// - what is left empty is left out; blank: 'null' or blank: 'empty' sends null or '' instead;
// - what is typed is trimmed (not a password), and a disabled field, or one with send: false, is not sent.
function fieldsOf(fields) {
    return fields.map((def) => {
        const type = def.type || 'text';
        const text = type !== 'checkbox';
        return {
            name: def.name,
            type,
            label: def.label,
            help: def.hint,
            value: type === 'select' ? String(def.value ?? '') : def.value ?? undefined,
            options: def.options?.map((option) => ({ ...option, value: String(option.value) })),
            placeholder: def.placeholder,
            min: def.min,
            max: def.max,
            maxLength: def.maxlength,
            autocomplete: def.autocomplete || 'off',
            disabled: Boolean(def.disabled),
            required: Boolean(def.required) && text,
            show: def.show,
            send: def.send !== false && !def.disabled,
            trim: type !== 'password' && text,
            empty: text ? { null: 'null', empty: 'empty' }[def.blank] || 'omit' : undefined,
        };
    });
}

// What a failed save of a form shows: the messages at their fields come from the API (err.details), and an expired session is reported by its own handler
function saving(onSubmit, { inDialog }) {
    return async (values, form) => {
        try {
            await onSubmit(values, form.getRawValues());
        } catch (err) {
            if (err?.status !== 401) throw err;
            if (inDialog) closeDialog();
        }
    };
}

// A form on the page. onSubmit(values, raw) saves; when it fails with details: { field: message }, the messages are shown at their fields.
// With `clear` the form is emptied when it succeeds. intro: a text above the fields.
export function inlineForm({ intro, fields, submitLabel = 'Save', onSubmit, clear = false }) {
    const form = generateForm({
        fields: fieldsOf(fields),
        nested: true,
        submitText: submitLabel,
        onSubmit: async (values, handle) => {
            await saving(onSubmit, { inDialog: false })(values, handle);
            if (clear) handle.reset();
        },
    });
    form.element.classList.add('form', 'inline');
    if (intro) form.element.prepend(el('p', { class: 'hint', text: intro })[0]);
    return $(form.element);
}

// A form in a dialog of Athena UI, with its own Save and Cancel; the dialog closes when it succeeds
export function formDialog({ title, intro, fields, submitLabel = 'Save', onSubmit }) {
    showFormDialog({
        title,
        intro,
        fields: fieldsOf(fields),
        nested: true,
        submitText: submitLabel,
        onSubmit: saving(onSubmit, { inDialog: true }),
    });
}

// Asks before something that can not be undone. The dialog stays open, with
// the failure in it, while onConfirm fails.
export function confirmDialog({ title, message, confirmLabel = 'Delete', onConfirm }) {
    const $error = el('p', { class: 'form-error', role: 'alert' }).hide();
    return athenaDialog({
        title,
        content: [el('p', { text: message })[0], $error[0]],
        buttons: [
            { text: 'Cancel', value: false, variant: 'secondary' },
            { text: confirmLabel, value: true, variant: 'danger', autofocus: true },
        ],
        beforeClose: async (value) => {
            if (value !== true) return true;
            $error.hide();
            try {
                await onConfirm();
                return true;
            } catch (err) {
                if (err?.status === 401) return true;
                $error.text(errorText(err)).show();
                return false;
            }
        },
    });
}

// A failure of the form itself, shown at the field: throw fieldError('name', 'message')
export function fieldError(name, message) {
    return Object.assign(new Error('Check the marked fields'), { details: { [name]: message } });
}

///--- Pieces of a page

export const PAGE_SIZE = 20;

export const link = (href, text) => el('a', { href, text });
export function breadcrumbs(...items) {
    const holder = document.createElement('div');
    generateBreadcrumbs({ parent: holder, items });
    return $(holder.firstElementChild);
}
export const head = (title, ...actions) => el('div', { class: 'toolbar page-head' }, el('h2', { text: title }), el('span', { class: 'spacer' }), actions);
export const options = (pairs) => pairs.map(([value, text]) => ({ value, text }));
export const fact = (term, value) => el('span', {}, el('span', { text: `${term}: ` }), value);

// A card with a list of facts, and actions (buttons, links) in its footer
export function card(title, rows, ...actions) {
    const $facts = el('dl', {}, rows.map(([term, value]) => [el('dt', { text: term }), el('dd', {}, value)]));
    const footer = actions.filter(Boolean).flatMap((action) => (action.jquery ? action.get() : [action]));
    return $(generateCard({ title, content: $facts[0], footer: footer.length ? footer : undefined }).element);
}

export function searchBox(placeholder, onSearch, value = '') {
    const $search = control({ inputType: 'search', class: 'input grow', value: value || undefined }).attr({ placeholder, 'aria-label': placeholder });
    $search.on('input', debounce(() => onSearch($search.val().trim())));
    return $search;
}

export function filter(label, items, onChange, value = '') {
    const $select = select(items, value);
    $select.on('change', () => onChange($select.val()));
    return el('label', {}, label, $select);
}

export const activeFilter = (onChange) => filter('State', options([['', 'All'], ['true', 'Active'], ['false', 'Inactive']]), onChange);

// Loads a page of a list of the API into $list: a table and its pager.
// state: { page, ... }; fetch(state) resolves to the list envelope; columns and empty as for table()
export function listLoader($list, state, fetch, columns, empty) {
    const load = async () => {
        const result = await fetch(state);
        if (result.page > result.pages && result.pages > 0) {
            state.page = result.pages;
            return load();
        }
        $list.empty().append(
            table(typeof columns === 'function' ? columns() : columns, result.items, typeof empty === 'function' ? empty() : empty),
            pager(result, (page) => {
                state.page = page;
                return load();
            })
        );
        return result;
    };
    return load;
}
