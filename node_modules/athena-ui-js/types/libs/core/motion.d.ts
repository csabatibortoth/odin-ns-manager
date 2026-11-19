/** Does the person want less motion? The choice made with setMotion wins over the setting of the system. */
export function prefersReducedMotion(): boolean;
/**
 * Chooses how much motion there is: "system", "reduce" (none) or "full". It is put on <html> as data-motion, which the CSS tokens read (the durations
 * become 0), and the functions of this module read it too.
 */
export function setMotion(value: any): boolean;
/** Called with { preference, reduced } when setMotion changes it, and when the system setting changes. Returns a function that stops it. */
export function onMotionChange(listener: any): () => boolean;
/** A duration token as milliseconds: readDuration("--athena-duration-base") -> 200. 0 under reduced motion. */
export function readDuration(token?: string, element?: HTMLElement): number;
/** How long an element takes to finish its CSS transitions, delays included, in ms (0 when it has none, or under reduced motion). */
export function transitionTime(element: any): number;
/** Removes an element when its exit transition is over (at once when it has none, which is also what reduced motion gives). */
export function removeAfterTransition(element: any): void;
/**
 * A spring as a CSS easing: simulates a damped spring and returns the points as a `linear()` easing (which can overshoot) and how long it takes.
 * `element.animate(keyframes, { duration, easing })` then moves like a spring. Settles when it stays within `precision` of 1.
 *
 * @param {{stiffness?: number, damping?: number, mass?: number, precision?: number}} [options]
 * @returns {{easing: string, duration: number}} duration in ms
 */
export function spring({ stiffness, damping, mass, precision }?: {
    stiffness?: number;
    damping?: number;
    mass?: number;
    precision?: number;
}): {
    easing: string;
    duration: number;
};
/**
 * Animates an element with the Web Animations API and resolves when it is over. Under reduced motion it does nothing and resolves at once.
 * It resolves (never rejects) when the animation is cancelled, and `null` when there was none.
 *
 * @param {Element} element
 * @param {Keyframe[]|PropertyIndexedKeyframes} keyframes e.g. [{ opacity: 0 }, { opacity: 1 }]
 * @param {object} [options] the options of element.animate (duration, easing, delay, fill, ...), and
 * @param {boolean} [options.commit=false] write the end state to the element's style when it is over (CSSOM: allowed by a strict policy)
 * @param {AbortSignal} [options.signal] cancels the animation when aborted
 * @returns {Promise<Animation|null>}
 */
export function animate(element: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: {
    commit?: boolean;
    signal?: AbortSignal;
}): Promise<Animation | null>;
/** Fades an element out and removes it. Under reduced motion it is removed at once. */
export function fadeOut(element: any, options: any): Promise<void>;
/**
 * A change that is done with CSS (a class, an attribute) and has a CSS transition: runs `change()` and resolves when the element's transition is over.
 * It waits at most the length of the transition (plus a little), so a transition that never ends does not hang anything.
 */
export function transition(element: any, change: any): Promise<any>;
/** Runs the functions one after the other, each when the one before is over. Resolves with their results. */
export function sequence(steps: any): Promise<any[]>;
/**
 * The delays of a staggered animation: `count` items, `step` ms apart, starting from "start", "end" or "center".
 * @returns {number[]}
 */
export function staggerDelays(count: any, step?: number, from?: string): number[];
/**
 * Calls `run(item, index, delay)` for every item with its delay, and resolves when all are over: `stagger(rows, (row, i, delay) => fadeIn(row, { delay }))`.
 * No more than `limit` items are staggered (the rest run with the last delay), so a long list does not take long.
 */
export function stagger(items: any, run: any, { step, from, limit }?: {
    step?: number;
    from?: string;
    limit?: number;
}): Promise<any[]>;
/**
 * Lets the children of a container move smoothly when `change()` rearranges them (sorting, filtering, inserting, removing): First (measure), Last (do the change,
 * measure), Invert and Play (each child that moved starts at its old place and slides to the new one). New children fade in. Under reduced motion `change()` is
 * just done.
 *
 * @param {Element} container its children are what moves
 * @param {() => void} change rearranges the children (synchronously)
 * @param {object} [options]
 * @param {(element: Element) => *} [options.key] what makes a child "the same" before and after, default: the element itself
 * @param {number} [options.limit=60] at most this many children are animated (a long list does not need it, and costs time)
 * @param {number} [options.duration] ms, default the token --athena-duration-base
 * @returns {Promise<void>} resolves when the animations are over
 */
export function flip(container: Element, change: () => void, { key, limit, duration }?: {
    key?: (element: Element) => any;
    limit?: number;
    duration?: number;
}): Promise<void>;
/**
 * Changes numbers over time with requestAnimationFrame: tween({ from: 0, to: 100, duration: 500, easing: easings.easeOutCubic, onUpdate: v => ... }).
 * `from` and `to` can be numbers, or objects with the same keys ({ x: 0, y: 0 } to { x: 10, y: 5 }); onUpdate then gets an object.
 * Under reduced motion it jumps to the end (one onUpdate call). It runs on animation frames; in a page that is not drawn a timer keeps it going slowly, so it still ends.
 *
 * @returns {Promise<void> & {cancel: () => void}} resolves when it is over (also when cancelled)
 */
export function tween({ from, to, duration, easing, onUpdate, delay }?: {
    from?: number;
    to?: number;
    duration?: number;
    easing?: (t: any) => number;
    delay?: number;
}): Promise<void> & {
    cancel: () => void;
};
/**
 * Runs `update()` (which changes the DOM) as a view transition when the browser can and motion is wanted: the old and the new state cross-fade
 * (or whatever the CSS ::view-transition-* rules say). Elements with a `view-transition-name` move from one place to the other. Without the API,
 * or under reduced motion, `update()` is just run. Resolves when it is over.
 */
export function viewTransition(update: any): Promise<void>;
export function getMotion(): "reduce" | "full" | "system";
export namespace easings {
    function linear(t: any): any;
    function easeInQuad(t: any): number;
    function easeOutQuad(t: any): number;
    function easeInOutQuad(t: any): number;
    function easeInCubic(t: any): number;
    function easeOutCubic(t: any): number;
    function easeInOutCubic(t: any): number;
    function easeOutBack(t: any): number;
    function easeOutElastic(t: any): any;
}
export function fadeIn(element: any, options: any): Promise<Animation>;
export function parallel(steps: any): Promise<any[]>;
