//csv for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Quotes a cell when needed. Cells starting with = + - @ are prefixed with ' so a spreadsheet
// does not run user supplied data as a formula.
function cell(value, separator) {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
    return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Converts rows to CSV text (RFC 4180 quoting, CRLF line ends).
 *
 * @param {{key: string, label?: string}[]} columns
 * @param {object[]} rows
 * @param {string} [separator=","]
 */
export function toCsv(columns, rows, separator = ",") {
    const lines = [columns.map(col => cell(col.label ?? col.key, separator))];
    for (const row of rows) lines.push(columns.map(col => cell(row[col.key], separator)));
    return lines.map(line => line.join(separator)).join("\r\n");
}

// Offers the text as a file download in the browser.
export function downloadFile(filename, text, type = "text/csv;charset=utf-8") {
    const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
