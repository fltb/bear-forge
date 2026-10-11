"use strict";

exports.__esModule = true;
exports.Transform = exports.Tag = exports.RT = exports.Policy = exports.Kit = exports.Ctrl = exports.Block = void 0;
exports.babelPlugin = babelPlugin;
exports.babelPreset = babelPreset;
exports.defaultTransform = exports.config = void 0;
exports.makePlugin = makePlugin;
exports.run = void 0;
var _config = require("./config");
var Kit = require("./kit");
exports.Kit = Kit;
var T = require("./transform");
exports.Transform = T;
var Policy = require("./policy");
exports.Policy = Policy;
var RT = require("./rt");
exports.RT = RT;
var Block = require("./block");
exports.Block = Block;
var Bind = require("./bind");
var Ctrl = require("./control");
exports.Ctrl = Ctrl;
var _defunct = require("./presets/defunct");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
const config = exports.config = _config.default;
const Tag = exports.Tag = Kit.Tag;
const helpers = {
  Tag,
  Kit,
  Policy,
  Transform: T,
  RT,
  Ctrl,
  Block,
  Bind,
  presets: {
    defunct: _defunct.default
  }
};
const rescopeVisitor = {
  Identifier() {}
};
function makePlugin(transform, initOpts) {
  return function effectfulPlugin(babel, opts) {
    const descr = transform(_objectSpread(_objectSpread(_objectSpread({}, initOpts), opts), {}, {
      babel
    }), helpers);
    return {
      name: descr.name || "effectful",
      manipulateOptions(mopts, parserOpts) {
        var _parserOpts$plugins;
        if (descr.syntaxPlugins) (_parserOpts$plugins = parserOpts.plugins).push.apply(_parserOpts$plugins, _toConsumableArray(descr.syntaxPlugins));
      },
      visitor: {
        Program(path, state) {
          state.file.scope.path.traverse(rescopeVisitor);
          Kit.optsScope(function effectfulPreset() {
            Kit.setOpts(_objectSpread(_objectSpread({}, _config.default), descr.options));
            Kit.babelBridge(Kit.pipe(Kit.prepare, getHandler(descr)), path, state);
          });
          babel.traverse.cache.clearScope();
          babel.traverse.clearNode(path.node);
          state.file.scope.path.traverse(rescopeVisitor);
        }
      }
    };
  };
}
function babelPlugin(transform) {
  const res = makePlugin(transform, transform.opts);
  res.options = opts => {
    const res = babelPlugin(iopts => transform(_objectSpread(_objectSpread({}, opts), iopts), helpers));
    res.opts = opts;
    return res;
  };
  res.rebind = map => babelPlugin(opts => map(opts, transform));
  res.modify = map => babelPlugin(opts => transform(map(opts), helpers));
  res.transform = transform;
  res.macro = () => babelMacro(res);
  res.run = (ast, opts) => run(ast, transform(_objectSpread(_objectSpread({}, transform.opts), opts), helpers));
  return res;
}

/**
 * convers transform description into babel preset
 *
 *  transform: (opts: Config, helpers:{Tag,Policy,Kit,Transform,RT})
 *     => { syntaxPlugins: string[],
 *          options: Config,
 *          main: (t: Tokens) => void }
 */
function babelPreset(transform) {
  const res = function (b, ropts) {
    return {
      plugins: [makePlugin(transform, Object.assign({}, transform.opts, ropts))]
    };
  };
  res.options = opts => {
    const res = babelPreset(iopts => transform(Object.assign({}, opts, iopts), helpers));
    res.opts = opts;
    return res;
  };
  res.rebind = map => babelPreset(opts => map(opts, transform));
  res.modify = map => babelPreset(opts => transform(map(opts), helpers));
  res.transform = transform;
  res.macro = babelMacro(res);
  return res;
}
function getHandler(opts) {
  return opts.main ? opts.main : T.run;
}

/** copied from "babel-plugin-macros" to remove it as a dependency */
function createMacro(macro, options = {}) {
  if (options.configName === "options") {
    throw new Error(`You cannot use the configName "options". It is reserved for babel-plugin-macros.`);
  }
  macroWrapper.isBabelMacro = true;
  macroWrapper.options = options;
  return macroWrapper;
  function macroWrapper(args) {
    const {
      source,
      isBabelMacrosCall
    } = args;
    if (!isBabelMacrosCall) {
      throw new Error(`The macro you imported from "${source}" is being executed outside the context of compilation with babel-plugin-macros. ` + `This indicates that you don't have the babel plugin "babel-plugin-macros" configured correctly. ` + `Please see the documentation for how to configure babel-plugin-macros properly: ` + "https://github.com/kentcdodds/babel-plugin-macros/blob/master/other/docs/user.md");
    }
    return macro(args);
  }
}

/**
 * returns "babel-plugin-macros" default export for given transform,
 * it transforms the result of `babelPreset` into a function suitable
 * for supplying to "babel-plugin-macros" `createMacro` call
 */
function babelMacro(plugin) {
  // const {createMacro} = require("babel-plugin-macros")
  const popts = plugin.opts || {};
  const configName = plugin.name;
  return createMacro(function effectfulMacro({
    references,
    state,
    babel,
    config
  }) {
    let opts = _objectSpread(_objectSpread({}, config), popts);
    if (references.default && references.default.length) opts.preprocNS = references.default[0].node.name;
    opts = plugin.transform(opts, helpers);
    const path = state.file.path;
    Kit.optsScope(function effectfulMacroRun() {
      const eopts = opts.options;
      if (eopts.macroAdapt !== false) {
        if (eopts.detectRT) {
          if (!eopts.importRT) eopts.importRT = eopts.detectRT;
          eopts.detectRT = null;
        }
        if (eopts.preprocNS) eopts.ns = eopts.preprocNS;
      }
      Kit.setOpts(_objectSpread(_objectSpread(_objectSpread({}, opts), _config.default), eopts));
      Kit.babelBridge(Kit.pipe(Kit.prepare, getHandler(opts)), path, state);
      babel.traverse.cache.clearScope();
      babel.traverse.clearNode(path.node);
      /** I don't know why but this prevents crashes in babel sometimes */
      state.file.scope.path.traverse(rescopeVisitor);
    });
  }, {
    configName
  });
}

/** applies transform description to `ast` from babylon */
const run = (ast, descr) => T.applyPass(ast, getHandler(descr), _objectSpread(_objectSpread(_objectSpread({}, descr), _config.default), descr.options));

/** default always transforming transform with `options: Config` */
exports.run = run;
const defaultTransform = options => ({
  syntaxPlugins: [],
  options: Object.assign({}, _config.default, options),
  main: T.run
});
exports.defaultTransform = defaultTransform;