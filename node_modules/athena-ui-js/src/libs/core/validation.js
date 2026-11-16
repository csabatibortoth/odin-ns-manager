//validation for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { translate } from "./i18n.js";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmpty = value => value == null || value === false || value === "" || (Array.isArray(value) && !value.length);

/**
 * Validates one value. Returns the (translated) error text, or "" when the value is valid.
 * Empty values only fail `required`, so optional fields can stay empty.
 *
 * @param {*} value a string, boolean (checkbox) or array (multiple choice)
 * @param {object} [rules]
 * @param {boolean} [rules.required]
 * @param {boolean} [rules.email]
 * @param {number} [rules.minLength]
 * @param {number} [rules.maxLength]
 * @param {RegExp|string} [rules.pattern]
 * @param {number} [rules.min] numeric minimum
 * @param {number} [rules.max] numeric maximum
 * @param {string} [rules.match] name of another field that has to hold the same value
 * @param {(value, values) => (string|boolean|undefined)} [rules.validate] custom rule: a string is the error
 *        text, false is a generic error, anything else is valid
 * @param {object} [values] all values of the form, for `match` and `validate`
 */
export function validateValue(value, rules = {}, values = {}) {
    if (isEmpty(value)) return rules.required ? translate("validation.required") : "";
    const text = String(value);
    if (rules.email && !EMAIL_PATTERN.test(text)) return translate("validation.email");
    if (rules.minLength != null && text.length < rules.minLength) return translate("validation.minLength", { min: rules.minLength });
    if (rules.maxLength != null && text.length > rules.maxLength) return translate("validation.maxLength", { max: rules.maxLength });
    if (rules.pattern != null && !new RegExp(rules.pattern).test(text)) return translate("validation.pattern");
    if (rules.min != null && Number(value) < rules.min) return translate("validation.min", { min: rules.min });
    if (rules.max != null && Number(value) > rules.max) return translate("validation.max", { max: rules.max });
    if (rules.match != null && value !== values[rules.match]) return translate("validation.match");
    if (rules.validate) {
        const result = rules.validate(value, values);
        if (typeof result === "string") return result;
        if (result === false) return translate("validation.invalid");
    }
    return "";
}

/**
 * Checks a date range given as ISO dates ("2026-01-31"; they compare correctly as text).
 * Returns the (translated) error text, or "" when the range is valid. Empty dates are not an error.
 *
 * @param {string} from
 * @param {string} to
 * @param {{min?: string, max?: string}} [limits]
 */
export function validateDateRange(from, to, { min, max } = {}) {
    if (from && to && to < from) return translate("validation.dateRange");
    for (const date of [from, to]) {
        if (date && min && date < min) return translate("validation.dateMin", { min });
        if (date && max && date > max) return translate("validation.dateMax", { max });
    }
    return "";
}

/**
 * Validates a whole form.
 *
 * @param {Object<string, object>} ruleSet rules by field name
 * @param {Object<string, *>} values
 * @returns {Object<string, string>} error text by field name, only for invalid fields
 */
export function validateAll(ruleSet, values) {
    const errors = {};
    for (const [name, rules] of Object.entries(ruleSet)) {
        const error = validateValue(values[name], rules, values);
        if (error) errors[name] = error;
    }
    return errors;
}
