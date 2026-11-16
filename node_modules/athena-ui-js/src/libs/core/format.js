//format helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// 1536 -> "1.5 KB"
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit === 0 ? value : +value.toFixed(1)} ${units[unit]}`;
}

/**
 * Checks a file against an `accept` list like ".png,image/*,application/pdf". An empty list accepts everything.
 */
export function matchesAccept(file, accept) {
    const rules = String(accept ?? "").split(",").map(rule => rule.trim().toLowerCase()).filter(Boolean);
    if (!rules.length) return true;
    const name = file.name.toLowerCase();
    const type = (file.type ?? "").toLowerCase();
    return rules.some(rule =>
        rule.startsWith(".") ? name.endsWith(rule)
            : rule.endsWith("/*") ? type.startsWith(rule.slice(0, -1))
                : type === rule);
}
