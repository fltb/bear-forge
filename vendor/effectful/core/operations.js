"use strict";

exports.__esModule = true;
exports.combine = combine;
exports.inject = inject;
exports.interpret = interpret;
exports.normalizeAssign = normalizeAssign;
exports.propAccess = propAccess;
var _kit = require("./kit");
var Kit = _kit;
var Block = require("./block");
var Bind = require("./bind");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
const op = Block.op;
const opNamesMap = new Map();
const opNamesReserved = new Set();
const assignmentOps = {
  "=": Kit.sysId("set"),
  "+=": Kit.sysId("plusAssignOp"),
  "-=": Kit.sysId("minusAssignOp"),
  "*=": Kit.sysId("multAssignOp"),
  "/=": Kit.sysId("divAssignOp"),
  "%=": Kit.sysId("modAssignOp"),
  "<<=": Kit.sysId("lshiftAssignOp"),
  ">>=": Kit.sysId("rshiftAssignOp"),
  ">>>=": Kit.sysId("rushiftAssignOp"),
  "|=": Kit.sysId("bwOrAssignOp"),
  "^=": Kit.sysId("bwXorAssignOp"),
  "&=": Kit.sysId("bwAndAssignOp")
};
const unaryOps = {
  "-": Kit.sysId("unaryMinusOp"),
  "+": Kit.sysId("unaryPlusOp"),
  "!": Kit.sysId("notOp"),
  "~": Kit.sysId("invertOp"),
  typeof: Kit.sysId("typeofOp"),
  void: Kit.sysId("voidOp"),
  delete: Kit.sysId("del")
};
const binaryOps = {
  "==": Kit.sysId("eqOp"),
  "!=": Kit.sysId("neqOp"),
  "===": Kit.sysId("strictEqOp"),
  "!==": Kit.sysId("strictNeqOp"),
  "<": Kit.sysId("lsOp"),
  "<=": Kit.sysId("leOp"),
  ">": Kit.sysId("mrOp"),
  ">=": Kit.sysId("meOp"),
  "<<": Kit.sysId("lshiftOp"),
  ">>": Kit.sysId("rshiftOp"),
  ">>>": Kit.sysId("urshiftEqOp"),
  "+": Kit.sysId("plusOp"),
  "-": Kit.sysId("minusOp"),
  "*": Kit.sysId("multOp"),
  "/": Kit.sysId("divOp"),
  "%": Kit.sysId("modOp"),
  "|": Kit.sysId("bwOrOp"),
  "^": Kit.sysId("bwXorOp"),
  "&": Kit.sysId("bwAndOp"),
  in: Kit.sysId("inOp"),
  instanceof: Kit.sysId("instanceOfOp")
};
const updateOps = {
  "++": Kit.sysId("incrOp"),
  "--": Kit.sysId("decrOp")
};
const prefixUpdateOps = {
  "++": Kit.sysId("prefixIncrOp"),
  "--": Kit.sysId("prefixDecrOp")
};
const logicalOps = {
  "||": Kit.sysId("orOp"),
  "&&": Kit.sysId("andOp")
};
function getOpName(i) {
  switch (i.type) {
    case _kit.Tag.AssignmentExpression:
      return assignmentOps[i.value.node.operator];
    case _kit.Tag.BinaryExpression:
      return binaryOps[i.value.node.operator];
    case _kit.Tag.UnaryExpression:
      return unaryOps[i.value.node.operator];
    case _kit.Tag.UpdateExpression:
      return (i.value.node.prefix ? prefixUpdateOps : updateOps)[i.value.node.operator];
    case _kit.Tag.LogicalExpression:
      return logicalOps[i.value.node.operator];
    case _kit.Tag.YieldExpression:
      if (i.value.node.delegate) return Kit.sysId("yldStar");
      return Kit.sysId("yld");
    case _kit.Tag.AwaitExpression:
      return Kit.sysId("chain");
  }
  let res = opNamesMap.get(i.type);
  if (res != null) return res;
  res = Kit.sysId(Kit.symName(i.type).match(/[A-Z]/g).join(""));
  Kit.invariant(!opNamesReserved.has(res));
  opNamesMap.set(i.type, res);
  return res;
}
function inject(si) {
  const nset = new Map();
  const s = Kit.auto(si);
  const root = s.first.value;
  root.pureId = Kit.sysId(s.opts.returnName || "pure");
  function setEnv(ops) {
    for (const j in ops) {
      const v = ops[j];
      if (v === false) nset.delete(_kit.Tag[j]);else nset.set(_kit.Tag[j], v === true ? false : Array.isArray(v) ? v.map(Kit.sysId) : Kit.sysId(v));
    }
  }
  function* walk() {
    for (const i of s.sub()) {
      if (i.enter) {
        const ops = i.value.configDiff && i.value.configDiff.ops;
        if (ops != null) setEnv(ops);
        let v = nset.get(i.type);
        if (v != null) {
          if (i.type === _kit.Tag.YieldExpression && Array.isArray(v)) v = v[Number(i.value.node.delegate || 0)];
          let name = v || getOpName(i);
          yield s.enter(i.pos, op, {
            node: {
              src: i.value,
              type: i.type,
              loc: i.value.node && i.value.node.loc
            },
            bind: true,
            expr: true,
            sym: name
          });
          yield* walk();
          yield* s.leave();
          s.close(i);
          continue;
        }
      }
      yield i;
    }
  }
  if (s.opts.ops != null) setEnv(s.opts.ops);
  if (!nset.size) return s;
  return walk();
}
function interpret(si) {
  const s = Kit.auto(si);
  function* walk() {
    for (const i of s.sub()) {
      if (i.enter && i.type === op) {
        const lab = s.label();
        let pos = i.pos;
        if (i.value.bind) {
          yield s.enter(pos, Block.effExpr);
          pos = _kit.Tag.expression;
        }
        yield s.enter(pos, _kit.Tag.CallExpression, {
          node: {
            loc: i.value.node && i.value.node.loc
          }
        });
        yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
          sym: i.value.sym
        });
        yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
        yield* Kit.repos(walk(), _kit.Tag.push);
        yield* lab();
        s.close(i);
        continue;
      }
      yield i;
    }
  }
  return walk();
}

/**
 * combines opts with bind into a single call for optimization purposes
 * e.g.
 *
 *    bind(yield a, cont) ==> bindYield(a, cont)
 */
function combine(si) {
  const s = Kit.auto(si);
  const ops = s.opts.combineOps;
  return ops ? _combine() : s;
  function* _combine() {
    const defaultName = s.opts.bindName;
    const defaultSym = Kit.sysId(defaultName);
    for (const i of s) {
      yield i;
      if (i.enter && i.type === Block.letStmt && i.value.eff) {
        const j = s.curLev();
        if (j && j.type === op && (ops === true || ops[j.value.sym.orig])) {
          i.value.op = j.value;
          i.value.opSym = j.value.sym;
          i.value.bindName = j.value.sym.orig;
          s.take();
          if (!j.leave) {
            yield* s.sub();
            s.close(j);
          }
          continue;
        }
        i.value.op = null;
        i.value.opSym = defaultSym;
        i.value.bindName = defaultName;
      }
    }
  }
}
const globalObjNames = {
  window: true,
  global: true,
  globalThis: true
};

/** replaces property access with API calls */
function propAccess(si) {
  const s = Kit.auto(si);
  const wrap = s.opts.wrapPropAccess;
  if (!wrap) return s;
  const root = s.first.value;
  const del = varOp(wrap.delete, "del");
  const set = varOp(wrap.set, "set");
  const get = varOp(wrap.get, "get");
  const call = varOp(wrap.call, "call");
  const constr = varOp(wrap.constr, "constr");
  const globals = wrap.globals !== false;
  const locals = wrap.locals !== false;
  const wrapArgs = wrap.arrArgs;
  if (set && s.opts.optimizeContextVars) throw s.error("`wrapPropAccess:{set}` doesn't work yet with `optimizeContextVars:true`");
  const postproc = root.postproc || (root.postproc = []);
  return _propAccess(s);
  function varOp(conf, defaultName) {
    if (!conf) return null;
    const sym = Kit.sysId(defaultName);
    sym.bindOp = conf.bind !== false;
    const locName = conf.local;
    sym.locSym = locName === false ? null : locName ? Kit.sysId(locName) : sym;
    const globName = conf.global;
    sym.globSym = globName === false ? null : globName ? Kit.sysId(globName) : sym;
    return sym;
  }
  function* _propAccess(sw) {
    for (const i of sw) {
      if (i.enter) {
        let sym, opSym;
        switch (i.type) {
          case _kit.Tag.UpdateExpression:
            if (set) {
              sym = set;
              opSym = getOpName(i);
            }
            break;
          case _kit.Tag.UnaryExpression:
            if (i.value.node.operator === "delete") {
              if (!del) {
                yield i;
                yield s.take();
                continue;
              }
              sym = del;
            }
            break;
          case _kit.Tag.CallExpression:
            if (call) sym = call;
            break;
          case _kit.Tag.NewExpression:
            if (constr) sym = constr;
            break;
          case _kit.Tag.AssignmentExpression:
            if (!set) {
              yield i;
              yield s.take();
              continue;
            }
            opSym = getOpName(i);
            sym = set;
            break;
          case _kit.Tag.Identifier:
            if (!i.value.rhs) break;
          case _kit.Tag.MemberExpression:
            if (get) {
              sym = get;
            }
            break;
        }
        if (sym) {
          let obj, prop;
          function splitMemberExpression(objTok) {
            obj = Kit.reposOneArr(_toConsumableArray(_propAccess(s.one())), _kit.Tag.push);
            if (!objTok.value.node.computed) {
              prop = [s.tok(_kit.Tag.push, _kit.Tag.StringLiteral, {
                node: {
                  value: s.cur().value.node.name
                }
              })];
              Kit.skip(s.one());
            } else prop = Kit.reposOneArr(_toConsumableArray(_propAccess(s.one())), _kit.Tag.push);
          }
          if (!opSym) opSym = sym;
          if (sym === constr) {
            obj = Kit.reposOneArr(_toConsumableArray(_propAccess(s.one())), _kit.Tag.push);
            prop = [];
          } else if (sym === call) {
            const objTok = s.cur();
            if (objTok.type === _kit.Tag.MemberExpression) {
              s.take();
              splitMemberExpression(objTok);
              s.close(objTok);
            } else {
              obj = Kit.reposOneArr(_toConsumableArray(_propAccess(s.one())), _kit.Tag.push);
              prop = [root.sloppy ? s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                node: {
                  name: "global"
                }
              }) : s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                sym: Kit.scope.undefinedSym
              })];
            }
          } else {
            const objTok = sym === get ? i : s.take();
            switch (objTok.type) {
              case _kit.Tag.MemberExpression:
                splitMemberExpression(objTok);
                break;
              case _kit.Tag.Identifier:
                const objSym = objTok.value.sym;
                if (objSym) {
                  if (objSym.global) {
                    opSym = opSym.globSym;
                  } else if (objSym.interpr === Bind.ctxField) {
                    opSym = opSym.locSym;
                  }
                }
                if (!opSym || !objSym || objSym.singleAssign || !objSym.global && (objSym.interpr !== Bind.ctxField || locals === false) || objSym.global && (!globals || globalObjNames[objSym.orig])) {
                  yield i;
                  if (sym !== get) yield objTok;
                  continue;
                }
                if (objSym.global) {
                  obj = [s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                    node: {
                      name: "global"
                    }
                  })];
                  prop = [s.tok(_kit.Tag.push, _kit.Tag.StringLiteral, {
                    node: {
                      value: objSym.name
                    }
                  })];
                } else {
                  const ctxSym = Kit.scope.newSym();
                  ctxSym.declScope = objSym.declScope;
                  ctxSym.interpr = objSym.interpr;
                  ctxSym.fieldName = null;
                  obj = [s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                    sym: ctxSym
                  })];
                  const val = s.tok(_kit.Tag.push, _kit.Tag.StringLiteral, {
                    sym,
                    node: {
                      value: objSym.orig
                    }
                  });
                  prop = [val];
                  postproc.push(
                  // core-loose is compiled without respect to the loops scope
                  function (objSym, val) {
                    return function () {
                      val.value.node.value = objSym.fieldName;
                    };
                  }(objSym, val));
                }
                break;
              default:
                yield i;
                if (sym !== get) yield objTok;
                continue;
            }
            if (sym !== get) s.close(objTok);
          }
          yield s.enter(i.pos, op, {
            node: {
              src: i.value,
              loc: i.value.node && i.value.node.loc,
              type: i.type
            },
            bind: i.value.bind,
            eff: i.value.eff,
            sym: opSym
          });
          yield* obj;
          yield* prop;
          if (sym === set) yield* Kit.reposOne(_propAccess(s.sub()), _kit.Tag.push);else if (sym === call || sym === constr) {
            const args = s.take();
            if (!args.leave) {
              if (wrapArgs) {
                yield s.enter(_kit.Tag.push, _kit.Tag.ArrayExpression);
                yield s.enter(_kit.Tag.elements, _kit.Tag.Array);
              }
              yield* _propAccess(s.sub());
              if (wrapArgs) {
                yield* s.leave();
                yield* s.leave();
              }
              s.close(args);
            }
          }
          yield* s.leave();
          s.close(i);
          continue;
        }
      }
      yield i;
    }
  }
}

/**
 * converts update expressions and assignments without `=` operation into
 * assignments with `=`
 */
function normalizeAssign(si) {
  let s = Kit.auto(si);
  if (!s.opts.normalizeAssign) return s;
  s = Kit.auto(Kit.toArray(Block.applyIgnoreResult(s)));
  const root = s.first.value;
  let tmps = [false, false];
  let updTmp;
  return _normalizeAssign(s);
  function* _normalizeAssign(sw) {
    for (const i of sw) {
      switch (i.type) {
        case _kit.Tag.AssignmentExpression:
        case _kit.Tag.UpdateExpression:
          const op = i.value.node.operator;
          if (op === "=") break;
          const upd = i.type === _kit.Tag.UpdateExpression;
          const retOld = upd && !i.value.node.prefix && !i.value.ignoreResult;
          const bop = upd ? op.substr(0, 1) : op.substr(0, op.length - 1);
          const j = s.cur();
          let pos = i.pos;
          const lab = s.label();
          let left;
          let seq;
          function* startSeq() {
            if (!seq) {
              seq = true;
              pos = _kit.Tag.push;
              yield s.enter(i.pos, _kit.Tag.SequenceExpression);
              yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
            }
          }
          if (j.type === _kit.Tag.MemberExpression) {
            left = [s.take()];
            for (let x = 0; x < 2; ++x) {
              const start = s.cur();
              if (Block.isEffFree(start)) {
                var _left;
                (_left = left).push.apply(_left, _toConsumableArray(_normalizeAssign(s.one())));
                continue;
              }
              if (!seq) {
                seq = true;
                pos = _kit.Tag.push;
                yield s.enter(i.pos, _kit.Tag.SequenceExpression);
                yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
              }
              yield* startSeq();
              let sym = tmps[x];
              if (!sym) {
                sym = Bind.tempVarSym(root);
                sym.singleAssign = true;
                yield s.enter(_kit.Tag.push, _kit.Tag.AssignmentExpression, {
                  node: {
                    operator: "="
                  }
                });
                yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                  sym
                });
                yield* Kit.reposOne(_normalizeAssign(s.one()), _kit.Tag.right);
                yield* s.leave();
                left.push(s.tok(start.pos, _kit.Tag.Identifier, {
                  sym
                }));
              }
            }
            left.push(s.close(j));
          } else if (j.type === _kit.Tag.Identifier) {
            left = _toConsumableArray(s.one());
          } else if (j.type === _kit.Tag.ObjectPattern || j.type === _kit.Tag.ArrayPattern) {
            throw s.error('destructuring isn\'t supported yet, apply "@babel/plugin-transform-destructuring"');
          } else {
            Kit.skip(lab());
            break;
          }
          const right = upd ? [s.tok(_kit.Tag.right, _kit.Tag.NumericLiteral, {
            node: {
              value: 1
            }
          })] : _toConsumableArray(_normalizeAssign(s.one()));
          let leftArg = _toConsumableArray(Kit.clone(left));
          const leftTok = leftArg[0].value;
          leftTok.lhs = left[0].value.rhs = false;
          leftTok.rhs = true;
          if (retOld) {
            yield* startSeq();
            if (!updTmp) {
              updTmp = Bind.tempVarSym(root);
              updTmp.singleAssign = true;
            }
            yield s.enter(pos, _kit.Tag.AssignmentExpression, {
              node: {
                operator: "="
              }
            });
            yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
              sym: updTmp
            });
            yield* Kit.reposOne(leftArg, _kit.Tag.right);
            yield* s.leave();
            leftArg = [s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
              sym: updTmp
            })];
          }
          yield s.enter(pos, _kit.Tag.AssignmentExpression, {
            node: {
              operator: "="
            }
          });
          yield* Kit.reposOne(left, _kit.Tag.left);
          yield s.enter(_kit.Tag.right, _kit.Tag.BinaryExpression, {
            node: {
              operator: bop
            }
          });
          yield* Kit.reposOne(leftArg, _kit.Tag.left);
          yield* right;
          yield* s.leave();
          yield* s.leave();
          if (retOld) yield s.tok(pos, _kit.Tag.Identifier, {
            sym: updTmp
          });
          yield* lab();
          s.close(i);
          continue;
      }
      yield i;
    }
  }
}