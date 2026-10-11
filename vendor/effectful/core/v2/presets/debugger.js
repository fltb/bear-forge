"use strict";

exports.__esModule = true;
exports.default = effectful;
var _config = require("../config");
var Kit = require("../kit");
var Scope = require("../scope");
var Operations = require("../operations");
var Optimization = require("../optimization");
var CFG = require("../cfg");
var Emit = require("../emit");
var Meta = require("../meta");
var Eval = require("../eval");
function effectful(ast) {
  if (_config.default.loopsSubScopes === "default") _config.default.loopsSubScopes = _config.default.timeTravel ? "always" : "closure";
  _config.default.reuseTempVars = !_config.default.timeTravel;
  _config.default.expInjectTempSetters = false;
  _config.default.debug = true;
  if (_config.default.rt === "default") _config.default.rt = "@effectful/debugger";
  if (Kit.hasDirective(ast.program, "no-debug") || Kit.hasDirective(ast.program, "no-ctrl")) return;
  const root = Kit.produce(ast);
  Scope.prepare(root);
  Eval.replaceEvalDir();
  if (!_config.default.blackbox) Meta.injectBrk();
  Scope.split();
  Operations.normalizeAssign();
  if (_config.default.implictCalls && _config.default.timeTravel) Operations.implicitCalls();
  CFG.build();
  if (_config.default.timeTravel) {
    Operations.setters();
    Operations.deleters();
    if (_config.default.inlineImplicitOps) Operations.implicitCallsInlined();
  }
  Optimization.prepare();
  if (!_config.default.expInlineCalls) Operations.methodCalls();
  Operations.assignCall();
  Scope.forEach(Optimization.composeItems);
  Scope.forEach(CFG.prepare);
  Scope.forEach(Optimization.assignBindVar);
  Scope.injectVarGetters();
  Scope.forEach(Emit.calcFrames);
  Scope.forEach(Optimization.sortFrames);
  Scope.forEach(Meta.all);
  if (_config.default.timeTravel) Operations.replaceSymNames();
  Emit.module();
  Kit.consume(root);
}