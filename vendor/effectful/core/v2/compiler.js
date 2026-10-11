"use strict";

exports.__esModule = true;
exports.babelPlugin = babelPlugin;
exports.defaultConfig = void 0;
exports.run = run;
var _config = require("./config");
var context = require("./context");
var CFG = require("./cfg");
var Kit = require("./kit");
var Scope = require("./scope");
var Optimization = require("./optimization");
var Emit = require("./emit");
var Meta = require("./meta");
var Operations = require("./operations");
var path = require("path");
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
const defaultConfig = exports.defaultConfig = _objectSpread({}, _config.default);
const helpers = {
  context,
  CFG,
  Kit,
  Scope,
  Optimization,
  Emit,
  Meta,
  Operations
};
const rescopeVisitor = {
  Identifier() {}
};
function run(transform, state) {
  state.file.scope.path.traverse(rescopeVisitor);
  const {
    babel
  } = _config.default;
  const path = state.file.path;
  _config.default.babelFile = state.file;
  const ast = state.file.ast;
  let ret;
  if (_config.default.debug) {
    ret = transform(ast, helpers);
  } else {
    try {
      ret = transform(state.file.ast, helpers);
    } catch (e) {
      if (e instanceof SyntaxError) throw e;
      if (_config.default.verbose) console.log(e);
      throw state.file.buildCodeFrameError(e.esNode || ast, e.message);
    }
  }
  babel.traverse.cache.clearScope();
  babel.traverse.clearNode(path.node);
  /** I don't know why but this prevents crashes in babel sometimes */
  state.file.scope.path.traverse(rescopeVisitor);
  return ret;
}
function fileOpts(state) {
  const file = state.file;
  if (file) {
    const opts = file.opts;
    let root = _config.default.srcRoot;
    if (!root || !root.substr) root = _config.default.srcRoot = opts.root || opts.cwd || ".";
    root = path.resolve(root);
    _config.default.filename = opts.filename || "file.js";
    let rel = path.relative(root, _config.default.filename);
    if (Kit.isWindows) rel = rel.replace(/\\/g, "/");
    _config.default.relativeName = rel;
  } else {
    _config.default.srcRoot = ".";
    _config.default.relativeName = _config.default.filename = "file.js";
  }
}

/** returns babel's plugin definition suitable for assigning to `module.exports` */
function babelPlugin(transform, mainConfig = {}) {
  const res = function effectfulPlugin(babel, args) {
    return {
      name: _config.default.pluginName || transform.name || "effectful",
      manipulateOptions(_opts, parserOpts) {
        var _parserOpts$plugins;
        if (_config.default.syntaxPlugins) (_parserOpts$plugins = parserOpts.plugins).push.apply(_parserOpts$plugins, _toConsumableArray(_config.default.syntaxPlugins));
      },
      visitor: {
        Program(_path, state) {
          Object.assign(_config.default, defaultConfig, mainConfig, args, {
            babel
          });
          fileOpts(state);
          run(transform, state);
        }
      }
    };
  };
  res.macro = () => babelMacro(transform, mainConfig);
  res.run = function (ast, opts) {
    Object.assign(_config.default, opts);
    transform(ast, helpers);
    return ast;
  };
  res.config = mainConfig => babelPlugin(transform, mainConfig);
  return res;
}

/**
 * returns "babel-plugin-macros" default export for given transform,
 * it transforms the result of `babelPreset` into a function suitable
 * for supplying to "babel-plugin-macros" `createMacro` call
 */
function babelMacro(transform, mainConfig = {}) {
  const configName = transform.name;
  return createMacro(function effectfulMacro({
    references,
    state,
    source,
    babel,
    config: args
  }) {
    Object.assign(_config.default, mainConfig, args, {
      babel,
      macroReferences: references
    });
    fileOpts(state);
    _config.default.macroSource = source;
    run(transform, state);
  }, {
    configName
  });
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