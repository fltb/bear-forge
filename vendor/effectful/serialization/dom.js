"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsSym = void 0;
exports.nodeListIter = nodeListIter;
exports.getEventsMap = getEventsMap;
exports.cleanupEvents = cleanupEvents;
exports.addEventListener = addEventListener;
exports.removeEventListener = removeEventListener;
exports.trackEvents = trackEvents;
exports.trackGlobalDocument = trackGlobalDocument;
exports.track = track;
const S = __importStar(require("./main"));
const LocMap = Map;
const LocWeakMap = WeakMap;
const defineProperty = Object.defineProperty;
function nodeListIter(nl) {
    return {
        [Symbol.iterator]() {
            let i = 0;
            return {
                next() {
                    return i < nl.length
                        ? { done: false, value: nl[i++] }
                        : { done: true, value: undefined };
                }
            };
        }
    };
}
/** stores event handlers in EventTarget */
exports.eventsSym = Symbol.for("@effectful/debugger/events");
function getEventsMap(target) {
    return target[exports.eventsSym];
}
const overrideProps = { [S.descriptorSymbol]: false };
function restoreEvents(et, map) {
    cleanupEvents(et);
    for (const [type, byType] of map)
        for (const [listener, byListener] of byType)
            for (const byCapture of byListener)
                if (byCapture)
                    for (const options of byCapture)
                        et.addEventListener(type, listener, options);
    et[exports.eventsSym] = map;
}
function cleanupEvents(et) {
    const map = et[exports.eventsSym];
    if (!map)
        return;
    for (const [type, byType] of et[exports.eventsSym])
        for (const [listener, byListener] of byType)
            for (const byCapture of byListener)
                if (byCapture)
                    for (const options of byCapture)
                        et.removeEventListener(type, listener, options);
}
const ETp = typeof EventTarget !== "undefined" && EventTarget.prototype;
const savedAddEventListener = ETp && ETp.addEventListener;
const savedRemoveEventListener = ETp && ETp.removeEventListener;
function wrapOnceHandleEvent(event) {
    if (event.currentTarget)
        removeEventListenerInfo(event.currentTarget, this.type, this.inner, this.capture);
}
S.regOpaqueObject(wrapOnceHandleEvent, "S#wrapOnceHandleEvent");
const onceHandlers = new LocWeakMap();
/** `EventTarget#addEventListener` wrapper which keeps the listener's reference */
function addEventListener(type, listener, options) {
    const self = this || globalThis;
    if (typeof options === "boolean") {
        options = { capture: options };
    }
    else if (!options)
        options = {};
    const once = options.once;
    if (savedAddEventListener) {
        savedAddEventListener.call(self, type, listener, options);
        if (once || type === "load") {
            let onceHandler = onceHandlers.get(listener);
            if (!onceHandler) {
                onceHandlers.set(listener, (onceHandler = {
                    type,
                    inner: listener,
                    capture: options.capture || false,
                    handleEvent: wrapOnceHandleEvent
                }));
            }
            savedAddEventListener.call(self, type, onceHandler, {
                once: true,
                capture: options.capture
            });
        }
    }
    const byType = self[exports.eventsSym] || (self[exports.eventsSym] = new LocMap());
    let byListener = byType.get(type);
    if (!byListener)
        byType.set(type, (byListener = new LocMap()));
    let byCapture = byListener.get(listener);
    if (!byCapture) {
        byCapture = [void 0, void 0];
        byListener.set(listener, byCapture);
    }
    const captIndex = Number(options.capture || false);
    const list = byCapture[captIndex] || (byCapture[captIndex] = []);
    list.push(options);
}
function removeEventListenerInfo(self, type, listener, options) {
    if (typeof options === "boolean") {
        options = { capture: options };
    }
    else if (!options)
        options = {};
    const byType = self[exports.eventsSym];
    if (!byType)
        return;
    const byListener = byType.get(type);
    if (!byListener)
        return;
    const byCapture = byListener.get(listener);
    if (!byCapture)
        return;
    const index = Number(options.capture || false);
    const list = byCapture[index];
    if (!list)
        return;
    if (options.once && list.some(i => !i.once))
        return;
    byCapture[index] = void 0;
    if (!byCapture.some(Boolean))
        byListener.delete(listener);
}
/** `EventTarget#removeEventListener` wrapper which keeps the listener's reference */
function removeEventListener(type, listener, options) {
    const self = this || globalThis;
    if (savedRemoveEventListener)
        savedRemoveEventListener.call(self, type, listener, options);
    removeEventListenerInfo(self, type, listener, options);
}
/**
 * monkey patching `addEventListener`/`removeEventListener`
 * to keep reference to event listeners
 */
function trackEvents(ev) {
    ev.addEventListener = addEventListener;
    ev.removeEventListener = removeEventListener;
}
/** monkey patching global `document` to make it serializable */
function trackGlobalDocument() {
    if (typeof document === "undefined")
        return;
    // ignoring jsdom props (not needed if jsdom is transpiled too)
    const el = document.createElement("div");
    el.addEventListener("test-event", function () { });
    el.innerHTML = `<div id="root"><p>hello, world!</p></div>`;
    const _children = el.children;
    const _attrs = el.attributes;
    for (const i of Object.getOwnPropertySymbols(el))
        overrideProps[i] = false;
    for (const i of Object.getOwnPropertySymbols(document))
        overrideProps[i] = false;
    S.getState().byObject.set(document, S.regDescriptor({
        name: "global#document",
        write(ctx, value) {
            const json = {};
            json.el = ctx.step(document.documentElement, json, "el");
            const events = value[exports.eventsSym];
            if (events)
                json.ev = ctx.step(events, json, "ev");
            return json;
        },
        create() {
            return document;
        },
        readContent(ctx, json, value) {
            value.replaceChild(ctx.step(json.el), value.documentElement);
            if (json.ev)
                restoreEvents(value, ctx.step(json.ev));
        },
        overrideProps: Object.assign(Object.assign({}, overrideProps), { location: false, [exports.eventsSym]: false })
    }));
    if (typeof NodeList !== "undefined") {
        S.regConstructor(NodeList, { name: "dom#NodeList", overrideProps });
    }
    if (typeof EventTarget !== "undefined") {
        S.regConstructor(NodeList, { name: "dom#EventTarget", overrideProps });
    }
    if (typeof Element !== "undefined") {
        S.regConstructor(Element, {
            name: "dom#Element",
            write(ctx, value, _parent, _key) {
                const json = { tag: value.tagName };
                const nodes = (json.c = []);
                for (const i of nodeListIter(value.childNodes))
                    nodes.push(ctx.step(i, nodes, nodes.length));
                const attrs = (json.a = {});
                for (const i of nodeListIter(value.attributes))
                    attrs[i.name] = i.value;
                const events = value[exports.eventsSym];
                if (events)
                    json.ev = ctx.step(events, json, "ev");
                return json;
            },
            create(_, json) {
                return document.createElement(json.tag);
            },
            readContent(ctx, json, value) {
                const obj = json;
                for (const i of obj.c)
                    value.appendChild(ctx.step(i));
                for (const n in obj.a)
                    value.setAttribute(n, obj.a[n]);
                if (obj.ev)
                    restoreEvents(value, ctx.step(obj.ev));
            },
            overrideProps: Object.assign(Object.assign({}, overrideProps), { [exports.eventsSym]: false })
        }, true);
    }
    if (typeof Event !== "undefined")
        defineProperty(Event.prototype, S.descriptorSymbol, {
            value: S.regDescriptor({
                name: "dom#Event",
                create(ctx, json) {
                    const EventConstructor = ctx.step(json.c);
                    const jsonInit = json.init;
                    const init = {};
                    for (const i of Object.keys(jsonInit)) {
                        const prop = jsonInit[i];
                        if (prop && typeof prop === "object")
                            init[i] = ctx.step(prop);
                        else
                            init[i] = prop;
                    }
                    return new EventConstructor(init.type, init);
                },
                write(ctx, value) {
                    const res = {};
                    res.c = ctx.step(value.constructor, res, "c");
                    const descrs = {};
                    for (let i = value; i && i !== Object.prototype; i = Object.getPrototypeOf(i))
                        Object.assign(descrs, Object.getOwnPropertyDescriptors(i), descrs);
                    const init = (res.init = {});
                    for (const name in descrs) {
                        if (!descrs[name].get)
                            continue;
                        const prop = value[name];
                        if (prop)
                            init[name] = ctx.step(prop, init, name);
                    }
                    return res;
                },
                readContent() { },
                props: false
            }),
            configurable: true
        });
    if (typeof Text !== "undefined")
        S.regConstructor(Text, {
            name: "dom#Text",
            write(_, value) {
                return { text: value.data };
            },
            create(_, json) {
                return document.createTextNode(json.text);
            },
            overrideProps
        });
    if (typeof ProcessingInstruction !== "undefined")
        S.regConstructor(ProcessingInstruction, {
            name: "dom#PI",
            write(_, value) {
                return { target: value.target, data: value.data };
            },
            create(_, json) {
                return document.createProcessingInstruction(json.target, json.data);
            },
            overrideProps
        });
    if (typeof Comment !== "undefined")
        S.regConstructor(Comment, {
            name: "dom#Comment",
            write(_, value) {
                return { text: value.data };
            },
            create(_, json) {
                return document.createTextNode(json.text);
            },
            overrideProps
        });
    if (typeof CSSStyleDeclaration !== "undefined")
        S.regConstructor(CSSStyleDeclaration, {
            name: "dom#CSSStyleDeclaration",
            write(_, value) {
                return { text: value.cssText };
            },
            create(_, json) {
                const dummy = document.createElement("div");
                dummy.style.cssText = json.text;
                return dummy.style;
            },
            overrideProps
        });
    if (globalThis.CSS2Properties)
        S.regConstructor(globalThis.CSS2Properties, {
            name: "dom#CSS2Properties",
            write(_, value) {
                return { text: value.cssText };
            },
            create(_, json) {
                const dummy = document.createElement("div");
                dummy.style.cssText = json.text;
                return dummy.style;
            },
            overrideProps
        });
    if (typeof Document !== "undefined")
        S.regConstructor(Document, {
            name: "dom#Document",
            write(_, value) {
                const s = new XMLSerializer();
                return {
                    text: s.serializeToString(value),
                    type: value.contentType
                };
            },
            create(_, json) {
                return new DOMParser().parseFromString(json.text, json.type);
            },
            readContent(ctx, json, value) {
                value.replaceChild(ctx.step(json.el), value.documentElement);
            },
            overrideProps
        }, true);
    if (typeof InputDeviceCapabilities !== "undefined") {
        S.regConstructor(InputDeviceCapabilities, {
            name: "dom#InputDeviceCapabilities",
            write(_ctx, value) {
                return { fireTouchEvents: value.fireTouchEvents };
            },
            create(_ctx, json) {
                // TODO: don't care about object model for now
                return new InputDeviceCapabilities({
                    fireTouchEvents: json.fireTouchEvents
                });
            },
            props: false
        });
    }
    if (typeof MutationRecord !== "undefined")
        S.regConstructor(MutationRecord, {
            name: "dom#MutationRecord",
            write(ctx, value) {
                const res = {};
                res.ty = ctx.step(value.type, res, "ty");
                res.el = ctx.step(value.target, res, "el");
                if (value.addedNodes)
                    res.an = ctx.step([...nodeListIter(value.addedNodes)], res, "an");
                if (value.removedNodes)
                    res.rn = ctx.step([...nodeListIter(value.removedNodes)], res, "rn");
                if (value.previousSibling)
                    res.ps = ctx.step(value.previousSibling, res, "ps");
                if (value.nextSibling)
                    res.ns = ctx.step(value.nextSibling, res, "ns");
                if (value.attributeName)
                    res.tn = ctx.step(value.attributeName, res, "tn");
                if (value.attributeNamespace)
                    res.ts = ctx.step(value.attributeNamespace, res, "ts");
                if (value.oldValue)
                    res.ov = ctx.step(value.oldValue, res, "ov");
                return res;
            },
            create() {
                // TODO: don't care about object model for now
                return {};
            },
            readContent(ctx, json, value) {
                const j = json;
                const v = value;
                v.type = ctx.step(j.ty);
                v.target = ctx.step(j.el);
                v.addedNodes = ctx.step(j.an);
                v.removedNodes = ctx.step(j.rn);
                v.previousSibling = ctx.step(j.ps);
                v.nextSibling = ctx.step(j.ns);
                v.attributeName = ctx.step(j.tn);
                v.attributeNamespace = ctx.step(j.ts);
                v.oldValue = ctx.step(j.ov);
            },
            props: false
        });
    if (typeof MutationObserver !== "undefined")
        S.regConstructor(MutationObserver, {
            name: "dom#MutationObserver",
            overrideProps
        });
}
/**
 * Monkey patching platform objects to make them serializable,
 * run it as soon as possible if a global serialization is needed
 */
function track(_withEvents) {
    if (typeof EventTarget !== "undefined")
        trackEvents(EventTarget.prototype);
    trackGlobalDocument();
    S.regGlobal();
}
