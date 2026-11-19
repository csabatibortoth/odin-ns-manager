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
 * @property {{type: string, pattern: RegExp, inner?: (text: string) => {type: string|null, text: string}[]}[]} rules `type` becomes the class `tok-<type>`;
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
 */
export function tokenize(text, language) {
    const source = String(text ?? "");
    const lang = getLanguage(language);
    if (!lang || source.length > MAX_LENGTH) return source ? [{ type: null, text: source }] : [];
    const { groups, expression } = compile(lang);
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
        if (rule.inner) for (const part of rule.inner(match[0])) push(part.type, part.text);
        else push(rule.type, match[0]);
        position = match.index + match[0].length;
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

const jsRules = (keywords, types = []) => [
    rule("comment", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/),
    rule("string", new RegExp(`${STRING_DOUBLE.source}|${STRING_SINGLE.source}|\`(?:[^\`\\\\]|\\\\[\\s\\S])*\`?`)),
    rule("string", /(?<=(?:^|[=(:,[!&|?{};]|\breturn)\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/),
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

const BUILT_IN = [
    {
        name: "javascript", label: "JavaScript", aliases: ["js", "mjs", "jsx"], ...jsBase, rules: jsRules(JS_KEYWORDS)
    },
    {
        name: "typescript", label: "TypeScript", aliases: ["ts", "tsx"], ...jsBase, rules: jsRules([...JS_KEYWORDS, ...TS_KEYWORDS], TS_TYPES)
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

/** The token types the default theme gives a colour to: the classes are `tok-<type>`. */
export const TOKEN_TYPES = ["comment", "string", "number", "keyword", "literal", "function", "type", "property", "tag", "attribute", "variable", "selector", "meta", "entity", "builtin", "operator", "punctuation"];
