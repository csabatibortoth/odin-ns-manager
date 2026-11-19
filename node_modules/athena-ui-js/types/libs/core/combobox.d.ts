/**
 * Internal: input with a suggestion list. Single mode is an autocomplete, multiple mode a tag selector.
 * `source` is an array of options, or a function (query) => options | Promise<options>.
 */
export function createCombobox(options?: {}): {
    element: HTMLElement;
    input: HTMLElement;
    getValue: () => any;
    setValue: (value: any) => void;
};
