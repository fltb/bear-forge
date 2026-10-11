"use strict";

exports.__esModule = true;
exports.STATISTICS = void 0;
exports.applyHoist = applyHoist;
exports.applyProfiles = void 0;
exports.applySubAndOne = applySubAndOne;
exports.assignBindCalls = assignBindCalls;
exports.assignThrowEff = assignThrowEff;
exports.callToBlockDirs = callToBlockDirs;
exports.clone = clone;
exports.injectOpts = exports.injectFuncOpts = exports.hoist = exports.directives = exports.ctImportPass = exports.ctImport = exports.configDiffPass = exports.configDiff = exports.config = void 0;
exports.merge = merge;
exports.one = void 0;
exports.postproc = postproc;
exports.preprocess = exports.prepare = void 0;
exports.preprocessPass = preprocessPass;
exports.profile = void 0;
exports.propagateBlockDirs = propagateBlockDirs;
exports.propagateConfigDiff = propagateConfigDiff;
exports.propagateOpts = propagateOpts;
exports.resetOpts = resetOpts;
exports.setFuncOpts = void 0;
exports.setQNames = setQNames;
exports.sub = exports.stage = void 0;
exports.unwrapNs = unwrapNs;
var _kit = require("./kit");
var Kit = _kit;
var Match = require("@effectful/transducers/match");
var path = require("path");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
// import {sync as resolve} from "resolve"

/** token type for signaling config object changes */
const config = exports.config = (0, _kit.symbol)("config");
/** token holding diff object of current options */

const configDiff = exports.configDiff = (0, _kit.symbol)("configDiff");
/** token for marking compile time handles applications */
const ctImport = exports.ctImport = (0, _kit.symbol)("ctImport");

/** composes function, removing duplicates */
function postproc(f) {
  return function postprocRun(s) {
    let nxt = [];
    for (let cur = s, curf = f; (curf = Kit.result(curf(cur), nxt)) != null; cur = nxt, nxt = []) {}
    return nxt;
  };
}

/** loads module `name` using commonjs `require` */
function resolveImport(name, opts, optional = false) {
  let r = opts.libs[name];
  if (r == null) {
    if (!optional) throw new Error("not implemented: resolving imports");
    /*
    try {
      const cp = resolve(name, {
        basedir: path.dirname(opts.file.filename)
      })
      r = require(/ * webpackIgnore: true * /cp)
    } catch(e) {
      if (optional) {
        if (opts.resolveTrace)
          console.log(`couldn't resolve ${name} (%{e.message}), ignoring`)
      } else {
        throw new SyntaxError(`couldn't resolve ${name} (${e.message})`)
      }
    }
    */
  }
  return r;
}

/** applies `ctImport` from the stream */
const ctImportPass = exports.ctImportPass = postproc(function* ctImportPass(s) {
  s = Kit.auto(s);
  const post = [];
  for (const i of s) {
    if (i.type === ctImport) {
      if (i.enter) {
        const r = resolveImport(i.value.name, s.opts, true /*i.value.optional*/);
        if (r != null) {
          const p = yield* r(s.opts, i.value);
          if (p != null) {
            post.push(p);
          }
        }
      }
    } else yield i;
  }
  return Kit.pipe.apply(Kit, post);
});

/**
 * Recalculates `opts` field, by propagating parent opts fields to children.
 * Following fields are propagated:
 *  - `optsDiff` - recursively merging objects
 *  - `optsAssign` - merging with `Object.assign`
 *  - `optsSet` - fully resetting former optsSet, but parent's optsDiff/optsAssign
 *                are still applied
 */
function propagateOpts(si) {
  const sa = Kit.toArray(si);
  let cur = sa[0].value.opts || Kit.getOpts();
  const stack = [];
  const assignStack = [{}];
  const mergeStack = [{}];
  for (const i of sa) {
    const {
      optsDiff: diff,
      optsAssign: assign,
      optsSet: set
    } = i.value;
    if (diff != null || assign != null || set != null) {
      if (i.enter) {
        stack.push(cur);
        if (set) cur = set;
        if (assign) assignStack.unshift(Object.assign({}, assignStack[0], assign));
        if (diff) mergeStack.unshift(merge(clone(mergeStack[0]), diff));
        if (assignStack.length > 1 || mergeStack.length > 1) {
          cur = clone(cur);
          if (assignStack.length > 1) Object.assign(cur, assignStack[0]);
          if (mergeStack.length > 1) merge(cur, mergeStack[0]);
        }
      }
      i.value.opts = cur;
      if (i.leave) {
        cur = stack.pop();
        if (assign) assignStack.shift();
        if (diff) {
          mergeStack.shift();
        }
      }
    } else i.value.opts = cur;
  }
  return sa;
}

/**
 * in case if ns is loaded using command line it replaces all corresponding
 * global variables with the name of ns
 */
function* replaceGlobalNsName(si) {
  const s = Kit.auto(si);
  const first = yield* s.till(i => i.pos === _kit.Tag.top);
  const $ns = first.value.$ns;
  if (!$ns || $ns.strict) {
    yield* s;
    return;
  }
  for (const i of s) {
    if (i.enter && i.type === _kit.Tag.Identifier && i.value.sym && !i.value.sym.declScope && i.value.node.name === $ns.name) {
      i.value.sym = $ns;
    }
    yield i;
  }
}

/** for each values without `opts` fields assigns its parent `opts` field */
function* resetOpts(s) {
  const stack = [];
  for (const i of s) {
    if (!i.value.opts) i.value.opts = stack[stack.length - 1].opts;
    if (i.enter) stack.push(i.value);
    if (i.leave) stack.pop(i.value);
    yield i;
  }
}

/** handles config `aliases` field */
function aliases(s) {
  s = Kit.auto(s);
  const aliases = s.opts.moduleAliases;
  if (!aliases) return s;
  const relAlias = aliases["."];
  return _aliases();
  function* subst(j) {
    let str = j.value.node.value;
    let alias;
    if (relAlias && str[0] === ".") {
      str = path.normalize(`${relAlias}/${str}`);
      if (Kit.isWindows) str = str.replace(/\\/g, "/");
      alias = aliases[str] || str;
    } else alias = aliases[str];
    if (!alias) {
      yield* s.copy(j);
      return;
    }
    yield s.tok(j.pos, _kit.Tag.StringLiteral, {
      node: {
        value: alias
      }
    });
    Kit.skip(s.copy(j));
  }
  function* _aliases() {
    for (const i of s) {
      if (i.enter) {
        if (i.pos === _kit.Tag.source && i.type === _kit.Tag.StringLiteral) {
          yield* subst(i);
          continue;
        }
        if (i.type === _kit.Tag.Identifier && i.pos === _kit.Tag.callee && i.value.sym && !i.value.sym.declScope && i.value.sym.name === "require") {
          yield* s.copy(i);
          yield s.peel();
          const j = s.curLev();
          if (j && j.type === _kit.Tag.StringLiteral) yield* subst(s.take());
          yield* s.sub();
          yield* s.leave();
          continue;
        }
      }
      yield i;
    }
  }
}

/**
 * detects all member expressions with the library's namespace as an object
 */
function nsProps(si) {
  const s = Kit.auto(si);
  const ns = s.first.value.$ns;
  for (const i of s) {
    if (i.enter && i.pos === _kit.Tag.callee && i.type === _kit.Tag.MemberExpression && !i.value.node.computed) {
      const obj = s.cur();
      if (obj.type === _kit.Tag.Identifier && obj.value.sym === ns) {
        Kit.skip(s.one());
        const prop = s.cur();
        if (prop.type === _kit.Tag.Identifier) i.value.nsProp = prop.value.node.name;
      }
    }
  }
}

/**
 * Convert function `blockDirFunc` into a block directive,
 * otherwise ESLint complains about unused expressions
 */
function callToBlockDirs(si) {
  const sa = Kit.toArray(si);
  const func = sa[0].value.opts.blockDirsFunc;
  if (!func) return sa;
  const s = Kit.auto(Kit.scope.prepare(si));
  nsProps(sa);
  const root = s.first.value;
  const imps = root.rtSyms.get(s.opts.blockDirsFunc);
  const impsSet = imps && new Set(imps);
  return _callToBlockDirs();
  function* _callToBlockDirs() {
    for (const i of s) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.CallExpression:
            const callee = s.cur();
            if (impsSet && callee.type === _kit.Tag.Identifier && callee.value.sym && impsSet.has(callee.value.sym) || callee.type === _kit.Tag.MemberExpression && callee.value.nsProp === func) {
              for (const j of s) if (j.pos === _kit.Tag.arguments) break;
              const param = s.cur();
              if (param.type !== _kit.Tag.StringLiteral) throw s.error(`${func} expects string a literal argument`);
              i.value.parentBlock.blockDirs.add(param.value.node.value);
              yield* Kit.reposOne(s.one(), i.pos);
              for (const j of s) if (j.value === i.value) break;
              continue;
            }
            break;
        }
      }
      yield i;
    }
  }
}

/**
 * checks imports in the input and apply compile time handlers
 * if they are available
 */
function namespaces(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  const imports = root.imports;
  const verbose = s.opts.verbose;
  if (!imports) return s;
  let imp = s.opts.importRT;
  const preset = s.opts.preset;
  const presets = new Set();
  if (s.opts.preset) {
    if (Array.isArray(s.opts.preset)) {
      presets.add.apply(presets, _toConsumableArray(s.opts.preset));
    } else if (s.opts.preset.split) {
      presets.add.apply(presets, _toConsumableArray(s.opts.preset.split(/\s*,\s*/)));
    }
  }
  const libs = s.opts.libs;
  const namespaces = root.namespaces = new Map();
  const rtSyms = root.rtSyms = new Map();
  for (const [lib, imps] of imports) {
    for (const {
      ns,
      locals
    } of imps) {
      if (ns) {
        if (libs[lib]) s.opts.importRT = imp = lib;
        namespaces.set(lib, ns.sym);
        continue;
      }
      if (locals && (lib === imp || lib === preset)) {
        for (const [local, libName] of locals) Kit.mapPush(rtSyms, libName, local.sym);
      }
    }
  }
  let $ns = root.$ns;
  if (!$ns) {
    root.skipFile = false;
    if (imp) $ns = namespaces.get(imp);
    s.first.value.nsImported = !!$ns;
    if (!$ns) {
      $ns = Kit.scope.newSym(s.opts.ns || "M");
      // suppressing scope warning
      if (!imp) $ns.num = -1;
      $ns.global = true;
    }
    root.$ns = $ns;
  }
  let cur = s;
  if (imp) {
    cur = applyLib(`${imp}-ct`, true, cur);
    cur = applyLib(`${imp}/ct`, true, cur);
  }
  for (const i of presets) cur = applyLib(i, false, cur);
  function applyLib(lib, optional, si) {
    if (verbose) console.log(`${optional ? "trying to apply" : "applying"} presets from ${lib}...`);
    const s = Kit.auto(si);
    const r = resolveImport(lib, s.opts, optional);
    if (r != null) {
      return r(s);
    } else if (verbose) {
      console.log(`no preset ${lib} found, that's probably ok`);
    }
    return s;
  }
  return cur;
}

/** marks place of profile application */
const profile = exports.profile = (0, _kit.symbol)("profile");

/**
 * applies config merge to parent's block if it has `parentBlock` scope
 */
const configDiffPass = exports.configDiffPass = Kit.pipe(propagateConfigDiff, propagateOpts);

/** marks profile change calls in the code */
const directives = exports.directives = Kit.pipe(replaceGlobalNsName, Match.inject(["*$M.profile($$)", "*$M.option($$)", "*$M.assignOption($$)"]), Kit.toArray,
//TODO: remove
function* matchNs(s) {
  s = Kit.auto(s);
  // skipping first profiles
  const first = yield* s.till(i => i.pos === _kit.Tag.top);
  const {
    $ns
  } = first.value;
  for (const i of s) {
    yield i;
    if (i.enter) {
      if (i.type === Match.Placeholder && i.value.v.match) {
        if (i.value.name === "M") {
          yield* s.till(j => j.type !== Match.Placeholder);
          const j = s.cur();
          if (j.type === _kit.Tag.Identifier && j.value.sym && j.value.sym === $ns) continue;
          i.value.v.match = false;
        }
      }
    }
  }
}, Match.commit, function* lookupProfiles(s) {
  s = Kit.auto(s);
  function getConst() {
    const i = s.peel();
    switch (i.type) {
      case _kit.Tag.BooleanLiteral:
      case _kit.Tag.NumericLiteral:
      case _kit.Tag.StringLiteral:
        Kit.skip(s.leave());
        return i.value.node.value;
      case _kit.Tag.NullLiteral:
        Kit.skip(s.leave());
        return i.value.node.value;
      case _kit.Tag.RegExpLiteral:
        Kit.skip(s.leave());
        return new RegExp(i.value.node.pattern, i.value.node.flags);
      case _kit.Tag.ArrayExpression:
        const arr = [];
        Kit.skip(s.peelTo(_kit.Tag.elements));
        while (s.curLev()) arr.push(getConst());
        Kit.skip(s.leave());
        Kit.skip(s.leave());
        return arr;
      case _kit.Tag.ObjectExpression:
        const res = {};
        Kit.skip(s.peelTo(_kit.Tag.properties));
        for (const j of s.sub()) {
          s.peel(j);
          switch (j.type) {
            case _kit.Tag.ObjectProperty:
              const k = s.cur();
              (0, _kit.invariant)(k.pos === _kit.Tag.key);
              if (k.type !== _kit.Tag.Identifier) throw s.error("not supported object key");
              Kit.skip(s.copy());
              res[k.value.node.name] = getConst();
              break;
            default:
              throw s.error("not supported object construct");
          }
          Kit.skip(s.leave());
        }
        Kit.skip(s.leave());
        Kit.skip(s.leave());
        return res;
      default:
        throw s.error("not supported static expression");
    }
  }
  for (const i of s.sub()) {
    switch (i.type) {
      case Match.Root:
        if (i.enter) {
          // TODO: this now works only for single NS :(
          if (i.value.index === 0) {
            Kit.skip(s.till(j => j.enter && j.type === Match.Placeholder));
            const j = s.cur();
            Kit.skip(s.till(j => j.enter && j.type === Match.Placeholder));
            const k = s.cur();
            if (k.type !== _kit.Tag.StringLiteral) throw s.error("only string literals are supported");
            Kit.skip(s.till(j => j.leave && j.type === Match.Root));
            const name = k.value.node.value;
            yield s.tok(profile, {
              ns: j.value.node.name,
              node: {
                name
              }
            });
          } else {
            Kit.skip(s.till(j => j.enter && j.type === Match.Placeholder));
            Kit.skip(s.till(j => j.enter && j.type === Match.Placeholder));
            yield s.tok(i.pos, configDiff, {
              node: getConst(),
              alg: i.value.index === 1 ? "merge" : "assign"
            });
            Kit.skip(s.till(j => j.leave && j.type === Match.Root));
          }
        }
        break;
      case Match.Placeholder:
        continue;
      default:
        yield i;
    }
  }
}, Match.clean);

/** invokes profile handlers */
const applyProfiles = exports.applyProfiles = postproc(function* applyProfiles(s) {
  s = Kit.auto(s);
  const post = [];
  for (const i of s) {
    if (i.type === profile) {
      if (i.enter) {
        const run = i.value.run || s.opts.profiles[i.value.node.name];
        if (run == null) {
          throw s.error(`profile ${i.value.node.name} is not defined, available:[${Object.keys(s.opts.profiles)}]`);
        }
        const p = yield* run.call(i.value);
        if (p != null) post.push(p);
      }
      continue;
    }
    yield i;
  }
  return Kit.pipe.apply(Kit, post);
});

/**
 * injects resulting items of `i.value.node` generator, passing it
 * `ExtIterator::sub` as an argument
 */
const sub = exports.sub = (0, _kit.symbol)("sub");

/**
 * injects resulting items of `i.value.node` generator, passing it
 * `ExtIterator::one` as an argument
 */
const one = exports.one = (0, _kit.symbol)("one");

/**
 * handles `sub` tokens and `one` tokens
 */
function applySubAndOne(s) {
  function* _applySubAndOne(si) {
    const sa = Kit.toArray(si);
    if (!sa.length) return;
    s = Kit.auto(sa);
    for (const i of s) {
      if (i.enter) {
        switch (i.type) {
          case sub:
            (0, _kit.invariant)(i.leave);
            yield* _applySubAndOne(i.value.run(s.sub()));
            continue;
          case one:
            (0, _kit.invariant)(i.leave);
            yield* _applySubAndOne(i.value.run(s.one()));
            continue;
        }
      }
      yield i;
    }
  }
  return _applySubAndOne(s);
}

/**
 * moves content of to specified destination
 * now only function scope works
 */
const hoist = exports.hoist = (0, _kit.symbol)("hoist");

/**
 * interpret hoist tokens
 * TODO: move to @effectful/transducers
 */
function applyHoist(si) {
  const s = Kit.auto(si);
  function* scope() {
    const buf = [];
    const nxt = _toConsumableArray(_applyHoist(buf));
    yield* buf;
    yield* nxt;
  }
  function* _applyHoist(funScope) {
    for (const i of s.sub()) {
      if (i.type === hoist) {
        if (i.enter) {
          const buf = _toConsumableArray(_applyHoist(funScope));
          funScope.push.apply(funScope, _toConsumableArray(buf));
        }
      } else if (i.enter && i.value.func) {
        yield i;
        yield* scope();
      } else yield i;
    }
  }
  return scope();
}

/**
 * specifies transform function
 */
const preprocess = exports.preprocess = (0, _kit.symbol)("preprocess");
const MAX_PREPROCESS_COUNT = 10;

/**
 * applies transform from `preprocess` token `node` field to
 * the whole token stream, repeats process until no more `preprocess`
 * tokens emitted
 */
function preprocessPass(s) {
  let num = 0;
  function* _preprocessPass(s) {
    if (++num > MAX_PREPROCESS_COUNT) throw new Error("too many transforms");
    s = Kit.share(s);
    for (const i of s) {
      if (i.type === preprocess) {
        yield* s;
        return i.value;
      }
      yield i;
    }
    return null;
  }
  for (let i = s, j = [], next;; i = next.node(j), j = []) {
    next = Kit.result(_preprocessPass(i), j);
    if (next === null) return j;
  }
}

/** calculates qualified names for each expression if it is applicable */
function setQNames(si) {
  const s = Kit.auto(si);
  function* getQName(ids) {
    const i = s.cur();
    switch (i.type) {
      case _kit.Tag.Identifier:
        ids.push(i.value.node.name);
        yield* s.copy();
        break;
      case _kit.Tag.MemberExpression:
        const cur = i.value.qname = [];
        yield s.peel();
        yield* getQName(cur);
        yield* getQName(cur);
        yield* s.leave();
        ids.push.apply(ids, cur);
        break;
      default:
        ids.push("*");
        yield* _setQNames(s.one());
    }
  }
  function* _setQNames(sw, cnst) {
    for (const i of sw) {
      yield i;
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.FunctionDeclaration:
          case _kit.Tag.FunctionExpression:
          case _kit.Tag.ObjectMethod:
          case _kit.Tag.ClassMethod:
          case _kit.Tag.ClassPrivateMethod:
            const id = s.curLev();
            if (id && id.type === _kit.Tag.Identifier) i.value.scopeName = id.value.node.name;
            break;
          case _kit.Tag.VariableDeclaration:
            yield* _setQNames(s.sub(), i.value.node.kind === "const");
            break;
          case _kit.Tag.CallExpression:
            yield* getQName(i.value.qname = []);
            break;
          case _kit.Tag.VariableDeclarator:
          case _kit.Tag.AssignmentExpression:
            const cqn = [];
            yield* getQName(cqn);
            const j = s.curLev();
            if (j != null) {
              j.lqname = cqn;
              yield* _setQNames(s.one());
            }
            if (i.type === _kit.Tag.VariableDeclarator && cnst) {
              const j = s.curLev();
              if (!j) break;
              switch (j.type) {
                case _kit.Tag.FunctionExpression:
                case _kit.Tag.ArrowFunctionExpression:
                  j.value.scopeName = cqn[0];
              }
            }
            break;
        }
      }
    }
  }
  return _setQNames(s);
}

/** marks `throw` statement to be handled by monadic library rather than js */
function* assignThrowEff(s) {
  for (const i of s) {
    if (i.enter && i.type === _kit.Tag.ThrowStatement && i.value.opts.transform && i.value.opts.jsExceptions === false) i.value.bind = true;
    yield i;
  }
}

/**
 * marks call expressions to be effectful if they match some patter
 * from `bindCalls` option
 */
function assignBindCalls(s) {
  s = Kit.auto(s);
  if (!s.opts.bindCalls) return s;
  return _assignBindCalls();
  function* _assignBindCalls() {
    const {
      $ns
    } = s.first.value;
    for (const i of s) {
      if (i.type === _kit.Tag.CallExpression && s.opts.transform && i.value.bind == null) {
        const prof = s.opts.bindCalls;
        if (prof) {
          const q = i.value.qname;
          if (q != null) {
            let v = null;
            if (v == null && prof.byQName != null) v = prof.byQName[q.join(".")];
            if (v == null && prof.byId != null) v = prof.byId[q[q.length - 1]];
            if (v == null && prof.byNs != null && q.length > 1) v = prof.byNs[q[0]];
            if (v == null && prof.libNs && q.length === 2 && q[0] === $ns.orig) v = prof.libNs[q[1]];
            if (v == null) v = prof.all;
            if (v != null) i.value.bind = v;
          }
        }
      }
      yield i;
    }
  }
}

/**
 * object merging algorithm for options merge,
 * like Object.assign but recursively merges all plain object fields
 * arrays are concatenated rather than merged
 * properties with names starting with "$" are copied by reference
 */

function merge(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Array.isArray(a)) return a.concat(b);else if (a && typeof a === "object") {
    for (const i in b) {
      if (i[0] === "$") a[i] = b[i];else if (i in a) {
        a[i] = merge(a[i], b[i]);
      } else a[i] = b[i];
    }
    return a;
  }
  return b;
}
function clone(obj) {
  return merge({}, obj);
}

/**
 * moves `configDiff` tokens into `optsDiff` property for each sub-token on
 * the same level
 */
function* propagateConfigDiff(s) {
  const stack = [];
  let cur = {
    level: 0,
    merge: null,
    assign: null
  };
  let level = 0;
  for (const i of s) {
    if (i.type === configDiff) {
      if (i.enter) {
        if (cur.level < level) {
          stack.push(cur);
          cur = {
            level,
            merge: null,
            assign: null
          };
        }
        if (i.value.alg === "assign") cur.assign = Object.assign(cur.assign || {}, i.value.node);else cur.merge = merge(cur.merge || {}, i.value.node);
      }
      continue;
    }
    if (i.enter) {
      if (cur.level === level) {
        if (cur.merge) {
          i.value.optsDiff = Object.assign(i.value.optsDiff || {}, cur.merge, i.value.optsDiff);
        }
        if (cur.assign) i.value.optsAssign = Object.assign(i.value.optsAssign || {}, cur.assign, i.value.optsAssign);
      }
      level++;
    }
    if (i.leave) {
      if (cur.level === level) {
        cur = stack.pop();
      }
      level--;
    }
    yield i;
  }
}

/** combines a few preparation passes */
const prepare = exports.prepare = Kit.pipe(aliases, namespaces, callToBlockDirs, function (si) {
  const sa = Kit.toArray(si);
  let s = Kit.auto(sa);
  const {
    configure,
    preproc
  } = s.opts;
  if (configure || preproc) s = Kit.auto(preprocConfig(s));
  if (configure) {
    configure(s);
    s = Kit.auto(propagateOpts(sa));
  }
  if (preproc) return propagateOpts(preproc(Kit.auto(sa)));
  return s;
  function preprocConfig(s) {
    s = Kit.scope.assignBody(s);
    s = setQNames(s);
    return Kit.toArray(s);
  }
}, propagateBlockDirs);

/** for `ns` function application marks inner expression to be effectful */
function unwrapNs(si) {
  const s = Kit.auto(si);
  if (!s.opts.bindCalls) return s;
  const {
    $ns
  } = s.first.value;
  function* _unwrapNs() {
    for (const i of s.sub()) {
      if (i.enter) {
        if (i.type === _kit.Tag.CallExpression) {
          const j = s.cur();
          if (j.type === _kit.Tag.Identifier && j.value.sym === $ns) {
            const def = s.opts.bindCalls;
            if (def != null && def.ns) {
              const lab = s.label();
              s.peel(i);
              Kit.skip(s.peelTo(_kit.Tag.arguments));
              s.cur().value.bind = true;
              yield* Kit.reposOne(_unwrapNs(), i.pos);
              Kit.skip(lab());
              continue;
            }
          }
        }
      }
      yield i;
    }
  }
  return _unwrapNs();
}

/** sets options `opts` to each function root tag */
const setFuncOpts = exports.setFuncOpts = function setFuncOpts(opts) {
  const generator = opts.generator;
  const async = opts.async;
  return function* setFuncOpts(s) {
    for (const i of s) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ClassMethod:
          case _kit.Tag.ObjectMethod:
            if (i.value.node.kind !== "method") {
              i.value.optsAssign = {
                transform: null
              };
              break;
            }
          case _kit.Tag.ArrowFunctionExpression:
          case _kit.Tag.FunctionExpression:
          case _kit.Tag.FunctionDeclaration:
            if ((generator == null || generator === !!i.value.node.generator) && (async == null || async === !!i.value.node.async)) i.value.optsAssign = Object.assign(i.value.optsAssign || {}, opts);
            break;
        }
      }
      yield i;
    }
  };
};

/**
 * Converts JS block directives into profiles call
 */
function propagateBlockDirs(si) {
  const s = Kit.auto(si);
  const {
    blockDirectives
  } = s.opts;
  if (!blockDirectives) return s;
  let any = false;
  const r = Kit.toArray(_propagateBlockDirs());
  return any ? propagateOpts(r) : r;
  function* _propagateBlockDirs(value) {
    function dir(i, name) {
      const descr = blockDirectives[name];
      if (descr) {
        any = true;
        value.optsAssign = Object.assign(value.optsAssign || {}, descr);
        Kit.skip(s.copy(i));
        return true;
      }
      return false;
    }
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.BlockStatement:
          case _kit.Tag.Program:
            yield i;
            yield* _propagateBlockDirs(i.value);
            continue;
          /** babel parser recognizes directives only for progs and funct block*/
          case _kit.Tag.ExpressionStatement:
            if (s.cur().type === _kit.Tag.StringLiteral) {
              if (dir(i, s.cur().value.node.value)) continue;
            }
            break;
          case _kit.Tag.Directive:
            if (dir(i, i.value.node.value.value)) continue;
            break;
        }
      }
      yield i;
    }
  }
}

/**
 * posts option diff to the stream,
 * so all the next in the scope options are updated with
 * `x => Object.assign(x, opts)`
 */
const injectOpts = opts => function* injectOpts() {
  yield Kit.tok(configDiff, {
    node: opts,
    alg: "assign"
  });
};

/** sets options to each sub-function */
exports.injectOpts = injectOpts;
const injectFuncOpts = (opts, withSelf = false) => {
  const run = setFuncOpts(opts);
  return function* injectFuncOpts() {
    if (withSelf) {
      const value = {
        dst: "func"
      };
      yield Kit.enter(hoist, value);
      yield Kit.tok(one, {
        run
      });
      yield Kit.leave(hoist, value);
      return Kit.pipe(applyHoist, applySubAndOne);
    }
    yield Kit.tok(sub, {
      run
    });
    return applySubAndOne;
  };
};
exports.injectFuncOpts = injectFuncOpts;
const STATISTICS = exports.STATISTICS = typeof window !== "undefined" && window.chrome || typeof performance !== "undefined" && process.env.EFFECTFUL_STAT;

/** Marks and assign a name to set of passes */
const stage = exports.stage = STATISTICS ? Kit.curry(function (name, si) {
  let s = Kit.auto(Kit.toArray(si));
  const first = s.first.value;
  const origStage = first.savedMeasure;
  if (name.startsWith("after-")) {
    first.savedMeasure = null;
  } else {
    performance.mark(name);
    first.savedMeasure = name;
  }
  if (origStage) performance.measure(
  // `${origStage}:${first.funcId ? first.funcId.orig : "*"}`,
  origStage, origStage);
  return hooks(s, name);
}) : Kit.curry(function (name, si) {
  let s = Kit.auto(Kit.toArray(si));
  return hooks(s, name);
});
function hooks(s, nextStage) {
  const origStage = s.first.value.savedStageName;
  if (origStage && s.opts.after) {
    let hook = s.opts.after[origStage];
    if (hook) s = Kit.auto(hook(s));
  }
  s.first.value.savedStageName = nextStage;
  if (s.opts.before) {
    const hook = s.opts.before[nextStage];
    if (hook != null) s = hook(s);
  }
  return s;
}