// The building blocks of the pages: elements, controls, tables, notices and
// dialogs. They are made with Athena UI: buttons, badges, cards, stats,
// pagination, breadcrumbs, the fields of the forms, the toasts and the
// dialogs; the plain controls with its HTMLControlGenerator. What a page asks
// for is the same as before, so the pages do not know which is which.

/* global $ */

import {
    showToast, showDialog as athenaDialog, generateButton, generateBadge, generateCard, generatePagination, generateField, generateStat, generateBreadcrumbs,
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
// On a narrow screen every row is shown as a block, with the titles next to the values: see theme.css
export function table(columns, rows, empty = 'Nothing to show.') {
    if (!rows.length) return el('p', { class: 'empty', text: empty });
    return el(
        'div',
        { class: 'table-scroll' },
        el(
            'table',
            { class: 'grid' },
            el('thead', {}, el('tr', {}, columns.map((column) => el('th', { scope: 'col', class: column.class, text: column.title })))),
            el('tbody', {}, rows.map((row) => el('tr', {}, columns.map((column) => el('td', { class: column.class, 'data-label': column.title || null }, el('div', { class: 'cell' }, column.cell(row)))))))
        )
    );
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

// A form in a dialog of Athena UI. The dialog has no buttons of its own: the
// form has its own, and closes the dialog when it succeeds.
export function closeDialog() {
    document.querySelectorAll('dialog.dialog .dialog-close').forEach((closeButton) => closeButton.click());
}

function setPath(target, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let node = target;
    for (const key of keys) node = node[key] ??= {};
    node[last] = value;
}

// One field of a form: the field of Athena UI, with what the pages need on top
function buildField(def) {
    const type = def.type || 'text';
    const isSelect = type === 'select';
    const label = (raw) => (typeof def.label === 'function' ? def.label(raw) : def.label);
    const field = generateField({
        name: def.name,
        type,
        label: label({}),
        help: def.hint,
        value: isSelect ? String(def.value ?? '') : def.value ?? undefined,
        options: def.options?.map((option) => ({ ...option, value: String(option.value) })),
        placeholder: def.placeholder,
        min: def.min,
        max: def.max,
        maxLength: def.maxlength,
        autocomplete: def.autocomplete || 'off',
        disabled: Boolean(def.disabled),
        required: Boolean(def.required) && type !== 'checkbox',
    });
    // The text of the label, without the star that marks a required field
    const caption = field.element.querySelector('.field-label-text');
    return {
        def,
        field,
        visible: true,
        setLabel: (raw) => {
            if (caption && caption.firstChild) caption.firstChild.nodeValue = label(raw);
        },
    };
}

// What is typed, by the name of the field
const rawValues = (rows) => Object.fromEntries(rows.map(({ def, field }) => [def.name, field.getValue()]));

// The values to send: nested by the dots in the names of the fields. Fields
// that are hidden, disabled or left empty are left out; a field with
// blank: 'null' or blank: 'empty' sends null or '' when it is empty.
function collectValues(rows) {
    const values = {};
    for (const { def, field, visible } of rows) {
        if (!visible || def.disabled || def.send === false) continue;

        let value = field.getValue();
        if (def.type !== 'checkbox') {
            if (typeof value === 'string' && def.type !== 'password') value = value.trim();
            if (value === '' || value === undefined || Number.isNaN(value)) value = { null: null, empty: '' }[def.blank];
        }
        if (value !== undefined) setPath(values, def.name, value);
    }
    return values;
}

// A form.
// fields: [{ name, label, type, value, options, required, hint, placeholder,
//            disabled, blank, show: (raw) => boolean }] - label may be a function of the raw values.
// onSubmit(values, raw) saves; when it fails with details: { field: message },
// the messages are shown at their fields.
// inDialog: the form is the content of a dialog, which closes when it succeeds.
// Otherwise it stays on its page; with `clear` it is emptied when it succeeds.
function buildForm({ intro, fields, submitLabel = 'Save', onSubmit, inDialog = false, clear = false }) {
    const rows = fields.map(buildField);
    const $error = el('p', { class: 'form-error', role: 'alert' }).hide();
    const submit = generateButton({ text: submitLabel, variant: 'primary', type: 'submit' });
    const $form = el(
        'form',
        { class: inDialog ? 'athena-form form' : 'athena-form form inline', novalidate: true },
        intro ? el('p', { class: 'hint', text: intro }) : null,
        $error,
        rows.map((row) => row.field.element),
        el('div', { class: 'actions' }, submit.element, inDialog ? generateButton({ text: 'Cancel', variant: 'secondary', onclick: closeDialog }).element : null)
    );

    const arrange = () => {
        const raw = rawValues(rows);
        for (const row of rows) {
            row.visible = !row.def.show || Boolean(row.def.show(raw));
            $(row.field.element).toggle(row.visible);
            // A hidden field must not stop the form from being sent
            $(row.field.element).find('input, select, textarea').prop('disabled', !row.visible || Boolean(row.def.disabled));
            row.setLabel(raw);
        }
    };

    const showFailure = (err) => {
        const messages = [];
        for (const [name, message] of Object.entries(err.details && typeof err.details === 'object' ? err.details : {})) {
            const row = rows.find((candidate) => candidate.def.name === name && candidate.visible);
            if (row) row.field.setError(message);
            else messages.push(message);
        }
        const shown = $form.find('.field-error').filter((_, node) => node.textContent).length > 0;
        const text = [shown && !messages.length ? '' : err.message, ...messages].filter(Boolean).join(': ');
        $error.text(text || 'Check the marked fields').show();
    };

    $form.on('change', 'select, input[type=checkbox]', arrange);
    $form.on('submit', async (event) => {
        event.preventDefault();
        $error.hide();
        rows.forEach((row) => row.field.setError(''));

        // The fields are checked as they are filled in; what is not valid stops the form
        const invalid = rows.filter((row) => row.visible && !row.def.disabled && row.field.validate());
        if (invalid.length) {
            invalid[0].field.focus();
            return;
        }

        submit.setLoading(true);
        try {
            await onSubmit(collectValues(rows), rawValues(rows));
            if (inDialog) closeDialog();
            else if (clear) {
                $form[0].reset();
                rows.forEach((row) => row.field.resetState());
                arrange();
            }
        } catch (err) {
            // An expired session is reported by its own handler
            if (err?.status !== 401) showFailure(err);
            else if (inDialog) closeDialog();
        } finally {
            submit.setLoading(false);
        }
    });

    arrange();
    return $form;
}

// A form in a dialog; see buildForm
export function formDialog({ title, ...form }) {
    const $form = buildForm({ ...form, inDialog: true });
    athenaDialog({ title, content: $form[0], buttons: [] });
    $form.find('input:enabled:not([readonly]), select:enabled').first().trigger('focus');
}

// A form on the page; see buildForm
export const inlineForm = (form) => buildForm(form);

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
