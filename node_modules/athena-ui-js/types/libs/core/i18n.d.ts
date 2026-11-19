export function setLocale(newLocale: any): void;
export function getLocale(): string;
export function addMessages(forLocale: any, texts: any): void;
/**
 * Looks a text up in the current locale, then in its base language ("hu-HU" -> "hu"), then in English.
 * Unknown keys are returned as they are.
 *
 * Placeholders: {name} is replaced from params as it is, {name:number} is formatted as a number and {name:date} as a date, in the current language (Intl).
 * Plural forms: a message can be an object with the forms of the language, and the form is chosen by `params.count`:
 *
 *     addMessages("en", { files: { zero: "No files", one: "{count} file", other: "{count:number} files" } });
 *     translate("files", { count: 1200 })   // "1,200 files"
 *
 * The keys are the categories of Intl.PluralRules for the language ("one", "other", and where the language has them "zero", "two", "few", "many"),
 * or an exact number ("0"). "other" is the fallback.
 */
export function translate(key: any, params?: {}): any;
