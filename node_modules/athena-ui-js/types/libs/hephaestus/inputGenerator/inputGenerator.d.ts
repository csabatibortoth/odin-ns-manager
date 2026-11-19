/**
 * Generates an input with suggestions. `options` is an array of strings / { value, text }, or a function
 * (query) => options | Promise<options> for remote data.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.label]
 * @param {Array|Function} options.options
 * @param {number} [options.minChars=1] characters needed before suggestions show
 * @param {boolean} [options.strict=false] only a value chosen from the list is accepted
 * @param {(item: {value, text}) => void} [options.onSelect]
 * @param {(value) => void} [options.onChange]
 * @returns {{element: HTMLElement, input: HTMLInputElement, getValue: Function, setValue: Function}}
 */
export function generateAutocomplete(options?: {
    parent?: string | Element;
    label?: string;
    options: any[] | Function;
    minChars?: number;
    strict?: boolean;
    onSelect?: (item: {
        value: any;
        text: any;
    }) => void;
    onChange?: (value: any) => void;
}): {
    element: HTMLElement;
    input: HTMLInputElement;
    getValue: Function;
    setValue: Function;
};
/**
 * Generates a multiple selection with chips. Same options as generateAutocomplete; getValue returns an array.
 */
export function generateMultiSelect(options?: {}): any;
/**
 * Generates a from / to date picker (the native pickers of the browser). The end date cannot be picked before
 * the start date, and validate() reports a reversed range typed by hand.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.label]
 * @param {string} [options.from] initial start, "2026-01-31"
 * @param {string} [options.to] initial end
 * @param {string} [options.min] earliest date
 * @param {string} [options.max] latest date
 * @param {(value: {from: string, to: string}) => void} [options.onChange]
 * @returns {{element: HTMLElement, getValue: () => {from: string, to: string}, setValue: Function, validate: () => string}}
 */
export function generateDateRange(options?: {
    parent?: string | Element;
    label?: string;
    from?: string;
    to?: string;
    min?: string;
    max?: string;
    onChange?: (value: {
        from: string;
        to: string;
    }) => void;
}): {
    element: HTMLElement;
    getValue: () => {
        from: string;
        to: string;
    };
    setValue: Function;
    validate: () => string;
};
/**
 * Generates a from / to range with date AND time (datetime-local inputs), and a list of presets: last 15 minutes, hour,
 * 24 hours, 7 days, 30 days, or "Custom". For log filters, charts and reports that need times, not whole days.
 * A preset moves with the clock: getRange() measures it from now when it is called.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.label]
 * @param {string} [options.from] initial start, "2026-01-31T08:00"
 * @param {string} [options.to] initial end
 * @param {string} [options.preset] id of the preset to start with ("15m", "1h", "24h", "7d", "30d")
 * @param {{id: string, label?: string, labelKey?: string, minutes: number}[]} [options.presets] your own list
 * @param {boolean} [options.seconds=false]
 * @param {string} [options.min]
 * @param {string} [options.max]
 * @param {(value: {from: string, to: string, preset: string}) => void} [options.onChange]
 * @returns {{element: HTMLElement, getValue: Function, getRange: () => ({from: Date|null, to: Date|null}), setValue: Function, validate: () => string}}
 */
export function generateDateTimeRange(options?: {
    parent?: string | Element;
    label?: string;
    from?: string;
    to?: string;
    preset?: string;
    presets?: {
        id: string;
        label?: string;
        labelKey?: string;
        minutes: number;
    }[];
    seconds?: boolean;
    min?: string;
    max?: string;
    onChange?: (value: {
        from: string;
        to: string;
        preset: string;
    }) => void;
}): {
    element: HTMLElement;
    getValue: Function;
    getRange: () => ({
        from: Date | null;
        to: Date | null;
    });
    setValue: Function;
    validate: () => string;
};
/**
 * Generates a drop zone with a file list and upload progress.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.accept] ".png,image/*"
 * @param {boolean} [options.multiple=true]
 * @param {number} [options.maxSize] bytes per file
 * @param {string} [options.url] upload endpoint (multipart POST). Without it the files are only collected.
 * @param {string} [options.fieldName="file"] name of the form field the file is sent as
 * @param {Object<string,string>} [options.headers]
 * @param {boolean} [options.autoUpload=true] upload as soon as files are added
 * @param {(files: File[]) => void} [options.onSelect]
 * @param {(file: File, percent: number) => void} [options.onProgress]
 * @param {(file: File, response: string) => void} [options.onComplete]
 * @param {(file: File, error: Error) => void} [options.onError]
 * @returns {{element: HTMLElement, getFiles: () => File[], upload: () => Promise<void>, clear: Function}}
 */
export function generateFileUpload(options?: {
    parent?: string | Element;
    accept?: string;
    multiple?: boolean;
    maxSize?: number;
    url?: string;
    fieldName?: string;
    headers?: {
        [x: string]: string;
    };
    autoUpload?: boolean;
    onSelect?: (files: File[]) => void;
    onProgress?: (file: File, percent: number) => void;
    onComplete?: (file: File, response: string) => void;
    onError?: (file: File, error: Error) => void;
}): {
    element: HTMLElement;
    getFiles: () => File[];
    upload: () => Promise<void>;
    clear: Function;
};
/**
 * Generates a multi step form (wizard).
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{id?: string, title: string, content: *, validate?: () => (boolean|string|Promise<boolean|string>)}[]} options.steps
 *        content is text, a Node, an array, or a function called once when the step is first shown.
 *        `validate` runs before leaving the step forwards: false or an error text blocks it.
 * @param {() => void} [options.onFinish] called when Finish is pressed on the last step
 * @param {(index: number) => void} [options.onChange]
 * @returns {{element: HTMLElement, next: Function, back: Function, goTo: Function, getCurrent: Function}}
 */
export function generateStepper(options?: {
    parent?: string | Element;
    steps: {
        id?: string;
        title: string;
        content: any;
        validate?: () => (boolean | string | Promise<boolean | string>);
    }[];
    onFinish?: () => void;
    onChange?: (index: number) => void;
}): {
    element: HTMLElement;
    next: Function;
    back: Function;
    goTo: Function;
    getCurrent: Function;
};
