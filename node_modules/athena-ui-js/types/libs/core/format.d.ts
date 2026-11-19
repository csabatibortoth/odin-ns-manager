export function formatBytes(bytes: any): string;
/**
 * Checks a file against an `accept` list like ".png,image/*,application/pdf". An empty list accepts everything.
 */
export function matchesAccept(file: any, accept: any): boolean;
/** 1234567.891 -> "1,234,567.89" (the separators of the current language). */
export function formatNumber(value: any, options?: {}): string;
/**
 * A length of time in milliseconds as short text: 350 -> "350 ms", 45000 -> "45 sec", 7500000 -> "2 hr, 5 min".
 * At most `parts` units are shown (default 2). The unit names follow the current language.
 */
export function formatDuration(ms: any, { parts }?: {
    parts?: number;
}): string;
/** "2 min ago", "in 3 days", "yesterday": the time between `date` and `now`, in the current language. */
export function formatRelativeTime(date: any, now?: number): string;
/** A date (and time) for people: formatDate(d) -> "Nov 19, 2026"; formatDate(d, { time: true }) adds the time. */
export function formatDate(date: any, { time, style }?: {
    time?: boolean;
    style?: string;
}): string;
