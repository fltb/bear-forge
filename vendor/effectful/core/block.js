"use strict";

exports.__esModule = true;
exports.app = exports.alreadyRunningSym = void 0;
exports.applyIgnoreResult = applyIgnoreResult;
exports.chainId = exports.chain = exports.bindPat = exports.argSym = void 0;
exports.cleanPureEff = cleanPureEff;
exports.cleanup = cleanup;
exports.ctxMethods = ctxMethods;
exports.frame = exports.effExpr = exports.delegateSym = void 0;
exports.interpretApp = interpretApp;
exports.interpretCasts = void 0;
exports.isEffFree = isEffFree;
exports.splitEffBlock = exports.sharedRef = exports.pure = exports.op = exports.letStmt = void 0;
var _kit = require("./kit");
var Kit = _kit;
var Prop = require("./propagate");
var Policy = require("./policy");
/**
 * saves result of operation with an effect
 * (JS or monadic) into a temporal variable
 */
const letStmt = exports.letStmt = (0, _kit.symbol)("letStmt");
/** a block of code with at most 1 monadic effect */
const frame = exports.frame = (0, _kit.symbol)("frame");
/** sequence of `frame`s */
const chain = exports.chain = (0, _kit.symbol)("chain");
/** reference to `letStmt` */
const bindPat = exports.bindPat = (0, _kit.symbol)("bindPat");
/** marks effectful expression, not requiring coercion */
const effExpr = exports.effExpr = (0, _kit.symbol)("effExpr");
/** a chain of applications to some library operation */
const app = exports.app = (0, _kit.symbol)("app");
/** marks an expression which shouldn't be bound */
const pure = exports.pure = (0, _kit.symbol)("pure");
/** marks an expression to share in JS using some temporal variable */
const sharedRef = exports.sharedRef = (0, _kit.symbol)("sharedRef");
/** effectful operation */
const op = exports.op = (0, _kit.symbol)("op");
const chainId = exports.chainId = Kit.sysId("chain");
const alreadyRunningSym = exports.alreadyRunningSym = Kit.sysId("$alreadyRunning");
const delegateSym = exports.delegateSym = Kit.sysId("$delegate");

/** in frameArgs binds inner content of the jump tag */
const argSym = exports.argSym = Kit.scope.newSym("arg");

/**
 * Replaces binary `app` nodes with its first component member function call
 * with `name`, passing second component as a function to its argument
 */
function interpretApp(s) {
  const sl = Kit.auto(s);
  function* walk(sw) {
    for (const i of sw) {
      if (i.enter) {
        if (i.type === app) {
          const lab = sl.label();
          yield sl.enter(i.pos, effExpr, i.value);
          yield sl.enter(_kit.Tag.expression, _kit.Tag.CallExpression);
          if (i.value.static !== false) {
            yield sl.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
              sym: i.value.sym,
              origOp: i.value
            });
            yield sl.enter(_kit.Tag.arguments, _kit.Tag.Array);
            yield* Kit.reposOne(walk(sl.one()), _kit.Tag.push);
          } else {
            yield sl.enter(_kit.Tag.callee, _kit.Tag.MemberExpression, {
              bind: true
            });
            yield* Kit.reposOne(walk(sl.one()), _kit.Tag.object);
            // yield sl.tok(Tag.property,Tag.Identifier,{sym:i.value.sym})
            yield sl.tok(_kit.Tag.property, _kit.Tag.Identifier, {
              node: {
                name: i.value.sym.orig
              },
              origSym: i.value.sym
            });
            yield* sl.leave();
            yield sl.enter(_kit.Tag.arguments, _kit.Tag.Array);
          }
          const sub = sl.label();
          for (let j; (j = sl.curLev()) != null;) {
            let pos;
            if (j.pos === _kit.Tag.params) {
              yield sl.enter(_kit.Tag.push, _kit.Tag.ArrowFunctionExpression);
              yield* sl.one();
              pos = _kit.Tag.body;
            } else {
              pos = _kit.Tag.push;
            }
            yield* Kit.repos(walk(sl.one()), pos);
            yield* sub();
          }
          yield* lab();
          sl.close(i);
          continue;
        }
      }
      yield i;
    }
  }
  return walk(sl);
}

/** corrects JS AST nodes types to match specification */
const interpretCasts = exports.interpretCasts = Kit.pipe(function* cleanEffExpr(s) {
  const sl = Kit.auto(s);
  function* walk() {
    for (const i of sl.sub()) {
      switch (i.type) {
        case effExpr:
          if (i.enter) {
            const j = sl.curLev();
            const result = j != null && !i.value.reflected;
            if (i.value.tmpVar) {
              if (j) {
                yield sl.enter(i.pos, _kit.Tag.AssignmentExpression, {
                  node: {
                    operator: "="
                  },
                  result
                });
                yield sl.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                  sym: i.value.tmpVar
                });
                yield* Kit.reposOne(walk(), _kit.Tag.right);
                yield* sl.leave();
              }
            } else {
              if (j) {
                j.value.result = result;
                yield* Kit.reposOne(walk(), i.pos);
              }
            }
          }
          break;
        default:
          yield i;
      }
    }
  }
  yield* walk();
}, Policy.stage("adjust-field-type"), Kit.adjustFieldType);

/** splits JS into frames with at most 1 effectful expression (the last one) */
const splitEffBlock = exports.splitEffBlock = Kit.pipe(function* splitEffBlock(s) {
  const sl = Kit.auto(s);
  function* block(i) {
    (0, _kit.invariant)(i.enter);
    const lab = sl.label();
    yield sl.peel(i);
    let r = sl.enter(_kit.Tag.push, frame);
    yield r;
    for (const j of sl.sub()) {
      if (j.enter) {
        if (j.type === chain) {
          yield* block(j);
        } else {
          yield sl.peel(j);
          yield* walk();
          yield* sl.leave();
        }
        if (j.value.eff) {
          r.value.eff = true;
          //            r.value.parRegion = j.value.parRegion
          yield* sl.leave();
          yield r = sl.enter(_kit.Tag.push, frame);
        }
      } else {
        yield j;
      }
    }
    yield* lab();
  }
  function* walk() {
    for (const i of sl.sub()) {
      if (i.enter && i.type === chain) yield* block(i);else yield i;
    }
  }
  yield* walk();
},
//* removes empty frame, but keeps it if it is the only one in the chain
function rmEmptyFrame(s) {
  s = Kit.auto(s);
  function* walk() {
    let first = true;
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case frame:
            if (first) {
              first = false;
            } else {
              if (s.cur().value === i.value) {
                s.take();
                continue;
              }
            }
            break;
          case chain:
            yield i;
            yield* walk();
            continue;
        }
      }
      yield i;
    }
  }
  return walk();
}, Prop.recalcEff);

/** removes `pure` tag if its content is in fact effectful */
function* cleanPureEff(s) {
  s = Kit.auto(s);
  for (const i of s) {
    if (i.type === pure) {
      if (i.enter) {
        const j = s.curLev();
        if (j != null && j.value.eff) {
          yield s.peel(Kit.setPos(s.take(), i.pos));
          yield* s.sub();
          yield* s.leave();
          s.close(i);
          continue;
        }
      }
    }
    yield i;
  }
}

/** adds contextSym namespace to library symbols
 * (handling `contextMethodOps` and `contextMethodOpsSpec` options
 */
function ctxMethods(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  const {
    contextSym
  } = root;
  const {
    contextMethodOps,
    contextMethodOpsSpec,
    scopeConstructor
  } = s.opts;
  if (!contextSym || !contextMethodOps) return s;
  if (!s.opts.static) throw new Error("`contextMethodOps:true` requires `static:true`");
  return walk();
  function* walk() {
    for (const i of s) {
      let sym;
      if (i.enter && i.type === _kit.Tag.Identifier && (sym = i.value.sym) && sym.lib && sym.name !== scopeConstructor && contextMethodOpsSpec[sym.name] !== false) {
        yield s.enter(i.pos, _kit.Tag.MemberExpression);
        if (sym.ctxField) {
          yield s.enter(_kit.Tag.object, _kit.Tag.MemberExpression);
          yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
            sym: contextSym,
            origOp: i.value.origOp
          });
          yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
            node: {
              name: sym.ctxField
            }
          });
          yield* s.leave();
        } else {
          yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
            sym: contextSym,
            origOp: i.value.origOp
          });
        }
        yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
          node: {
            name: i.value.sym.name
          }
        });
        yield* s.leave();
        s.close(i);
        continue;
      }
      yield i;
    }
  }
}

/** removes frames with `removed: true` */
function* cleanup(si) {
  const s = Kit.auto(si);
  for (const i of s) {
    if (i.enter && i.type === frame) {
      if (i.value.removed) Kit.skip(s.copy(i));else yield* s.copy(i);
    } else yield i;
  }
}

/**
 * Sets
 *  * `ignoreResult:true` - value for expressions where its result isn't needed
 *  * `lastSeqExpr:true` - for the last expression in `SequenceExpression`
 */
function applyIgnoreResult(si) {
  const sa = Kit.toArray(si);
  const s = Kit.auto(sa);
  _applyIgnoreResult(s, false);
  return sa;
  function _applyIgnoreResult(sw, ignore) {
    for (const i of sw) {
      if (i.enter) {
        i.value.ignoreResult = ignore || i.pos === _kit.Tag.update;
        switch (i.type) {
          case letStmt:
            if (!i.value.sym || !i.value.sym.bound) _applyIgnoreResult(s.sub(), true);
            break;
          case _kit.Tag.SequenceExpression:
            s.take();
            for (let j; (j = s.curLev()) != null;) _applyIgnoreResult(s.one(), ignore || !j.value.last);
            break;
          case _kit.Tag.ExpressionStatement:
            _applyIgnoreResult(s.sub(), true);
            break;
          default:
            ignore = false;
        }
      }
    }
  }
}
function isEffFree(i) {
  switch (i.type) {
    case bindPat:
    case _kit.Tag.Identifier:
    case _kit.Tag.RegExpLiteral:
    case _kit.Tag.NullLiteral:
    case _kit.Tag.StringLiteral:
    case _kit.Tag.BooleanLiteral:
    case _kit.Tag.NumericLiteral:
      return true;
  }
  return false;
}