export declare function nodeListIter<T>(nl: {
    length: number;
    [index: number]: T;
}): Iterable<T>;
/** stores event handlers in EventTarget */
export declare const eventsSym: unique symbol;
export type EventsMap = Map<string, Map<EventListenerOrEventListenerObject, (AddEventListenerOptions[] | undefined)[]>>;
declare global {
    interface EventTarget {
        [eventsSym]: EventsMap;
    }
}
export declare function getEventsMap(target: EventTarget): EventsMap;
export declare function cleanupEvents(et: EventTarget): void;
declare global {
    interface EventListenerOptions {
        once?: boolean;
    }
}
/** `EventTarget#addEventListener` wrapper which keeps the listener's reference */
export declare function addEventListener(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
/** `EventTarget#removeEventListener` wrapper which keeps the listener's reference */
export declare function removeEventListener(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
/**
 * monkey patching `addEventListener`/`removeEventListener`
 * to keep reference to event listeners
 */
export declare function trackEvents(ev: EventTarget): void;
/** monkey patching global `document` to make it serializable */
export declare function trackGlobalDocument(): void;
/**
 * Monkey patching platform objects to make them serializable,
 * run it as soon as possible if a global serialization is needed
 */
export declare function track(_withEvents?: boolean): void;
