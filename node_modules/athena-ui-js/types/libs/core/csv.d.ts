/**
 * Converts rows to CSV text (RFC 4180 quoting, CRLF line ends).
 *
 * @param {{key: string, label?: string}[]} columns
 * @param {object[]} rows
 * @param {string} [separator=","]
 */
export function toCsv(columns: {
    key: string;
    label?: string;
}[], rows: object[], separator?: string): string;
export function downloadFile(filename: any, text: any, type?: string): void;
