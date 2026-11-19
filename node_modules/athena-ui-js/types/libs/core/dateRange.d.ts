/**
 * Internal: two native date inputs (from / to). The "to" picker starts at the chosen start date.
 * Values are ISO dates ("2026-01-31"), an empty date is "".
 */
export function createDateRange(options?: {}): {
    element: HTMLElement;
    inputs: HTMLElement[];
    getValue: () => {
        from: any;
        to: any;
    };
    setValue: (value: any) => void;
    validate: () => any;
};
/** A Date as the value of a datetime-local input, in the local time of the person: "2026-11-19T10:30". */
export function toLocalInput(date: any, seconds?: boolean): string;
/** The value of a datetime-local input as a Date (local time), or null when it is empty or not valid. */
export function fromLocalInput(value: any): Date;
/**
 * Internal: two datetime-local inputs and a list of presets (last 15 minutes, hour, 24 hours, 7 days). Choosing a preset fills
 * both inputs; changing an input switches the preset to "Custom". A preset is remembered as a preset: getRange() works out
 * "now" when it is called, so a screen that refreshes asks again and gets the moving window.
 *
 * @param {object} options
 * @param {string} [options.id]
 * @param {string} [options.from] initial start (datetime-local value)
 * @param {string} [options.to] initial end
 * @param {string} [options.preset] id of the preset to start with
 * @param {object[]} [options.presets] default DEFAULT_RANGE_PRESETS; { id, label | labelKey, minutes }
 * @param {boolean} [options.seconds=false] the inputs ask for seconds too
 * @param {string} [options.min]
 * @param {string} [options.max]
 * @param {boolean} [options.disabled]
 * @param {(value: {from: string, to: string, preset: string}) => void} [options.onChange]
 */
export function createDateTimeRange(options?: {
    id?: string;
    from?: string;
    to?: string;
    preset?: string;
    presets?: object[];
    seconds?: boolean;
    min?: string;
    max?: string;
    disabled?: boolean;
    onChange?: (value: {
        from: string;
        to: string;
        preset: string;
    }) => void;
}): {
    element: HTMLElement;
    inputs: HTMLElement[];
    getValue: () => {
        from: any;
        to: any;
        preset: string;
    };
    setValue: (value: any) => void;
    /** The range as Dates: a preset is measured from now (when this is called), a custom range is what the inputs hold. */
    getRange(): {
        from: Date;
        to: Date;
    };
    validate: () => any;
};
/** The presets of generateDateTimeRange: a name, and how far back from now they reach. */
export const DEFAULT_RANGE_PRESETS: {
    id: string;
    labelKey: string;
    minutes: number;
}[];
