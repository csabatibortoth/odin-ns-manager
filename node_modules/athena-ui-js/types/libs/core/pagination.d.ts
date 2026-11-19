/**
 * Page buttons to show: first and last page, the current page with its neighbours, "…" for the gaps.
 * pageRange(5, 10, 1) -> [1, "…", 4, 5, 6, "…", 10]
 */
export function pageRange(page: any, pages: any, siblings?: number): any[];
