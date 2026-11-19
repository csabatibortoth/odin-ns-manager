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
export function validateValue(value: any, rules?: {
    required?: boolean;
    email?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp | string;
    min?: number;
    max?: number;
    match?: string;
    validate?: (value: any, values: any) => (string | boolean | undefined);
}, values?: object): any;
/**
 * Checks a date range given as ISO dates ("2026-01-31"; they compare correctly as text).
 * Returns the (translated) error text, or "" when the range is valid. Empty dates are not an error.
 *
 * @param {string} from
 * @param {string} to
 * @param {{min?: string, max?: string}} [limits]
 */
export function validateDateRange(from: string, to: string, { min, max }?: {
    min?: string;
    max?: string;
}): any;
/**
 * Validates a whole form.
 *
 * @param {Object<string, object>} ruleSet rules by field name
 * @param {Object<string, *>} values
 * @returns {Object<string, string>} error text by field name, only for invalid fields
 */
export function validateAll(ruleSet: {
    [x: string]: any;
}, values: {
    [x: string]: any;
}): {
    [x: string]: string;
};
export const EMAIL_PATTERN: RegExp;
