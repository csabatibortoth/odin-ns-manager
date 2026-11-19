/** Registers a language (and its aliases). */
export function registerLanguage(language: any): void;
/**
 * Splits text into tokens: [{ type, text }]. `type` is null for plain text. Concatenating the texts gives the input back.
 * An unknown language, or a text that is too long, gives one plain token.
 */
export function tokenize(text: any, language: any): any[];
export function getLanguage(name: any): any;
export function getLanguages(): any[];
/** The token types the default theme gives a colour to: the classes are `tok-<type>`. */
export const TOKEN_TYPES: string[];
/**
 * A language: an ordered list of rules. The text is scanned once; at every position the first rule that matches wins.
 */
export type CodeLanguage = {
    name: string;
    /**
     * shown in the label of a code block (default: the name)
     */
    label?: string;
    /**
     * other names ("js" for "javascript")
     */
    aliases?: string[];
    /**
     * `type` becomes the class `tok-<type>`;
     * the pattern must use non-capturing groups only; `inner` splits a match into smaller tokens (a tag into name and attributes)
     */
    rules: {
        type: string;
        pattern: RegExp;
        inner?: (text: string) => {
            type: string | null;
            text: string;
        }[];
    }[];
    /**
     * the rules are case-insensitive (SQL)
     */
    ignoreCase?: boolean;
    /**
     * ^ and $ match at every line (YAML, C# preprocessor lines)
     */
    multiline?: boolean;
    /**
     * used by the editor to comment lines ("//")
     */
    lineComment?: string;
    blockComment?: [string, string];
    /**
     * characters the editor closes: ["()", "[]", "{}", "\"\"", "''"]
     */
    pairs?: string[];
    /**
     * a line that matches this makes the next line one level deeper (/[{(\[:]\s*$/)
     */
    indentAfter?: RegExp;
};
