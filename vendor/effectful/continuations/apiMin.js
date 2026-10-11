"use strict";

exports.__esModule = true;
var _exportNames = {
  forInIterator: true,
  mcall: true,
  moduleExports: true,
  unwrapImport: true,
  native: true,
  context: true,
  journal: true
};
exports.mcall = exports.forInIterator = void 0;
exports.moduleExports = moduleExports;
exports.unwrapImport = unwrapImport;
var _engine = require("./engine");
exports.mcall = _engine.__effectful_mcall;
Object.keys(_engine).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _engine[key]) return;
  exports[key] = _engine[key];
});
var _async = require("./async");
Object.keys(_async).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _async[key]) return;
  exports[key] = _async[key];
});
var _state = require("./state");
exports.native = _state.native;
exports.context = _state.context;
exports.journal = _state.journal;
exports.forInIterator = _state.forInIterator;
var _config = require("./config");
function moduleExports() {
  const mod = (0, _engine.compileModule)();
  if (!mod) return;
  const topMeta = mod.topLevel;
  const cjs = mod.cjs;
  if (_config.default.verbose) _state.native.console.log(`DEBUGGER: exporting pure module "${cjs.id}", fullPath:"${mod.fullPath}", name:"${mod.name}"`);
  _state.context.moduleId = null;
  const func = topMeta.func(null);
  func();
}
function unwrapImport(v) {
  return v;
}