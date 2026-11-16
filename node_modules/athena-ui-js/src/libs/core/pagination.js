//pagination helper for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/**
 * Page buttons to show: first and last page, the current page with its neighbours, "…" for the gaps.
 * pageRange(5, 10, 1) -> [1, "…", 4, 5, 6, "…", 10]
 */
export function pageRange(page, pages, siblings = 1) {
    const wanted = new Set([1, pages]);
    for (let p = page - siblings; p <= page + siblings; p++) {
        if (p >= 1 && p <= pages) wanted.add(p);
    }
    const sorted = [...wanted].sort((a, b) => a - b);
    const result = [];
    sorted.forEach((p, i) => {
        const previous = sorted[i - 1];
        if (previous !== undefined && p - previous === 2) result.push(previous + 1);
        else if (previous !== undefined && p - previous > 2) result.push("…");
        result.push(p);
    });
    return result;
}
