//Tokenizers for code highlighting (no DOM): a language is a plain object, applications add their own with registerLanguage().
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/**
 * A language: an ordered list of rules. The text is scanned once; at every position the first rule that matches wins.
 *
 * @typedef {object} CodeLanguage
 * @property {string} name
 * @property {string} [label] shown in the label of a code block (default: the name)
 * @property {string[]} [aliases] other names ("js" for "javascript")
 * @property {{type: string, pattern: RegExp, inner?: (text: string) => {type: string|null, text: string}[], extend?: (source: string, start: number) => number, nested?: boolean}[]} rules `type` becomes the class `tok-<type>`;
 *           `extend` gives the end of a match that a pattern cannot find (nested constructs); `nested` marks a match that holds other tokens and may span lines;
 *           the pattern must use non-capturing groups only; `inner` splits a match into smaller tokens (a tag into name and attributes)
 * @property {boolean} [ignoreCase] the rules are case-insensitive (SQL)
 * @property {boolean} [multiline] ^ and $ match at every line (YAML, C# preprocessor lines)
 * @property {string} [lineComment] used by the editor to comment lines ("//")
 * @property {[string, string]} [blockComment]
 * @property {string[]} [pairs] characters the editor closes: ["()", "[]", "{}", "\"\"", "''"]
 * @property {RegExp} [indentAfter] a line that matches this makes the next line one level deeper (/[{(\[:]\s*$/)
 */

const languages = new Map();
const compiled = new WeakMap();

/** Registers a language (and its aliases). */
export function registerLanguage(language) {
    if (typeof language?.name !== "string" || !Array.isArray(language.rules)) throw new TypeError("Athena UI: a language needs a name and rules");
    for (const rule of language.rules) {
        if (typeof rule?.type !== "string" || !(rule.pattern instanceof RegExp)) throw new TypeError(`Athena UI: a rule of "${language.name}" needs a type and a pattern`);
    }
    for (const name of [language.name, ...(language.aliases ?? [])]) languages.set(name.toLowerCase(), language);
    compiled.delete(language);
}

/** The language registered under a name or alias, or undefined. */
export const getLanguage = name => (typeof name === "string" ? languages.get(name.toLowerCase()) : name && typeof name === "object" ? name : undefined);

/** The names of the registered languages (no aliases). */
export const getLanguages = () => [...new Set(languages.values())].map(language => language.name);

function compile(language) {
    if (compiled.has(language)) return compiled.get(language);
    const groups = [];
    let index = 1;
    const sources = language.rules.map(rule => {
        groups.push(index);
        index += new RegExp(`${rule.pattern.source}|`).exec("").length;      // the group of the rule and the groups inside it
        return `(${rule.pattern.source})`;
    });
    const result = { groups, expression: new RegExp(sources.join("|"), `g${language.ignoreCase ? "i" : ""}${language.multiline ? "m" : ""}`) };
    compiled.set(language, result);
    return result;
}

const MAX_LENGTH = 3_000_000;

/**
 * Splits text into tokens: [{ type, text }]. `type` is null for plain text. Concatenating the texts gives the input back.
 * An unknown language, or a text that is too long, gives one plain token.
 *
 * @param {string} text
 * @param {string|object} language
 * @param {{start: number, end: number, nested: boolean}[]} [spans] filled with the matches that span lines, and the nested ones: an editor must not start tokenizing inside them
 */
export function tokenize(text, language, spans) {
    const source = String(text ?? "");
    const lang = getLanguage(language);
    if (!lang || source.length > MAX_LENGTH) return source ? [{ type: null, text: source }] : [];
    const { groups, expression: shared } = compile(lang);
    const expression = new RegExp(shared);      // its own position: a nested construct is tokenized while this scan goes on
    const tokens = [];
    const push = (type, value) => {
        if (!value) return;
        const last = tokens.at(-1);
        if (last && last.type === type) last.text += value;
        else tokens.push({ type, text: value });
    };
    expression.lastIndex = 0;
    let position = 0;
    let match;
    while ((match = expression.exec(source))) {
        if (match[0] === "") {
            expression.lastIndex++;
            continue;
        }
        const rule = lang.rules[groups.findLastIndex(start => match[start] !== undefined)];
        push(null, source.slice(position, match.index));
        let value = match[0];
        if (rule.extend) {
            value = source.slice(match.index, Math.max(rule.extend(source, match.index), match.index + 1));
            expression.lastIndex = match.index + value.length;
        }
        if (rule.inner) for (const part of rule.inner(value)) push(part.type, part.text);
        else push(rule.type, value);
        position = match.index + value.length;
        if (spans && (rule.nested || value.includes("\n"))) spans.push({ start: match.index, end: position, nested: Boolean(rule.nested) });
    }
    push(null, source.slice(position));
    return tokens;
}

/* ------------------LANGUAGES------------------- */

const words = list => new RegExp(`\\b(?:${list.join("|")})\\b`);
const rule = (type, pattern) => ({ type, pattern });

const STRING_DOUBLE = /"(?:[^"\\\n]|\\[\s\S])*"?/;
const STRING_SINGLE = /'(?:[^'\\\n]|\\[\s\S])*'?/;
const NUMBER_C = /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFdDmMuUlL]*)\b|\.\d+/;
const PUNCTUATION = /[{}()[\];,.]/;
const OPERATOR = /[=+\-*/%<>!&|^~?:]+/;

const JS_KEYWORDS = ["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof",
    "let", "new", "of", "return", "static", "super", "switch", "throw", "try", "typeof", "var", "void", "while", "with", "yield", "async", "await", "from", "as", "get", "set"];
const TS_KEYWORDS = ["interface", "type", "enum", "implements", "namespace", "declare", "readonly", "abstract", "public", "private", "protected", "keyof", "infer", "satisfies", "is", "module", "override"];
const TS_TYPES = ["string", "number", "boolean", "any", "unknown", "never", "void", "object", "symbol", "bigint"];

// ---- template strings: `a ${ b(`c ${d}`) } e` cannot be matched by a pattern, so it is scanned ----
const MAX_NESTING = 20;

// a "/" where a value is expected starts a regular expression: its quotes, backticks and braces are not code
const REGEX_LITERAL = /(?<=(?:^|[=(:,[!&|?{};]|\breturn)\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/;
const REGEX_HERE = new RegExp(REGEX_LITERAL.source, "y");

/** Scans the template that starts at `start`; returns its end and the ranges of the code inside its outermost ${}. */
function scanTemplate(source, start) {
    const code = [];
    const stack = ["`"];           // "`": in the text of a template; a number: in the code of a ${}, counting its braces
    let from = 0;
    let i = start + 1;
    while (i < source.length && stack.length) {
        const char = source[i];
        const top = stack.at(-1);
        if (top === "`") {
            if (char === "\\") i++;
            else if (char === "`") stack.pop();
            else if (char === "$" && source[i + 1] === "{") {
                if (stack.length === 1) from = i + 2;
                stack.push(0);
                i++;
            }
        } else if (char === "`") stack.push("`");
        else if (char === "{") stack[stack.length - 1]++;
        else if (char === "}") {
            if (top > 0) stack[stack.length - 1]--;
            else {
                stack.pop();
                if (stack.length === 1) code.push([from, i]);
            }
        } else if (char === '"' || char === "'") {
            while (i + 1 < source.length && source[i + 1] !== char && source[i + 1] !== "\n") i += source[i + 1] === "\\" ? 2 : 1;
            if (source[i + 1] === char) i++;
        } else if (char === "/" && source[i + 1] === "/") {
            while (i + 1 < source.length && source[i + 1] !== "\n") i++;
        } else if (char === "/" && source[i + 1] === "*") {
            const close = source.indexOf("*/", i + 2);
            i = close === -1 ? source.length : close + 1;
        } else if (char === "/") {
            REGEX_HERE.lastIndex = i;
            if (REGEX_HERE.test(source)) i = REGEX_HERE.lastIndex - 1;
        }
        i++;
    }
    if (stack.length > 1 && typeof stack[1] === "number") code.push([from, source.length]);      // an unfinished ${
    return { end: Math.min(i, source.length), code };
}

let nesting = 0;
const templateRule = name => ({
    type: "string",
    pattern: /`/,
    nested: true,
    extend: (source, start) => scanTemplate(source, start).end,
    inner(text) {
        const { code } = scanTemplate(text, 0);
        if (!code.length || nesting >= MAX_NESTING) return [{ type: "string", text }];
        const parts = [];
        let at = 0;
        nesting++;
        try {
            for (const [from, to] of code) {
                parts.push({ type: "string", text: text.slice(at, from - 2) }, { type: "punctuation", text: "${" }, ...tokenize(text.slice(from, to), name));
                at = to;
                if (text[to] === "}") {
                    parts.push({ type: "punctuation", text: "}" });
                    at++;
                }
            }
        } finally {
            nesting--;
        }
        parts.push({ type: "string", text: text.slice(at) });
        return parts;
    }
});

const jsRules = (name, keywords, types = []) => [
    rule("comment", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/),
    rule("string", new RegExp(`${STRING_DOUBLE.source}|${STRING_SINGLE.source}`)),
    templateRule(name),
    rule("string", REGEX_LITERAL),
    rule("number", NUMBER_C),
    rule("keyword", words(keywords)),
    ...(types.length ? [rule("type", words(types))] : []),
    rule("literal", words(["true", "false", "null", "undefined", "NaN", "Infinity", "this"])),
    rule("function", /[A-Za-z_$][\w$]*(?=\s*\()/),
    rule("type", /\b[A-Z][\w$]*\b/),
    rule("punctuation", PUNCTUATION),
    rule("operator", OPERATOR)
];

const jsBase = { lineComment: "//", blockComment: ["/*", "*/"], pairs: ["()", "[]", "{}", "\"\"", "''", "``"], indentAfter: /[{([]\s*$/ };

const HTML_TAG_PARTS = text => {
    const out = [];
    const part = /^<\/?[\w:-]+|\/?>$|"[^"]*"|'[^']*'|[^\s"'<>/=]+(?=\s*=)|=|[^\s"'<>/=]+|\s+|[\s\S]/g;
    for (const [piece] of text.matchAll(part)) {
        let type = null;
        if (/^<\/?[\w:-]+$/.test(piece) || /^\/?>$/.test(piece)) type = "tag";
        else if (/^["']/.test(piece)) type = "string";
        else if (piece === "=") type = "punctuation";
        else if (/^[^\s]/.test(piece)) type = "attribute";
        out.push({ type, text: piece });
    }
    return out;
};

const SQL_KEYWORDS = ["select", "from", "where", "and", "or", "not", "in", "is", "null", "like", "between", "exists", "insert", "into", "values", "update", "set", "delete", "create", "alter", "drop",
    "table", "view", "index", "database", "schema", "join", "inner", "left", "right", "full", "outer", "cross", "on", "using", "group", "by", "order", "having", "limit", "offset", "union", "all", "distinct",
    "as", "case", "when", "then", "else", "end", "with", "primary", "key", "foreign", "references", "constraint", "default", "unique", "check", "asc", "desc", "begin", "commit", "rollback", "transaction",
    "grant", "revoke", "top", "over", "partition", "returning", "cascade", "if", "truncate", "explain", "declare", "exec", "execute", "procedure", "function", "trigger", "add", "column"];
const SQL_TYPES = ["int", "integer", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "double", "varchar", "nvarchar", "char", "nchar", "text", "date", "datetime", "datetime2", "timestamp",
    "time", "boolean", "bit", "uuid", "uniqueidentifier", "blob", "json", "jsonb", "money", "serial"];

const SHELL_KEYWORDS = ["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "select", "return", "exit", "break", "continue", "local", "export", "readonly", "declare", "unset", "shift", "source", "time"];
const SHELL_BUILTINS = ["echo", "cd", "pwd", "ls", "cat", "grep", "sed", "awk", "mkdir", "rm", "cp", "mv", "chmod", "chown", "curl", "wget", "git", "npm", "node", "docker", "kubectl", "sudo", "ssh", "tar", "printf", "read", "test", "true", "false", "eval", "exec", "trap", "set"];

const CS_KEYWORDS = ["abstract", "as", "base", "break", "case", "catch", "checked", "class", "const", "continue", "default", "delegate", "do", "else", "enum", "event", "explicit", "extern", "finally", "fixed",
    "for", "foreach", "goto", "if", "implicit", "in", "interface", "internal", "is", "lock", "namespace", "new", "operator", "out", "override", "params", "private", "protected", "public", "readonly", "ref",
    "return", "sealed", "sizeof", "stackalloc", "static", "struct", "switch", "this", "throw", "try", "typeof", "unchecked", "unsafe", "using", "virtual", "volatile", "while", "async", "await", "var", "record",
    "init", "get", "set", "where", "yield", "when", "partial", "required", "with", "global"];
const CS_TYPES = ["bool", "byte", "sbyte", "char", "decimal", "double", "float", "int", "uint", "long", "ulong", "short", "ushort", "object", "string", "void", "dynamic", "nint", "nuint"];

const PY_KEYWORDS = ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
    "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"];
const PY_BUILTINS = ["print", "len", "range", "list", "dict", "set", "tuple", "str", "int", "float", "bool", "type", "isinstance", "open", "enumerate", "zip", "map", "filter", "sorted", "sum", "min", "max", "abs", "super", "self", "cls"];

// ---- <script> and <style> inside HTML ----
const TAG_ATTRIBUTES = String.raw`(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?>`;
const eitherCase = word => [...word].map(char => `[${char}${char.toUpperCase()}]`).join("");

function embeddedLanguage(element, openTag) {
    if (element === "style") return "css";
    const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(openTag)?.[1].toLowerCase();
    if (!type || type === "module" || /javascript|ecmascript/.test(type)) return "javascript";
    return type === "importmap" || /json$/.test(type) ? "json" : null;      // a template or an unknown type stays plain
}

const embedded = element => {
    const open = new RegExp(`^<${eitherCase(element)}(?=[\\s/>])${TAG_ATTRIBUTES}`);
    const close = new RegExp(`</${eitherCase(element)}\\s*>?$`);
    return {
        type: "tag",
        // up to the closing tag, or to the end of the text while it is being typed
        pattern: new RegExp(`<${eitherCase(element)}(?=[\\s/>])${TAG_ATTRIBUTES}[\\s\\S]*?(?:</${eitherCase(element)}\\s*>|$)`),
        nested: true,
        inner(text) {
            const start = open.exec(text)[0];
            const end = close.exec(text)?.[0] ?? "";
            const body = text.slice(start.length, text.length - end.length);
            const language = embeddedLanguage(element, start);
            return [...HTML_TAG_PARTS(start), ...(language ? tokenize(body, language) : [{ type: null, text: body }]), ...(end ? HTML_TAG_PARTS(end) : [])];
        }
    };
};

// ---- log lines (from Heimdall's log display) ----
// Every pattern is bounded (no open-ended repetition), so a scan stays linear in the length of a line.
const LOG_PATTERNS = {
    url: String.raw`https?:\/\/[^\s"'<>]{1,500}`,
    email: String.raw`[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,6}`,
    uuid: String.raw`(?<![\w-])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![\w-])`,
    time: String.raw`\d\d\/[A-Z][a-z]{2}\/\d{4}:\d\d:\d\d:\d\d(?: [+-]\d{4})?|\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d{1,9})?(?:Z|[+-]\d\d:?\d\d)?|[A-Z][a-z]{2}\s{1,2}\d{1,2} \d\d:\d\d:\d\d|(?<![\w:.])\d\d:\d\d:\d\d(?:[.,]\d{1,9})?(?![\w:])`,
    frame: String.raw`[\w./@\\-]{1,200}\.(?:js|mjs|cjs|jsx|ts|tsx|py|java|kt|go|rb|php|cs|cpp|cc|c|h|rs|swift):\d{1,6}(?::\d{1,6})?`,
    ipv6: String.raw`(?<![\w:])(?=[0-9A-Fa-f:]*:[0-9A-Fa-f:]*)[0-9A-Fa-f:]{2,39}(?![\w:])`,
    ipv4: String.raw`(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?![\w])`,
    path: String.raw`(?<![\w/.:~-])(?:\/[\w.@%+~-]{1,100}){2,12}`,
    key: String.raw`(?<![\w.-])[A-Za-z_][\w.-]{0,40}=`,
    size: String.raw`(?<![\w.-])\d+(?:\.\d+)?(?:ms|µs|us|ns|[kKMGT]i?B|B|s|m|h|d|%)(?!\w)`,
    method: String.raw`(?<!\w)(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(?!\w)`,
    status: String.raw`(?<![\w.-])[1-5]\d\d(?![\w.-])`,
    level: String.raw`(?<!\w)(?:TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|ERR|FATAL|CRITICAL|CRIT|PANIC)(?!\w)`
};
const LOG_INSIDE_TYPES = { url: "string", email: "string", uuid: "variable", time: "number", frame: "property", ipv6: "number", ipv4: "number", path: "property", key: "property", size: "number", method: "keyword", status: "number", level: "keyword" };
const LOG_INNER = new RegExp(Object.keys(LOG_INSIDE_TYPES).map(name => `(?<${name}>${LOG_PATTERNS[name]})`).join("|"), "gu");

// A quoted string keeps its quotes as string, but its parts (a request line, an address) keep their own type.
function logStringParts(text) {
    const out = [];
    let at = 0;
    for (const match of text.matchAll(LOG_INNER)) {
        const name = Object.keys(LOG_INSIDE_TYPES).find(key => match.groups[key] !== undefined);
        if (!name || match.index < at) continue;
        if (match.index > at) out.push({ type: "string", text: text.slice(at, match.index) });
        out.push({ type: LOG_INSIDE_TYPES[name], text: match[0] });
        at = match.index + match[0].length;
    }
    if (at < text.length) out.push({ type: "string", text: text.slice(at) });
    return out;
}

const isIPv4 = text => text.replace(/:\d+$/, "").split(".").every(octet => Number(octet) <= 255);
function isIPv6(text) {
    if (!/^[0-9A-Fa-f:]+$/.test(text)) return false;
    const doubled = text.split("::").length - 1;
    if (doubled > 1 || text.includes(":::")) return false;
    const groups = text.split(":").filter(group => group !== "");
    if (groups.some(group => group.length > 4)) return false;
    return doubled === 1 ? groups.length <= 7 : text.split(":").length === 8;
}
const addressParts = (type, valid) => text => valid(text) ? [{ type, text }] : [{ type: null, text }];
const urlParts = text => {
    const value = text.replace(/[.,;:!?)\]}]+$/, "");
    return value.length ? [{ type: "string", text: value }, { type: null, text: text.slice(value.length) }] : [{ type: null, text }];
};

const LOG_RULES = [
    { type: "string", pattern: new RegExp(LOG_PATTERNS.url), inner: urlParts },
    rule("string", new RegExp(LOG_PATTERNS.email)),
    rule("variable", new RegExp(LOG_PATTERNS.uuid)),
    rule("number", new RegExp(LOG_PATTERNS.time)),
    rule("property", new RegExp(LOG_PATTERNS.frame)),
    { type: "number", pattern: new RegExp(LOG_PATTERNS.ipv6), inner: addressParts("number", isIPv6) },
    { type: "number", pattern: new RegExp(LOG_PATTERNS.ipv4), inner: addressParts("number", isIPv4) },
    rule("property", new RegExp(LOG_PATTERNS.path)),
    { type: "string", pattern: /"[^\"\n]{0,300}"/, inner: logStringParts },
    rule("property", new RegExp(LOG_PATTERNS.key)),
    rule("number", new RegExp(LOG_PATTERNS.size)),
    rule("keyword", new RegExp(LOG_PATTERNS.method)),
    rule("number", new RegExp(LOG_PATTERNS.status)),
    rule("keyword", new RegExp(LOG_PATTERNS.level))
];

const BUILT_IN = [
    {
        name: "javascript", label: "JavaScript", aliases: ["js", "mjs", "jsx"], ...jsBase, rules: jsRules("javascript", JS_KEYWORDS)
    },
    {
        name: "typescript", label: "TypeScript", aliases: ["ts", "tsx"], ...jsBase, rules: jsRules("typescript", [...JS_KEYWORDS, ...TS_KEYWORDS], TS_TYPES)
    },
    {
        name: "json", label: "JSON", aliases: ["jsonc"], pairs: ["[]", "{}", "\"\""], indentAfter: /[{[]\s*$/,
        rules: [
            rule("comment", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/),
            rule("property", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/),
            rule("string", STRING_DOUBLE),
            rule("number", /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/),
            rule("literal", words(["true", "false", "null"])),
            rule("punctuation", /[{}[\],:]/)
        ]
    },
    {
        name: "html", label: "HTML", aliases: ["xml", "svg", "xhtml"], blockComment: ["<!--", "-->"], pairs: ["\"\"", "''"], indentAfter: /<[a-z][^>/]*>\s*$/i,
        rules: [
            rule("comment", /<!--[\s\S]*?(?:-->|$)/),
            rule("meta", /<![A-Za-z][^>]*>|<\?[\s\S]*?(?:\?>|$)/),
            embedded("script"),
            embedded("style"),
            { type: "tag", pattern: /<\/?[A-Za-z][\w:-]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?>/, inner: HTML_TAG_PARTS },
            rule("entity", /&(?:#\d+|#x[\da-fA-F]+|\w+);/)
        ]
    },
    {
        name: "css", label: "CSS", aliases: ["scss", "less"], blockComment: ["/*", "*/"], pairs: ["()", "[]", "{}", "\"\"", "''"], indentAfter: /\{\s*$/,
        rules: [
            rule("comment", /\/\*[\s\S]*?(?:\*\/|$)/),
            rule("string", new RegExp(`${STRING_DOUBLE.source}|${STRING_SINGLE.source}`)),
            rule("meta", /@[\w-]+/),
            rule("variable", /--[\w-]+/),
            rule("number", /#[\da-fA-F]{3,8}\b|-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/),
            rule("property", /[-\w]+(?=\s*:\s*[^;{}]*[;}])/),
            rule("selector", /[.#][-\w]+|::?[-\w]+|\*/),
            rule("function", /[-\w]+(?=\()/),
            rule("keyword", /!important\b/),
            rule("punctuation", /[{}()[\];,:>+~]/)
        ]
    },
    {
        name: "sql", label: "SQL", aliases: ["tsql", "mysql", "postgres", "postgresql"], ignoreCase: true, lineComment: "--", blockComment: ["/*", "*/"], pairs: ["()", "''", "\"\""], indentAfter: /\(\s*$/,
        rules: [
            rule("comment", /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/),
            rule("string", /'(?:[^']|'')*'?/),
            rule("variable", /"[^"\n]*"?|`[^`\n]*`?|\[[^\]\n]*\]|[@:][\w]+/),
            rule("number", /\b\d+\.?\d*\b/),
            rule("keyword", words(SQL_KEYWORDS)),
            rule("type", words(SQL_TYPES)),
            rule("function", /\b[A-Za-z_]\w*(?=\s*\()/),
            rule("operator", /[=<>!+\-*/%|&^~]+/),
            rule("punctuation", /[();,.]/)
        ]
    },
    {
        name: "shell", label: "Shell", aliases: ["sh", "bash", "zsh", "shellscript"], lineComment: "#", pairs: ["()", "[]", "{}", "\"\"", "''", "``"], indentAfter: /(?:\b(?:then|do|else)|[{(])\s*$/,
        rules: [
            rule("comment", /(?<=^|\s)#[^\n]*/),
            rule("string", /"(?:[^"\\]|\\[\s\S])*"?|'[^']*'?/),
            rule("variable", /\$(?:\w+|\{[^}\n]*\}?|\([^)\n]*\)?|[@*#?$!-])/),
            rule("keyword", words(SHELL_KEYWORDS)),
            rule("function", words(SHELL_BUILTINS)),
            rule("attribute", /(?<=\s)--?[A-Za-z][\w-]*/),
            rule("number", /\b\d+\b/),
            rule("operator", /[|&;<>=!]+/)
        ]
    },
    {
        name: "yaml", label: "YAML", aliases: ["yml"], multiline: true, lineComment: "#", pairs: ["[]", "{}", "\"\"", "''"], indentAfter: /:\s*$/,
        rules: [
            rule("comment", /(?<=^|\s)#[^\n]*/),
            rule("meta", /^(?:---|\.\.\.)(?=\s|$)/),
            rule("property", /(?<=^[ \t-]*)(?:"[^"\n]*"|'[^'\n]*'|[^\s#:[\]{},"'-][^:\n#]*?)(?=\s*:(?:\s|$))/),
            rule("string", /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\n]|'')*'?/),
            rule("variable", /[&*!][\w-]+/),
            rule("number", /(?<=[\s:[,-]|^)-?\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?(?=\s|$|[,\]}])/),
            rule("literal", /(?<=[\s:[,-]|^)(?:true|false|null|yes|no|on|off|~)(?=\s|$|[,\]}])/i),
            rule("punctuation", /[[\]{},|>]|(?<=^|\s)-(?=\s)/)
        ]
    },
    {
        name: "csharp", label: "C#", aliases: ["cs", "c#", "dotnet"], lineComment: "//", blockComment: ["/*", "*/"], pairs: ["()", "[]", "{}", "\"\"", "''"], indentAfter: /[{([]\s*$/, multiline: true,
        rules: [
            rule("comment", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/),
            rule("meta", /^[ \t]*#[a-z]+[^\n]*/),
            rule("string", /@"(?:[^"]|"")*"?|[$@]{0,2}"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/),
            rule("number", NUMBER_C),
            rule("keyword", words(CS_KEYWORDS)),
            rule("type", words(CS_TYPES)),
            rule("literal", words(["true", "false", "null"])),
            rule("function", /[A-Za-z_]\w*(?=\s*[(<][^;{)]*\)?\s*[{;=(]|\()/),
            rule("type", /\b[A-Z]\w*\b/),
            rule("punctuation", PUNCTUATION),
            rule("operator", OPERATOR)
        ]
    },
    {
        name: "python", label: "Python", aliases: ["py", "python3"], multiline: true, lineComment: "#", pairs: ["()", "[]", "{}", "\"\"", "''"], indentAfter: /:\s*$/,
        rules: [
            rule("comment", /#[^\n]*/),
            rule("string", /[rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/),
            rule("meta", /^[ \t]*@[\w.]+/),
            rule("number", /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?)\b|\.\d+/),
            rule("function", /(?<=\bdef\s+)\w+/),
            rule("type", /(?<=\bclass\s+)\w+/),
            rule("keyword", words(PY_KEYWORDS)),
            rule("literal", words(["True", "False", "None"])),
            rule("builtin", words(PY_BUILTINS)),
            rule("function", /[A-Za-z_]\w*(?=\s*\()/),
            rule("punctuation", /[{}()[\];,.:]/),
            rule("operator", /[=+\-*/%<>!&|^~@]+/)
        ]
    }
];

for (const language of BUILT_IN) registerLanguage(language);
registerLanguage({ name: "log", label: "Log lines", rules: LOG_RULES });

/** The token types the default theme gives a colour to: the classes are `tok-<type>`. */
export const TOKEN_TYPES = ["comment", "string", "number", "keyword", "literal", "function", "type", "property", "tag", "attribute", "variable", "selector", "meta", "entity", "builtin", "operator", "punctuation"];
