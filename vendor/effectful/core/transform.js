"use strict";

exports.__esModule = true;
exports.applyPass = applyPass;
exports.loose = exports.default = exports.consumeScope = void 0;
exports.main = main;
exports.normalizeOnlyStage1 = exports.normalizeOnlyStage0 = void 0;
exports.pass = pass;
exports.preproc = void 0;
exports.run = run;
exports.stage0 = void 0;
exports.substSym = substSym;
var _kit = require("./kit");
var Kit = _kit;
var Loops = require("./loops");
var State = require("./state");
var Control = require("./control");
var Scope = require("./scope");
var Block = require("./block");
var Bind = require("./bind");
var Prop = require("./propagate");
var Branch = require("./branch");
var Exceptions = require("./exceptions");
var Coerce = require("./coerce");
var Policy = require("./policy");
var Gens = require("./generators");
var Rt = require("./rt");
var Ops = require("./operations");
var Flat = require("./flat");
var Closure = require("./closure");
var Inline = require("./inline");
var Simplify = require("./simplify");
var _options = require("./options");
var Par = require("./par");
var Eval = require("./eval");
var path = require("path");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
const consumeScope = exports.consumeScope = _kit.consume;
const preproc = exports.preproc = Kit.pipe(Policy.stage("scope-prepare"), Kit.scope.prepare, Policy.stage("scope"), Prop.prepare, Policy.stage("policy-scope"), Policy.prepare, Policy.stage("prepare"), Gens.prepare, Scope.arrowFunToBlock, Policy.unwrapNs, Policy.assignBindCalls, Policy.assignThrowEff, Policy.stage("propagate"), Control.assignLabels, Prop.propagateEff, State.prepare, Eval.prepare, Policy.stage("after-preproc"));

/* default transform for all functions if loose mode is set */
const loose = exports.loose = (0, _options.ifLoose)(Kit.pipe(Kit.scope.prepare, Control.assignLabels, Policy.prepare, Policy.stage("prepareLoose"), Control.removeLabeledStatement, Loops.looseForOf, Control.restoreLabeledStatements, Rt.collectUsages, Kit.toArray, Simplify.blockScoping, Simplify.main, Policy.stage("finalize"), Rt.interpretLibSyms, Rt.inject));
const finalize = Kit.pipe(Policy.stage("finalize"), Closure.flattenModuleDecls, Closure.depsToTop, Scope.funcWraps, Closure.closConv, Policy.stage("meta"), Eval.injectMeta, Scope.injectMeta, Simplify.main, (0, _options.ifLoose)(Loops.looseForOf), Control.restoreLabeledStatements, Policy.stage("symbols"), Rt.interpretLibSyms, Kit.toArray, Rt.inject, Policy.stage("after-finalize"));
const normalizeOnlyStage0 = exports.normalizeOnlyStage0 = Kit.map(Kit.pipe(Control.removeLabeledStatement, Loops.toBlocks, State.saveDecls, Kit.toArray));
const normalizeOnlyStage1 = exports.normalizeOnlyStage1 = Kit.map(Kit.pipe(Branch.clean, State.restoreDecls, Closure.substContextIds, Kit.toArray));

/**
 * passes in required order depending on options specified
 */
const stage0 = exports.stage0 = Kit.pipe(Kit.map(Kit.pipe(Policy.stage("before-stage0"), Gens.functionSentPrepare, Control.injectExplicitRet, Ops.inject, Coerce.jsx, Policy.stage("normalize"), Kit.toArray, Control.removeLabeledStatement, Loops.toBlocks, Loops.whileStmt, Loops.forOfStmt, Policy.resetOpts, Loops.doWhileStmt, Prop.recalcEff, Branch.normalizeSwitch, Prop.recalcEff, Branch.addAlternate, Branch.toBlocks, Policy.stage("after-normalize"))), Loops.normalizeFor, Kit.map(Kit.pipe(Policy.stage("save-decls"), State.saveDecls, Prop.recalcEff, Coerce.lift, Policy.stage("blocks"))), Control.injectBlock, Kit.map(Kit.pipe(Policy.stage("operations"), Ops.normalizeAssign, Ops.propAccess, Policy.stage("organize"), Prop.recalcEff, Bind.flatten, Par.markRegions, Policy.stage("inject"), Exceptions.inject, Prop.recalcEff, Block.splitEffBlock, Rt.replaceGlobals, Closure.convertCalls, Eval.wrap, Ops.combine, Policy.stage("flat-convert"), Flat.convert, Policy.stage("flat-form"), Inline.jsExceptions, Eval.substVars, Policy.stage("after-stage0"))));
const stage1 = Kit.pipe(Kit.map(Kit.pipe(Policy.stage("before-stage1"), Block.cleanPureEff, Policy.stage("interpret"), Ops.interpret, Policy.stage("interpret-flat"), Flat.interpret, Policy.stage("interpret-ops-inline"), Inline.ops, Coerce.inject, Policy.stage("interpret-app"), Block.interpretApp, Coerce.interpret, Policy.stage("interpretOps"), Block.interpretCasts, Policy.stage("interpret-clean"), Branch.clean, Policy.stage("restore-decls"), State.restoreDecls, Policy.stage("decls"))), Array.from, Kit.map(Kit.pipe(Policy.stage("before-subst-sym"), substSym, Closure.substContextIds, Policy.stage("context"), Block.ctxMethods, Rt.collectUsages, Policy.stage("simplify"), Simplify.main, Policy.stage("after-stage1"), Kit.toArray, postproc)));
function postproc(sa) {
  const postproc = sa[0].value.postproc;
  if (postproc) for (const i of postproc) i();
  return sa;
}

/** replacing sym with `substSym` property if it is defined */
function* substSym(si) {
  const s = Kit.auto(si);
  for (const i of s) {
    if (i.enter && i.type === _kit.Tag.Identifier && i.value.sym) {
      if (i.value.sym.substSym) i.value.sym = i.value.sym.substSym;
    }
    yield i;
  }
}
const dryRun = Kit.pipe(Control.removeLabeledStatement, Kit.toArray);
function pass(s) {
  if (Policy.STATISTICS) performance.mark("full");
  const orig = Kit.toArray(s);
  let sa = Kit.toArray(Closure.topToIIFE(Rt.collectImports(orig)));
  const root = sa[0].value;
  let opts = root.opts || Kit.globalOpts();
  let rel;
  if (opts.file) {
    const root = opts.srcRoot === true ? opts.file.root || opts.file.cwd : opts.srcRoot;
    if (root) {
      rel = path.relative(path.dirname(opts.file.filename), root);
      if (Kit.isWindows) rel = rel.replace(/\\/g, "/");
      if (opts.detectRT && opts.detectRT.replace) opts.detectRT = opts.detectRT.replace("{ROOT}", rel);
      if (opts.importRT && opts.importRT.replace) opts.importRT = opts.importRT.replace("{ROOT}", rel);
    }
  }
  if (opts.detectRT) {
    if (!root.imports.has(opts.detectRT)) return null;
    opts.importRT = opts.detectRT;
  }
  sa = Kit.toArray(preproc(sa));
  if (!sa[0].value.$ns) return;
  const inp = Kit.toArray(Scope.splitScopes(sa));
  let scopeNum = 0;
  const len = inp.length;
  const inject = root.injectRT = new Map();
  opts = root.opts;
  if (!opts) return null;
  if (opts.importRT && (opts.detectRT === false || !root.nsImported)) inject.set(root.$ns, {
    module: opts.importRT,
    content: opts.inlineRT,
    ns: opts.importGlobal || opts.inlineRT ? null : root.$ns,
    usages: new Set()
  });
  const normalize = [];
  const transform = [];
  const others = [];
  for (const i of inp) i[0].value.track = i[0].value.track || i[0].value.topEff;
  /** even pure functions must be converted if they have shared vars */
  for (const i of inp) {
    const root = i[0].value;
    if (root.scopeDecls) {
      for (const j of root.scopeDecls) {
        if (j.interpr === Bind.ctxField) {
          root.track = true;
          if (j.refScopes) {
            for (const k of j.refScopes) {
              k.track = true;
              k.closure = true;
            }
          }
        }
      }
    }
  }
  let file = inp[len - 1];
  for (let x = 0; x < len - 1; ++x) {
    let i = inp[x];
    const {
      value
    } = i[0];
    value.scopeNum = scopeNum++;
    const f = value.opts;
    if (value.track) {
      value.injectRT = inject;
      value.$ns = root.$ns;
      if ((value.transform || f.transform) && value.topEff) transform.push(i);else normalize.push(i);
    } else others.push(i);
  }
  const hasEff = root.hasEff = transform.length !== 0;
  if (!hasEff) {
    /** no transforms, but it may need to erase some directives */
    return loose(orig);
  }
  if (root.opts.topIIFE && root.hasESM) throw new Error("`topIIFE:true` is incompatible with ES modules " + '(use "@babel/plugin-transform-modules-commonjs")');
  if (normalize.length && root.opts.closConv) throw new Error("`closConv:true` requires all functions to be transformed");
  const s0 = _toConsumableArray(stage0(transform));
  const n0 = _toConsumableArray(normalizeOnlyStage0(normalize));
  const s1 = _toConsumableArray(Closure.contextDecls(s0));
  const n1 = _toConsumableArray(Closure.contextDecls(n0));
  /** loops for ofs-requires no labeled statements */
  let l1 = others;
  if (opts.loose) {
    l1 = l1.map(dryRun);
    file = dryRun(file);
  }
  const res = [].concat(_toConsumableArray(l1), _toConsumableArray(stage1(s1)), _toConsumableArray(normalizeOnlyStage1(n1)), [file]);
  const fin = finalize(_toConsumableArray(Scope.restore(root, res)));
  if (Policy.STATISTICS) performance.measure("full", "full");
  return fin;
}

/**
 * entry point for the whole translator chain
 */
function run(s) {
  const res = pass(s);
  if (!res) return;
  (0, _kit.consume)(_kit.varScope.resolve(res));
}
function main(ast, opts = {}) {
  return Kit.optsScope(function main() {
    Kit.setOpts(opts);
    run(Kit.produce(ast));
    return ast;
  });
}
function applyPass(ast, pass, opts = {}) {
  return Kit.optsScope(function applyPass() {
    Kit.setOpts(opts);
    pass(Kit.produce(ast));
    return ast;
  });
}
var _default = exports.default = main;