"use strict";

exports.__esModule = true;
exports.default = void 0;
var Kit = require("../kit");
var Policy = require("../policy");
var _options = require("../options");
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
const disabledOpts = {
  transform: false
};
const generatorOps = {
  YieldExpression: true,
  AwaitExpression: true
};
const postproc = Kit.pipe(Policy.setFuncOpts(disabledOpts), Policy.setQNames, Policy.configDiffPass, Policy.applyProfiles, (0, _options.ifDirectives)(Kit.pipe(Policy.directives, Policy.configDiffPass, Policy.applyProfiles, Policy.configDiffPass)), Policy.propagateBlockDirs, Policy.propagateOpts);
var _default = exports.default = Kit.pipe(function* init(si) {
  const s = Kit.auto(si);
  const defaults = _objectSpread({}, s.opts.effectful);
  const disabled = Policy.injectFuncOpts(disabledOpts);
  const generators = Policy.injectFuncOpts(Object.assign({
    generator: true,
    async: false,
    esRebind: true,
    static: true,
    transform: true,
    ops: generatorOps,
    coerce: false,
    scopePrefix: true,
    bindName: "yldStar",
    requireFinalPure: true,
    pureForOf: true,
    keepLastPure: true
  }, defaults));
  const asyncDo = Policy.injectFuncOpts(Object.assign({
    generator: false,
    async: true,
    bindCalls: {},
    esRebind: true,
    ops: generatorOps,
    coerce: false,
    static: true,
    transform: true,
    scopePrefix: true,
    combineOps: true,
    bindName: "chain",
    requireFinalPure: false,
    pureForOf: true,
    keepLastPure: true
  }, defaults));
  const asyncGeneratorsDo = Policy.injectFuncOpts(Object.assign({
    generator: true,
    async: true,
    bindCalls: {},
    esRebind: true,
    ops: generatorOps,
    coerce: false,
    transform: true,
    scopePrefix: true,
    combineOps: true,
    bindName: "chain",
    requireFinalPure: false,
    pureForOf: true,
    keepLastPure: true
  }, defaults));
  const fullOpts = Object.assign({
    bindCalls: {
      byNs: {
        console: false,
        process: false,
        pack: false
      },
      all: true,
      ns: true
    },
    generator: false,
    async: false,
    coerce: true,
    transform: true
  }, defaults);
  const minOpts = Object.assign({
    bindCalls: {
      ns: true,
      libNs: {
        reflect: true
      }
    },
    coerce: true,
    generator: false,
    transform: true
  }, defaults);
  yield Kit.tok(Policy.configDiff, {
    node: {
      profiles: {
        disabled,
        full: Kit.pipe(Policy.injectOpts(fullOpts), Policy.injectFuncOpts(fullOpts)),
        defaultFull: Policy.injectFuncOpts(fullOpts),
        minimal: Kit.pipe(Policy.injectOpts(minOpts), Policy.injectFuncOpts(minOpts)),
        defaultMinimal: Policy.injectFuncOpts(minOpts),
        generators,
        asyncDo,
        asyncGeneratorsDo,
        es: function* () {
          yield* disabled();
          yield* generators();
          yield* asyncGeneratorsDo();
          yield* asyncDo();
          return Kit.pipe(Policy.applySubAndOne, Policy.configDiffPass);
        }
      }
    }
  });
  let {
    profile
  } = s.opts;
  if (profile != null) {
    if (!Array.isArray(profile)) profile = [profile];
    for (const i of profile) yield Kit.tok(Policy.profile, {
      node: {
        name: i
      }
    });
  }
  yield* s;
}, postproc);