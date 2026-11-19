//format helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { getLocale } from "./i18n.js";

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

/** 1234567.891 -> "1,234,567.89" (the separators of the current language). */
export function formatNumber(value, options = {}) {
    if (!Number.isFinite(value)) return "";
    return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2, ...options }).format(value);
}

const DURATION_UNITS = [["day", 86400000], ["hour", 3600000], ["minute", 60000], ["second", 1000]];

/**
 * A length of time in milliseconds as short text: 350 -> "350 ms", 45000 -> "45 sec", 7500000 -> "2 hr, 5 min".
 * At most `parts` units are shown (default 2). The unit names follow the current language.
 */
export function formatDuration(ms, { parts = 2 } = {}) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    const unit = (value, name) => new Intl.NumberFormat(getLocale(), { style: "unit", unit: name, unitDisplay: "short", maximumFractionDigits: 0 }).format(value);
    if (ms < 1000) return unit(Math.round(ms), "millisecond");
    let rest = Math.round(ms / 1000) * 1000;
    const out = [];
    for (const [name, size] of DURATION_UNITS) {
        const count = Math.floor(rest / size);
        if (count > 0 && out.length < parts) {
            out.push(unit(count, name));
            rest -= count * size;
        }
    }
    return out.join(", ");
}

const RELATIVE_UNITS = [["year", 31536000000], ["month", 2592000000], ["week", 604800000], ["day", 86400000], ["hour", 3600000], ["minute", 60000], ["second", 1000]];

/** "2 min ago", "in 3 days", "yesterday": the time between `date` and `now`, in the current language. */
export function formatRelativeTime(date, now = Date.now()) {
    const time = date instanceof Date ? date.getTime() : typeof date === "number" ? date : Date.parse(date);
    if (!Number.isFinite(time)) return "";
    const diff = time - now;
    const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
    for (const [unit, size] of RELATIVE_UNITS) {
        if (Math.abs(diff) >= size || unit === "second") return format.format(Math.round(diff / size), unit);
    }
    return "";
}

/** A date (and time) for people: formatDate(d) -> "Nov 19, 2026"; formatDate(d, { time: true }) adds the time. */
export function formatDate(date, { time = false, style = "medium" } = {}) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return "";
    return new Intl.DateTimeFormat(getLocale(), time ? { dateStyle: style, timeStyle: style === "full" || style === "long" ? "medium" : "short" } : { dateStyle: style }).format(value);
}
