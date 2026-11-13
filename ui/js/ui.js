// The building blocks of the pages: elements, controls, tables, notices and
// dialogs. Controls are made with the HTMLControlGenerator of Athena UI, and
// the dialogs are shown in its modal.

/* global $, HTMLControlGenerator */

import { openModal, closeModal } from '../vendor/athena-ui/athena-ui.js';

const MODAL_ID = 'myModal';

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

export const control = (options) => HTMLControlGenerator.create(options);

// A button that is disabled while its action runs; a failure is shown as a notice
export function button(label, action, kind = '') {
    const $button = control({
        inputType: 'button',
        value: label,
        class: `button ${kind}`.trim(),
        onclick: async () => {
            $button.prop('disabled', true);
            try {
                await action();
            } catch (err) {
                showError(err);
            } finally {
                $button.prop('disabled', false);
            }
        },
    });
    return $button;
}

export function select(items, value, attributes = {}) {
    return control({
        inputType: 'select',
        class: 'input',
        items: items.map((item) => ({ ...item, selected: String(item.value) === String(value) })),
    }).attr(attributes);
}

export const badge = (text, kind = '') => el('span', { class: `badge ${kind}`.trim(), text });
export const activeBadge = (active) => (active ? badge('Active', 'ok') : badge('Inactive', 'warn'));

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

export function notice(kind, text) {
    const $notice = el('div', { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, el('span', { text }));
    $notice.append(
        el('button', { class: 'notice-close', type: 'button', 'aria-label': 'Dismiss', text: '×' }).on('click', () => $notice.remove())
    );
    $('#notices').empty().append($notice);
    if (kind !== 'error') setTimeout(() => $notice.remove(), 6000);
}

export const clearNotices = () => $('#notices').empty();

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
        $pager.append(
            button('Previous', () => go(result.page - 1), 'small').prop('disabled', result.page <= 1),
            el('span', { text: `Page ${result.page} of ${result.pages}` }),
            button('Next', () => go(result.page + 1), 'small').prop('disabled', result.page >= result.pages)
        );
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

let returnFocusTo = null;

function modalContent() {
    if (!document.getElementById(MODAL_ID)) {
        $('body').append(
            el(
                'div',
                { id: MODAL_ID, class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal_title' },
                el('div', { id: 'modal_content', class: 'modal-content' })
            )
        );
        $(document).on('keydown', (event) => {
            if (event.key === 'Escape' && $(`#${MODAL_ID}`).is(':visible')) closeDialog();
        });
    }
    return $('#modal_content');
}

function showDialog(title, ...body) {
    returnFocusTo = document.activeElement;
    // Athena UI closes the modal when an element of the class "close" is clicked
    const $close = el('span', { class: 'close', role: 'button', tabindex: 0, 'aria-label': 'Close', text: '×' })
        .on('click', closeDialog)
        .on('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') closeDialog();
        });
    const $content = modalContent().empty().append($close, el('h2', { id: 'modal_title', text: title }), body);
    openModal(MODAL_ID);
    $content.find('input:enabled:not([readonly]), select:enabled').first().trigger('focus');
}

export function closeDialog() {
    closeModal(MODAL_ID);
    $('#modal_content').empty();
    returnFocusTo?.focus?.();
    returnFocusTo = null;
}

function setPath(target, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let node = target;
    for (const key of keys) node = node[key] ??= {};
    node[last] = value;
}

let fieldCount = 0;

function buildField(field) {
    const id = `field_${++fieldCount}`; // a page may hold more than one form
    let $input;

    if (field.type === 'select') {
        $input = select(field.options, field.value, { id });
    } else if (field.type === 'checkbox') {
        $input = control({ inputType: 'checkbox', id, checked: Boolean(field.value) });
    } else {
        $input = control({
            inputType: field.type || 'text',
            id,
            class: 'input',
            value: field.value ?? undefined,
            min: field.min,
            max: field.max,
        });
    }
    $input.attr({
        placeholder: field.placeholder,
        maxlength: field.maxlength,
        autocomplete: field.autocomplete || 'off',
        'aria-describedby': `${id}_error`,
    });
    $input.prop({ required: Boolean(field.required), disabled: Boolean(field.disabled) });

    const $label = el('label', { for: id });
    const $error = el('small', { id: `${id}_error`, class: 'field-error', role: 'alert' });
    const $hint = field.hint ? el('small', { class: 'hint', text: field.hint }) : null;
    const $row =
        field.type === 'checkbox'
            ? el('div', { class: 'field check' }, $label.append($input, el('span')), $hint, $error)
            : el('div', { class: 'field' }, $label, $input, $hint, $error);
    const $text = field.type === 'checkbox' ? $label.find('span') : $label;

    return { field, $row, $input, $error, $text, visible: true };
}

// What is typed, by the name of the field
function rawValues(rows) {
    return Object.fromEntries(
        rows.map(({ field, $input }) => [field.name, field.type === 'checkbox' ? $input.prop('checked') : $input.val()])
    );
}

// The values to send: nested by the dots in the names of the fields. Fields
// that are hidden, disabled or left empty are left out; a field with
// blank: 'null' or blank: 'empty' sends null or '' when it is empty.
function collectValues(rows) {
    const values = {};
    for (const { field, $input, visible } of rows) {
        if (!visible || field.disabled || field.send === false) continue;

        let value;
        if (field.type === 'checkbox') {
            value = $input.prop('checked');
        } else {
            const raw = field.type === 'password' ? $input.val() : String($input.val() ?? '').trim();
            if (raw === '') value = { null: null, empty: '' }[field.blank];
            else value = field.type === 'number' ? Number(raw) : raw;
        }
        if (value !== undefined) setPath(values, field.name, value);
    }
    return values;
}

// A form.
// fields: [{ name, label, type, value, options, required, hint, placeholder,
//            disabled, blank, show: (raw) => boolean }] - label may be a function of the raw values.
// onSubmit(values, raw) saves; when it fails with details: { field: message },
// the messages are shown at their fields.
// inDialog: the form is the content of the modal, which closes when it succeeds.
// Otherwise it stays on its page; with `clear` it is emptied when it succeeds.
function buildForm({ intro, fields, submitLabel = 'Save', onSubmit, inDialog = false, clear = false }) {
    const rows = fields.map(buildField);
    const $error = el('p', { class: 'form-error', role: 'alert' }).hide();
    const $submit = control({ inputType: 'submit', value: submitLabel, class: 'button primary' });
    const $form = el(
        'form',
        { class: inDialog ? 'form' : 'form inline' },
        intro ? el('p', { class: 'hint', text: intro }) : null,
        $error,
        rows.map((row) => row.$row),
        el('div', { class: 'actions' }, $submit, inDialog ? button('Cancel', closeDialog) : null)
    );

    const arrange = () => {
        const raw = rawValues(rows);
        for (const row of rows) {
            row.visible = !row.field.show || Boolean(row.field.show(raw));
            row.$row.toggle(row.visible);
            // A hidden field must not stop the form from being sent
            row.$input.prop('disabled', !row.visible || Boolean(row.field.disabled));
            row.$text.text(typeof row.field.label === 'function' ? row.field.label(raw) : row.field.label);
        }
    };

    const showFailure = (err) => {
        const messages = [];
        for (const [name, message] of Object.entries(err.details && typeof err.details === 'object' ? err.details : {})) {
            const row = rows.find((candidate) => candidate.field.name === name && candidate.visible);
            if (row) row.$error.text(message);
            else messages.push(message);
        }
        const shown = rows.some((row) => row.$error.text());
        const text = [shown && !messages.length ? '' : err.message, ...messages].filter(Boolean).join(': ');
        $error.text(text || 'Check the marked fields').show();
    };

    $form.on('change', 'select, input[type=checkbox]', arrange);
    $form.on('submit', async (event) => {
        event.preventDefault();
        $error.hide();
        rows.forEach((row) => row.$error.text(''));
        $submit.prop('disabled', true);
        try {
            await onSubmit(collectValues(rows), rawValues(rows));
            if (inDialog) closeDialog();
            else if (clear) {
                $form[0].reset();
                arrange();
            }
        } catch (err) {
            // An expired session is reported by its own handler
            if (err?.status !== 401) showFailure(err);
            else if (inDialog) closeDialog();
        } finally {
            $submit.prop('disabled', false);
        }
    });

    arrange();
    return $form;
}

// A form in the modal; see buildForm
export function formDialog({ title, ...form }) {
    showDialog(title, buildForm({ ...form, inDialog: true }));
}

// A form on the page; see buildForm
export const inlineForm = (form) => buildForm(form);

// Asks before something that can not be undone
export function confirmDialog({ title, message, confirmLabel = 'Delete', onConfirm }) {
    const $error = el('p', { class: 'form-error', role: 'alert' }).hide();
    const $confirm = control({
        inputType: 'button',
        value: confirmLabel,
        class: 'button danger',
        onclick: async () => {
            $confirm.prop('disabled', true);
            try {
                await onConfirm();
                closeDialog();
            } catch (err) {
                if (err?.status === 401) closeDialog();
                else $error.text(errorText(err)).show();
            } finally {
                $confirm.prop('disabled', false);
            }
        },
    });
    showDialog(title, el('div', { class: 'form' }, $error, el('p', { text: message }), el('div', { class: 'actions' }, $confirm, button('Cancel', closeDialog))));
}

// A failure of the form itself, shown at the field: throw fieldError('name', 'message')
export function fieldError(name, message) {
    return Object.assign(new Error('Check the marked fields'), { details: { [name]: message } });
}

///--- Pieces of a page

export const PAGE_SIZE = 20;

export const link = (href, text) => el('a', { href, text });
export const head = (title, ...actions) => el('div', { class: 'toolbar page-head' }, el('h2', { text: title }), el('span', { class: 'spacer' }), actions);
export const options = (pairs) => pairs.map(([value, text]) => ({ value, text }));
export const fact = (term, value) => el('span', {}, el('span', { text: `${term}: ` }), value);

export function card(title, rows, ...actions) {
    return el(
        'section',
        { class: 'card' },
        el('h3', { text: title }),
        el('dl', {}, rows.map(([term, value]) => [el('dt', { text: term }), el('dd', {}, value)])),
        actions.filter(Boolean).length ? el('div', { class: 'actions' }, actions) : null
    );
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
