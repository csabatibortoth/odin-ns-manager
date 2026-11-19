//motion for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Animations and transitions. The rule for everything here: motion is an enhancement. It is off when the person prefers reduced motion (the system setting,
// or setMotion("reduce")), nothing waits for an animation before it works (every function resolves at once under reduced motion), and nothing needs an inline
// style: CSS classes, custom properties, and the Web Animations API, which a strict Content-Security-Policy allows.

/* ------------------THE PREFERENCE------------------- */

const listeners = new Set();

// The choice lives on <html> as data-motion ("reduce" or "full"), where the CSS tokens read it too. No attribute: follow the system.
const chosen = () => {
    const value = globalThis.document?.documentElement.dataset.motion;
    return value === "reduce" || value === "full" ? value : "system";
};

/** Does the person want less motion? The choice made with setMotion wins over the setting of the system. */
export function prefersReducedMotion() {
    const preference = chosen();
    if (preference === "reduce") return true;
    if (preference === "full") return false;
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** "system" (follow the setting of the system), "reduce" or "full". */
export const getMotion = chosen;

/**
 * Chooses how much motion there is: "system", "reduce" (none) or "full". It is put on <html> as data-motion, which the CSS tokens read (the durations
 * become 0), and the functions of this module read it too.
 */
export function setMotion(value) {
    if (!["system", "reduce", "full"].includes(value)) return false;
    const root = globalThis.document?.documentElement;
    if (root) {
        if (value === "system") delete root.dataset.motion;
        else root.dataset.motion = value;
    }
    listeners.forEach(listener => listener({ preference: value, reduced: prefersReducedMotion() }));
    return true;
}

/** Called with { preference, reduced } when setMotion changes it, and when the system setting changes. Returns a function that stops it. */
export function onMotionChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => {
    if (chosen() === "system") listeners.forEach(listener => listener({ preference: "system", reduced: prefersReducedMotion() }));
});

/* ------------------TOKENS------------------- */

/** A duration token as milliseconds: readDuration("--athena-duration-base") -> 200. 0 under reduced motion. */
export function readDuration(token = "--athena-duration-base", element = globalThis.document?.documentElement) {
    if (!element) return 0;
    const value = getComputedStyle(element).getPropertyValue(token).trim();
    return toMs(value);
}

const toMs = text => {
    const match = /^(-?[\d.]+)(ms|s)$/.exec(String(text).trim());
    return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : 0;
};

/** How long an element takes to finish its CSS transitions, delays included, in ms (0 when it has none, or under reduced motion). */
export function transitionTime(element) {
    const style = getComputedStyle(element);
    const durations = style.transitionDuration.split(",").map(toMs);
    const delays = style.transitionDelay.split(",").map(toMs);
    return Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] ?? 0)));
}

/** Removes an element when its exit transition is over (at once when it has none, which is also what reduced motion gives). */
export function removeAfterTransition(element) {
    const time = element.isConnected ? transitionTime(element) : 0;
    if (time <= 0) element.remove();
    else setTimeout(() => element.remove(), time + 30);
}

/* ------------------EASINGS------------------- */

/** Easing functions for numbers: f(t) with t from 0 to 1, for tweens. (CSS has its own, see the --athena-ease-* tokens.) */
export const easings = {
    linear: t => t,
    easeInQuad: t => t * t,
    easeOutQuad: t => 1 - (1 - t) * (1 - t),
    easeInOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
    easeInCubic: t => t ** 3,
    easeOutCubic: t => 1 - (1 - t) ** 3,
    easeInOutCubic: t => (t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2),
    easeOutBack: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    easeOutElastic: t => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1)
};

/**
 * A spring as a CSS easing: simulates a damped spring and returns the points as a `linear()` easing (which can overshoot) and how long it takes.
 * `element.animate(keyframes, { duration, easing })` then moves like a spring. Settles when it stays within `precision` of 1.
 *
 * @param {{stiffness?: number, damping?: number, mass?: number, precision?: number}} [options]
 * @returns {{easing: string, duration: number}} duration in ms
 */
export function spring({ stiffness = 170, damping = 15, mass = 1, precision = 0.002 } = {}) {
    const step = 1 / 120;
    let position = 0;
    let velocity = 0;
    const points = [0];
    let settled = 0;
    let time = 0;
    while (time < 10 && settled < 12) {
        const force = -stiffness * (position - 1) - damping * velocity;
        velocity += (force / mass) * step;
        position += velocity * step;
        time += step;
        points.push(position);
        settled = Math.abs(position - 1) < precision && Math.abs(velocity) < precision * 10 ? settled + 1 : 0;
    }
    points[points.length - 1] = 1;
    // About 40 points are enough for the eye
    const every = Math.max(1, Math.floor(points.length / 40));
    const sampled = points.filter((_, index) => index % every === 0 || index === points.length - 1).map(value => +value.toFixed(4));
    return { easing: `linear(${sampled.join(", ")})`, duration: Math.round(time * 1000) };
}

/* ------------------ANIMATE------------------- */

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
export async function animate(element, keyframes, options = {}) {
    if (prefersReducedMotion() || typeof element?.animate !== "function") return null;
    const { commit = false, signal, ...timing } = options;
    const animation = element.animate(keyframes, {
        duration: readDuration("--athena-duration-base"),
        easing: getComputedStyle(globalThis.document.documentElement).getPropertyValue("--athena-ease-standard").trim() || "ease",
        fill: "backwards",
        ...timing
    });
    signal?.addEventListener("abort", () => animation.cancel(), { once: true });
    // A page that is not drawn (a hidden tab) gets no frames, so its animations would never finish: a timer finishes it, a moment after it should be over
    const length = (typeof timing.duration === "number" ? timing.duration : readDuration("--athena-duration-base")) * (timing.iterations ?? 1) + (timing.delay ?? 0) + (timing.endDelay ?? 0);
    const timer = Number.isFinite(length) ? setTimeout(() => { if (animation.playState === "running") animation.finish(); }, length + 100) : 0;
    try {
        await animation.finished;
        clearTimeout(timer);
        if (commit) {
            animation.commitStyles();
            animation.cancel();
        }
    } catch {
        return animation;       // cancelled: not an error
    }
    return animation;
}

/** Fades an element in. */
export const fadeIn = (element, options) => animate(element, [{ opacity: 0 }, { opacity: 1 }], options);

/** Fades an element out and removes it. Under reduced motion it is removed at once. */
export async function fadeOut(element, options) {
    await animate(element, [{ opacity: 1 }, { opacity: 0 }], { fill: "forwards", ...options });
    element.remove();
}

/**
 * A change that is done with CSS (a class, an attribute) and has a CSS transition: runs `change()` and resolves when the element's transition is over.
 * It waits at most the length of the transition (plus a little), so a transition that never ends does not hang anything.
 */
export function transition(element, change) {
    return new Promise(resolve => {
        change();
        // The styles of the change are computed in the next frame
        requestAnimationFrame(() => {
            const time = transitionTime(element);
            if (time <= 0) return resolve();
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                element.removeEventListener("transitionend", onEnd);
                resolve();
            };
            const onEnd = event => { if (event.target === element) finish(); };
            element.addEventListener("transitionend", onEnd);
            setTimeout(finish, time + 50);
        });
    });
}

/* ------------------SEVERAL AT ONCE OR ONE AFTER THE OTHER------------------- */

/** Runs the functions one after the other, each when the one before is over. Resolves with their results. */
export async function sequence(steps) {
    const results = [];
    for (const step of steps) results.push(await (typeof step === "function" ? step() : step));
    return results;
}

/** Runs the functions (or promises) together. Resolves with their results. */
export const parallel = steps => Promise.all(steps.map(step => (typeof step === "function" ? step() : step)));

/**
 * The delays of a staggered animation: `count` items, `step` ms apart, starting from "start", "end" or "center".
 * @returns {number[]}
 */
export function staggerDelays(count, step = 40, from = "start") {
    return Array.from({ length: count }, (_, index) => {
        const distance = from === "end" ? count - 1 - index : from === "center" ? Math.abs(index - (count - 1) / 2) : index;
        return Math.round(distance * step);
    });
}

/**
 * Calls `run(item, index, delay)` for every item with its delay, and resolves when all are over: `stagger(rows, (row, i, delay) => fadeIn(row, { delay }))`.
 * No more than `limit` items are staggered (the rest run with the last delay), so a long list does not take long.
 */
export function stagger(items, run, { step = 40, from = "start", limit = 30 } = {}) {
    const list = [...items];
    const delays = staggerDelays(Math.min(list.length, limit), step, from);
    return Promise.all(list.map((item, index) => run(item, index, delays[Math.min(index, delays.length - 1)] ?? 0)));
}

/* ------------------LISTS: FLIP------------------- */

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
export async function flip(container, change, { key = element => element, limit = 60, duration } = {}) {
    if (prefersReducedMotion()) {
        change();
        return;
    }
    const first = new Map();
    for (const child of [...container.children].slice(0, limit)) first.set(key(child), child.getBoundingClientRect());
    change();
    const animations = [];
    for (const child of [...container.children].slice(0, limit)) {
        const before = first.get(key(child));
        const after = child.getBoundingClientRect();
        if (!before) {
            animations.push(animate(child, [{ opacity: 0 }, { opacity: 1 }], { duration }));
            continue;
        }
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        animations.push(animate(child, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration, easing: "cubic-bezier(0.2, 0, 0, 1)" }));
    }
    await Promise.all(animations);
}

/* ------------------TWEENS (for games and anything that is not CSS)------------------- */

/**
 * Changes numbers over time with requestAnimationFrame: tween({ from: 0, to: 100, duration: 500, easing: easings.easeOutCubic, onUpdate: v => ... }).
 * `from` and `to` can be numbers, or objects with the same keys ({ x: 0, y: 0 } to { x: 10, y: 5 }); onUpdate then gets an object.
 * Under reduced motion it jumps to the end (one onUpdate call). It runs on animation frames; in a page that is not drawn a timer keeps it going slowly, so it still ends.
 *
 * @returns {Promise<void> & {cancel: () => void}} resolves when it is over (also when cancelled)
 */
export function tween({ from = 0, to = 1, duration = 300, easing = easings.easeOutCubic, onUpdate, delay = 0 } = {}) {
    let cancelled = false;
    let frame = 0;
    const value = progress => (typeof from === "number"
        ? from + (to - from) * progress
        : Object.fromEntries(Object.keys(from).map(name => [name, from[name] + (to[name] - from[name]) * progress])));
    const promise = new Promise(resolve => {
        if (prefersReducedMotion() || duration <= 0) {
            onUpdate?.(value(1));
            resolve();
            return;
        }
        let start = null;
        let timer = 0;
        // The frame clock is the clock; the timer next to it keeps a tween going (more slowly) in a page that is not drawn, so it still ends
        const schedule = () => {
            frame = requestAnimationFrame(tick);
            timer = setTimeout(tick, 100);
        };
        const tick = () => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
            if (cancelled) return resolve();
            const now = performance.now();
            start ??= now + delay;
            const t = Math.min(Math.max((now - start) / duration, 0), 1);
            if (now >= start) onUpdate?.(value(easing(t)));
            if (t >= 1) return resolve();
            schedule();
        };
        schedule();
    });
    return Object.assign(promise, { cancel() { cancelled = true; cancelAnimationFrame(frame); } });
}

/* ------------------PAGES------------------- */

/**
 * Runs `update()` (which changes the DOM) as a view transition when the browser can and motion is wanted: the old and the new state cross-fade
 * (or whatever the CSS ::view-transition-* rules say). Elements with a `view-transition-name` move from one place to the other. Without the API,
 * or under reduced motion, `update()` is just run. Resolves when it is over.
 */
export async function viewTransition(update) {
    if (prefersReducedMotion() || typeof globalThis.document?.startViewTransition !== "function") {
        await update();
        return;
    }
    let failure = null;
    let started = false;
    let done = false;
    const run = async () => {
        if (started) return;
        started = true;
        try {
            await update();
        } catch (error) {
            failure = error;
        }
        done = true;
    };
    const transition = document.startViewTransition(run);
    // A page that is not drawn (a hidden tab) never calls the update of a view transition: after a moment it is run here, so the page does not stay as it was
    const guard = setTimeout(run, 400);
    const later = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        await Promise.race([transition.updateCallbackDone, later(2000)]);
        // the animation needs frames: do not wait for it longer than it can last
        await Promise.race([transition.finished, later(readDuration("--athena-duration-slow") + 1000)]);
    } catch {
        // skipped (for example the page was hidden): the update was run all the same
    }
    clearTimeout(guard);
    await run();
    while (!done) await later(10);
    if (failure) throw failure;
}
