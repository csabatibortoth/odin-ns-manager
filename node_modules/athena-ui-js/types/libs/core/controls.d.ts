/** Builds the control described by `options` without appending it. Returns the element, or null (an error is reported). */
export function buildControl(options: any): any;
/**
 * Registers a new input type. `factory(options)` returns the element to append.
 * Addons use this to plug in their controls, see registerHungarianInputControls.
 */
export function registerControl(inputType: any, factory: any): void;
/**
 * Builds a control from `{ inputType, id, class, name, value, items, onclick, onchange, ... }` and appends it to the element given as
 * `parent` (an id or an element; without one, to the body).
 *
 * @returns {HTMLElement|undefined} the control, or undefined when the input type is not known
 */
export function generateControl(options?: {}): HTMLElement | undefined;
/**
 * The HTMLControlGenerator of the standalone project (0.4.1), so code written for it keeps working.
 * `HTMLControlGenerator(options)` builds the control and appends it to the element with the id `options.parent`
 * (an unknown id appends it, in a div, to the body). It is also a global once Athena UI is loaded.
 */
export function HTMLControlGenerator(options: any): void;
export namespace HTMLControlGenerator {
    /**
     * Builds the control without appending it and returns the element (the standalone project returned a jQuery object: wrap it yourself with
     * `$(HTMLControlGenerator.create(options))` if you still need one). Undefined when the options are not valid.
     */
    export function create(options: any): any;
    export { registerControl as register };
}
