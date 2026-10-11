"use strict";

exports.__esModule = true;
exports.blockScoping = blockScoping;
exports.doWhileStmt = doWhileStmt;
exports.toBlocks = exports.repeatId = exports.repeat = exports.normalizeFor = exports.looseForOf = exports.iteratorId = exports.forParId = exports.forOfStmt = exports.forInIteratorId = exports.effIteratorId = void 0;
exports.whileStmt = whileStmt;
var _kit = require("./kit");
var Kit = _kit;
var _propagate = require("./propagate");
var Ctrl = require("./control");
var Bind = require("./bind");
var Block = require("./block");
var Policy = require("./policy");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
const repeatId = exports.repeatId = Kit.sysId("repeat");
const forParId = exports.forParId = Kit.sysId("forPar");
const forInIteratorId = exports.forInIteratorId = Kit.sysId("forInIterator");
const iteratorId = exports.iteratorId = Kit.sysId("iterator");
const effIteratorId = exports.effIteratorId = Kit.sysId("iteratorM");

/**
 * convers all kind of loops into `for` loops
 */
function* whileStmt(s) {
  for (const i of s) {
    yield i.type === _kit.Tag.WhileStatement && (i.value.eff || i.value.opts.normPureWhile) ? Kit.setType(i, _kit.Tag.ForStatement) : i;
  }
}
const toBlocks = exports.toBlocks = Kit.pipe(function toBlocksOuter(s) {
  s = Kit.auto(s);
  const {
    normPureBlocks
  } = s.opts;
  function* walk() {
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ForStatement:
          case _kit.Tag.ForInStatement:
          case _kit.Tag.ForOfStatement:
          case _kit.Tag.DoWhileStatement:
          case _kit.Tag.WhileStatement:
            const lab = s.label();
            if (i.pos !== _kit.Tag.push && (i.value.eff || normPureBlocks)) {
              yield s.enter(i.pos, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              yield s.peel(Kit.setPos(i, _kit.Tag.push));
            } else yield s.peel(i);
            yield* walk();
            yield* lab();
            continue;
        }
      }
      yield i;
    }
  }
  return walk();
}, function toBlocksInner(s) {
  s = Kit.auto(s);
  function* walk() {
    for (const i of s.sub()) {
      yield i;
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ForStatement:
          case _kit.Tag.ForInStatement:
          case _kit.Tag.ForOfStatement:
          case _kit.Tag.DoWhileStatement:
          case _kit.Tag.WhileStatement:
            const p = yield* s.findPos(_kit.Tag.body);
            if (p == null) {
              const lab = s.label();
              yield s.enter(_kit.Tag.body, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              yield* lab();
            } else if (p.type !== _kit.Tag.BlockStatement) {
              const lab = s.label();
              yield s.enter(_kit.Tag.body, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              if (p.type === _kit.Tag.EmptyStatement) {
                Kit.skip(s.copy(p));
              } else {
                yield s.peel(Kit.setPos(p, _kit.Tag.push));
                yield* walk();
              }
              yield* lab();
            } else yield p;
        }
      }
    }
  }
  return walk();
});
function doWhileStmt(s) {
  s = Kit.auto(s);
  const {
    normPureDoWhile
  } = s.opts;
  return _doWhileStmt(s);
  function* _doWhileStmt(sw) {
    for (const i of sw) {
      if ((normPureDoWhile || i.value.eff) && i.type === _kit.Tag.DoWhileStatement) {
        const lab = s.label();
        const sym = Bind.tempVarSym(s.first.value, null, false);
        yield s.peel(Kit.setType(i, _kit.Tag.ForStatement));
        i.value.node.test = null;
        const ilab = s.label();
        yield s.enter(_kit.Tag.init, _kit.Tag.VariableDeclaration, {
          node: {
            kind: "var"
          }
        });
        yield s.enter(_kit.Tag.declarations, _kit.Tag.Array);
        yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
        yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
          sym,
          decl: true,
          lhs: true,
          rhs: false
        });
        yield s.tok(_kit.Tag.init, _kit.Tag.BooleanLiteral, {
          node: {
            value: true
          }
        });
        yield* ilab();
        yield s.tok(_kit.Tag.test, _kit.Tag.Identifier, {
          sym,
          decl: false,
          lhs: false,
          rhs: true
        });
        yield s.enter(_kit.Tag.update, _kit.Tag.AssignmentExpression, {
          node: {
            operator: "="
          }
        });
        yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
          sym,
          decl: false,
          lhs: true,
          rhs: false
        });
        const test = s.cur();
        yield* Kit.repos(s.one(), _kit.Tag.right);
        sym.type = test.value.type;
        yield* ilab();
        yield* _doWhileStmt(s.sub());
        yield* lab();
      } else yield i;
    }
  }
}
function forOfStmtImpl(loose, s) {
  s = Kit.auto(s);
  const root = s.first.value;
  root.hasForOf = false;
  const all = (loose || s.opts.loose) && s.opts.leanForOf || s.opts.normPureForOf;
  const finalize = s.opts.finalizeForOf !== false;
  const esPureProtocol = s.opts.esForOf;
  const esEffProtocol = s.opts.esForAwaitOf;
  const noResult = s.opts.returnContext === false;
  const {
    normPureForIn,
    ops
  } = s.opts;
  const wrapNext = ops && ops.AwaitExpression && ops.AwaitExpression.substr && Kit.sysId(ops.AwaitExpression);
  function* readLeft(sym, forOfInfo) {
    function* val(pos) {
      yield s.enter(pos, _kit.Tag.MemberExpression, {
        forOfInfo
      });
      yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
        sym,
        lhs: false,
        rhs: true
      });
      yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
        node: {
          name: "value"
        }
      });
      yield* s.leave();
    }
    const i = s.take();
    if (i.type === _kit.Tag.VariableDeclaration) {
      yield Kit.setPos(i, _kit.Tag.push);
      i.value.stmt = true;
      for (const j of s.sub()) {
        if (j.leave && j.type === _kit.Tag.VariableDeclarator) yield* val(_kit.Tag.init);
        yield j;
      }
      yield Kit.setPos(s.take(), _kit.Tag.push);
    } else {
      const lab = s.label();
      yield s.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
      yield s.enter(_kit.Tag.expression, _kit.Tag.AssignmentExpression, {
        node: {
          operator: "="
        }
      });
      yield* s.copy(i);
      yield* val(_kit.Tag.right);
      yield* lab();
    }
  }
  function* exit(loop, forOfExit) {
    const lab = s.label();
    const bind = loop.bindIter;
    const wrapAwait = loop.wrapAwait;
    const esProtocol = bind && esEffProtocol || !bind && esPureProtocol;
    const exitName = esProtocol ? "return" : "exit";
    yield s.enter(_kit.Tag.push, _kit.Tag.IfStatement, {
      forOfExit,
      node: {
        loc: loop.node && loop.node.loc
      }
    });
    yield s.enter(_kit.Tag.test, _kit.Tag.MemberExpression);
    yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
      sym: loop.iterVar,
      lhs: false,
      rhs: true,
      decl: false
    });
    yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
      node: {
        name: exitName
      }
    });
    yield* s.leave();
    yield s.enter(_kit.Tag.consequent, _kit.Tag.BlockStatement);
    yield s.enter(_kit.Tag.body, _kit.Tag.Array);
    yield s.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
    let pos = _kit.Tag.expression;
    if (wrapAwait) {
      yield s.enter(pos, Block.op, {
        bind: true,
        eff: true,
        sym: wrapNext
      });
      pos = _kit.Tag.push;
    }
    yield s.enter(pos, _kit.Tag.CallExpression, {
      bind,
      eff: bind
    });
    yield s.enter(_kit.Tag.callee, _kit.Tag.MemberExpression);
    yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
      sym: loop.iterVar,
      lhs: false,
      rhs: true,
      decl: false
    });
    yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
      node: {
        name: exitName
      }
    });
    yield* s.leave();
    yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
    yield* lab();
  }
  function* _forOfStmtImpl(sw, root) {
    for (const i of sw) {
      if (i.enter && (all || i.value.eff)) {
        switch (i.type) {
          case _kit.Tag.FunctionExpression:
          case _kit.Tag.ArrowFunctionExpression:
          case _kit.Tag.ClassExpression:
          case _kit.Tag.ObjectExpression:
          case _kit.Tag.ClassDeclaration:
          case _kit.Tag.FunctionDeclaration:
            yield i;
            if (!i.leave) {
              yield* _forOfStmtImpl(s.sub(), i.value);
              yield s.close(i);
            }
            continue;
          case _kit.Tag.ForInStatement:
            if (loose && !normPureForIn) break;
          case _kit.Tag.ForOfStatement:
            const loop = i.value;
            const sym = loop.iterVar = Bind.tempVarSym(root, "loop");
            let forOfInfo;
            const wrapAwait = loop.wrapAwait = loop.node.await && wrapNext;
            const bind = loop.bindIter = !loose && i.type !== _kit.Tag.ForInStatement && (loop.node.await || s.opts.pureForOf === false);
            const esProtocol = bind && esEffProtocol || !bind && esPureProtocol;
            sym.declBlock = sym.declLoop = loop;
            sym.hasRefs = true;
            i.value.forOfInfo = forOfInfo;
            const lab = s.label();
            if (i.pos !== _kit.Tag.push) {
              yield s.enter(i.pos, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
            }
            let finlab;
            const iterVar = {
              sym,
              lhs: true,
              decl: true,
              forOfInfo
            };
            let iterResultSym = esProtocol && Bind.tempVarSym(root, "i");
            const init = Kit.toArray(readLeft(esProtocol ? iterResultSym : sym, forOfInfo));
            let start = Kit.setType(i, _kit.Tag.ForStatement);
            const slab = s.label();
            yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclaration, {
              node: {
                kind: "var"
              },
              forOfInfo
            });
            yield s.enter(_kit.Tag.declarations, _kit.Tag.Array);
            if (esProtocol) {
              yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
              yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
                sym: iterResultSym,
                lhs: false,
                rhs: false,
                decl: true
              });
              yield* s.leave();
            }
            yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
            yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, iterVar);
            yield s.enter(_kit.Tag.init, _kit.Tag.CallExpression);
            yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
              sym: i.type === _kit.Tag.ForInStatement ? forInIteratorId : i.value.node.await ? effIteratorId : iteratorId
            });
            yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
            const j = s.take();
            yield Kit.setPos(j, _kit.Tag.push);
            if (!j.leave) {
              yield* s.sub();
              yield Kit.setPos(s.take(), _kit.Tag.push);
            }
            yield* slab();
            if (finalize && i.type !== _kit.Tag.ForInStatement) {
              yield s.enter(_kit.Tag.push, _kit.Tag.TryStatement);
              finlab = s.label();
              yield s.enter(_kit.Tag.block, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
            }
            yield s.peel(Kit.setPos(start, _kit.Tag.push));
            const flab = s.label();
            yield s.enter(_kit.Tag.test, _kit.Tag.UnaryExpression, {
              node: {
                operator: "!"
              },
              forOfInfo
            });
            yield s.enter(_kit.Tag.argument, _kit.Tag.MemberExpression);
            let stepPos;
            const stepLab = s.label();
            if (noResult && !esProtocol) {
              yield s.enter(_kit.Tag.object, _kit.Tag.SequenceExpression);
              yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
              stepPos = _kit.Tag.push;
            } else {
              yield s.enter(_kit.Tag.object, _kit.Tag.AssignmentExpression, {
                node: {
                  operator: "="
                }
              });
              yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                sym: esProtocol ? iterResultSym : sym,
                lhs: true,
                rhs: false,
                decl: false
              });
              stepPos = _kit.Tag.right;
            }
            if (wrapAwait) {
              yield s.enter(stepPos, Block.op, {
                sym: wrapNext,
                bind: true,
                eff: true
              });
              stepPos = _kit.Tag.push;
            }
            yield s.enter(stepPos, _kit.Tag.CallExpression, {
              bind,
              eff: bind
            });
            yield s.enter(_kit.Tag.callee, _kit.Tag.MemberExpression);
            yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
              sym,
              lhs: false,
              rhs: true
            });
            yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
              node: {
                name: esProtocol ? "next" : "step"
              }
            });
            yield* s.leave();
            yield s.tok(_kit.Tag.arguments, _kit.Tag.Array);
            yield* s.leave();
            if (wrapAwait) yield* s.leave();
            if (noResult && !esProtocol) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym,
              lhs: false,
              rhs: true
            });
            yield* stepLab();
            yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
              node: {
                name: "done"
              }
            });
            yield* flab();
            const body = s.curLev();
            (0, _kit.invariant)(body.pos === _kit.Tag.body);
            if (body.type === _kit.Tag.BlockStatement) {
              yield s.peel();
              yield* s.peelTo(_kit.Tag.body);
              yield* init;
              yield* _forOfStmtImpl(s.sub(), root);
            } else {
              yield s.enter(_kit.Tag.body, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              if (body.type === _kit.Tag.EmptyStatement) Kit.skip(s.one());else {
                yield* init;
                yield* Kit.reposOne(_forOfStmtImpl(s.one(), root), _kit.Tag.push);
              }
            }
            if (finlab) {
              yield* finlab();
              yield s.enter(_kit.Tag.finalizer, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              yield* exit(loop, forOfInfo);
            }
            yield* lab();
            continue;
        }
      }
      yield i;
    }
  }
  return _forOfStmtImpl(s, s.first.value);
}
const forOfStmt = s => forOfStmtImpl(false, s);
exports.forOfStmt = forOfStmt;
const looseForOf = s => forOfStmtImpl(true, s);

/**
 * transforms `for(init; test; upd) body` into for(;;) {...}
 */
exports.looseForOf = looseForOf;
const normalizeFor = exports.normalizeFor = Kit.pipe(Kit.map(Kit.pipe(Policy.stage("normalize-for-1"), _propagate.recalcEff, Ctrl.recalc, function prepareContinue(s) {
  const sl = Kit.auto(s);
  function cntLab(n) {
    return n === "#" ? "$continue" : `${n}$continue`;
  }
  function* walk() {
    for (const i of sl.sub()) {
      if (i.value.eff) {
        switch (i.type) {
          case _kit.Tag.ForStatement:
            if (i.enter && i.value.cntRefs != null && i.value.cntRefs.length) {
              const lab = sl.label();
              yield sl.peel(i);
              yield* sl.peelTo(_kit.Tag.body);
              yield* sl.peelTo(_kit.Tag.body);
              const cntBlock = sl.enter(_kit.Tag.push, _kit.Tag.BlockStatement, {
                eff: true,
                ctrlEff: true,
                ctrl: cntLab(i.value.ctrl),
                contLoop: i.value
              });
              i.value.cntBlock = cntBlock.value;
              yield cntBlock;
              yield sl.enter(_kit.Tag.body, _kit.Tag.Array);
              yield* walk();
              yield* lab();
              continue;
            }
            break;
        }
      }
      yield i;
    }
  }
  return walk();
}, Policy.stage("after-normalize-for-1"))), Array.from, Kit.map(Kit.pipe(Policy.stage("normalize-for-2"), function* removeContinue(s) {
  const sl = Kit.auto(s);
  for (const i of sl) {
    if (i.value.eff) {
      switch (i.type) {
        case _kit.Tag.ContinueStatement:
          if (i.enter) {
            const {
              cntBlock
            } = i.value.block;
            if (!cntBlock) throw sl.error("wrong `continue` label");
            const brk = sl.tok(i.pos, _kit.Tag.BreakStatement, {
              node: {
                label: {
                  type: "Identifier",
                  name: cntBlock.ctrl
                }
              },
              eff: true,
              bind: true,
              block: cntBlock
            });
            yield brk;
            (cntBlock.brkRefs || (cntBlock.brkRefs = [])).push(brk.value);
            sl.close(i);
          }
          continue;
      }
    }
    yield i;
  }
}, function normalizeFor(s) {
  const sl = Kit.auto(s);
  function* walk() {
    for (const i of sl.sub()) {
      switch (i.type) {
        case _kit.Tag.ForStatement:
          if (!i.value.eff) {
            yield i;
            if (i.enter) yield* sl.sub();
          } else {
            (0, _kit.invariant)(i.enter);
            (0, _kit.invariant)(i.pos === _kit.Tag.push);
            let upd = null,
              test = null,
              hasBody = false;
            for (const j of sl.sub()) {
              (0, _kit.invariant)(j.enter);
              switch (j.pos) {
                case _kit.Tag.init:
                  const ilab = sl.label();
                  if (j.type !== _kit.Tag.VariableDeclaration) {
                    yield sl.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
                    yield sl.peel(Kit.setPos(j, _kit.Tag.expression));
                  } else {
                    j.value.stmt = true;
                    yield sl.peel(Kit.setPos(j, _kit.Tag.push));
                  }
                  yield* sl.sub();
                  yield* ilab();
                  break;
                case _kit.Tag.test:
                  test = [sl.peel(j)].concat(_toConsumableArray(sl.sub()), _toConsumableArray(sl.leave()));
                  break;
                case _kit.Tag.update:
                  upd = [sl.peel(Kit.setPos(j, _kit.Tag.expression))].concat(_toConsumableArray(sl.sub()), _toConsumableArray(sl.leave()));
                  break;
                case _kit.Tag.body:
                  (0, _kit.invariant)(j.enter);
                  (0, _kit.invariant)(j.type === _kit.Tag.BlockStatement);
                  hasBody = true;
                  const blab = sl.label();
                  yield sl.enter(i.pos, _kit.Tag.BlockStatement, i.value);
                  yield sl.enter(_kit.Tag.body, _kit.Tag.Array);
                  yield sl.enter(_kit.Tag.push, repeat, {
                    stmt: true,
                    origLoop: i.value,
                    node: i.value.node
                  });
                  i.value.node.init = i.value.node.test = i.value.node.update = null;
                  yield sl.enter(_kit.Tag.push, _kit.Tag.BlockStatement);
                  yield* sl.peelTo(_kit.Tag.body);
                  if (test != null) {
                    yield sl.enter(_kit.Tag.push, _kit.Tag.IfStatement, {
                      node: {
                        loc: i.value.node.loc
                      }
                    });
                    yield* test;
                    yield sl.peel(Kit.setPos(j, _kit.Tag.consequent));
                  } else yield sl.peel(Kit.setPos(j, _kit.Tag.push));
                  yield sl.enter(_kit.Tag.body, _kit.Tag.Array);
                  yield* walk();
                  if (upd != null) {
                    yield sl.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
                    yield* upd;
                    yield* sl.leave();
                  }
                  if (test != null) {
                    yield* sl.leave();
                    yield* sl.leave();
                    yield sl.enter(_kit.Tag.alternate, _kit.Tag.BlockStatement);
                    yield sl.enter(_kit.Tag.body, _kit.Tag.Array);
                    const brk = sl.tok(_kit.Tag.push, _kit.Tag.BreakStatement, {
                      eff: true,
                      bind: true,
                      block: i.value,
                      forOfInfo: i.value.forOfInfo
                    });
                    (i.value.brkRefs || (i.value.brkRefs = [])).push(brk);
                    yield brk;
                  }
                  yield* blab();
                  sl.close(i);
                  break;
                default:
                  (0, _kit.invariant)(false);
              }
            }
            (0, _kit.invariant)(hasBody);
          }
          break;
        default:
          yield i;
      }
    }
  }
  return walk({});
}, Kit.completeSubst, _propagate.recalcEff, Policy.stage("after-normalize-for-2"))));
const repeat = exports.repeat = (0, _kit.symbol)("repeat", "ctrl");

/** loops block scoping for ES5 output implementation */
function blockScoping(sa) {
  const s = Kit.auto(sa);
  let topRoot = s.first.value;
  function* enterCase(value) {
    yield s.enter(_kit.Tag.push, _kit.Tag.SwitchCase);
    yield s.tok(_kit.Tag.test, _kit.Tag.NumericLiteral, {
      node: {
        value
      }
    });
    yield s.enter(_kit.Tag.consequent, _kit.Tag.Array);
  }
  function postproc(si) {
    const s = Kit.auto(Kit.toArray(si));
    function* walk() {
      for (const i of s.sub()) {
        if (i.enter && i.type === blockScopeSwitch) {
          if (i.value.enabled) {
            yield s.enter(_kit.Tag.push, _kit.Tag.SwitchStatement);
            const j = s.take();
            yield s.peel(Kit.setPos(j, _kit.Tag.discriminant));
            yield* walk();
            yield* s.leave();
            yield* s.sub();
          } else {
            yield s.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
            yield* walk();
          }
          yield* s.leave();
          s.close(i);
          continue;
        }
        yield i;
      }
    }
    return walk(s);
  }
  function* walk(sw, root, subst, capt, ctrl, labs) {
    for (const i of sw) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ReturnStatement:
            if (ctrl) {
              const lab = s.label();
              yield s.enter(i.pos, _kit.Tag.ReturnStatement, {
                block: ctrl.block
              });
              let pos = _kit.Tag.argument;
              if (s.curLev()) {
                let resSym = topRoot.blockResSym;
                if (!resSym) {
                  resSym = topRoot.blockResSym = Bind.tempVarSym(topRoot, "br");
                  topRoot.savedDecls.set(resSym, {
                    raw: null
                  });
                }
                yield s.enter(_kit.Tag.argument, _kit.Tag.SequenceExpression);
                yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
                yield s.enter(_kit.Tag.push, _kit.Tag.AssignmentExpression, {
                  node: {
                    operator: "="
                  }
                });
                yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                  sym: resSym,
                  lhs: true,
                  rhs: false,
                  decl: false
                });
                yield* Kit.reposOne(walk(s.sub(), root, subst, capt, ctrl, labs), _kit.Tag.right);
                yield* s.leave();
                pos = _kit.Tag.push;
              }
              ctrl.retBlock = i.value.block;
              yield s.tok(pos, _kit.Tag.NumericLiteral, {
                node: {
                  value: ctrl.ret == undefined ? ctrl.ret = ctrl.cnt++ : ctrl.ret
                }
              });
              yield* lab();
              s.close(i);
              continue;
            }
            break;
          case _kit.Tag.BreakStatement:
          case _kit.Tag.ContinueStatement:
            if (ctrl) {
              const lab = i.value.node.label && i.value.node.label.name || (i.type === _kit.Tag.BreakStatement ? "##" : "#");
              const info = labs.get(lab);
              if (!info) break;
              const dest = i.type === _kit.Tag.BreakStatement ? info.brk : info.cnt;
              yield s.enter(i.pos, _kit.Tag.ReturnStatement, {
                block: ctrl.block
              });
              dest.block = i.value.block;
              yield s.tok(_kit.Tag.argument, _kit.Tag.NumericLiteral, {
                node: {
                  value: dest.code || (dest.code = ctrl.cnt++)
                }
              });
              yield* s.leave();
              s.close(i);
              continue;
            }
            break;
          case _kit.Tag.Identifier:
            const {
              sym
            } = i.value;
            if (sym && subst && sym.captLoop) {
              let copy;
              if (i.value.decl) {
                copy = Bind.tempVarSym(sym.declScope, sym.orig, sym.byVal);
                subst.set(sym, copy);
                if (capt) capt.push([sym, copy]);
              } else {
                copy = subst.get(sym);
              }
              if (copy) {
                i.value.node.name = null;
                i.value.sym = copy;
              }
            }
            break;
          case _kit.Tag.FunctionExpression:
          case _kit.Tag.ObjectMethod:
          case _kit.Tag.ClassMethod:
          case _kit.Tag.FunctionDeclaration:
          case _kit.Tag.ArrowFunctionExpression:
            yield i;
            const oldTopRoot = topRoot;
            topRoot = i.value;
            yield* walk(s.sub(), i.value, subst);
            topRoot = oldTopRoot;
            continue;
          case _kit.Tag.ForStatement:
          case _kit.Tag.ForOfStatement:
          case _kit.Tag.ForInStatement:
          case _kit.Tag.WhileStatement:
          case _kit.Tag.DoWhileStatement:
            yield i;
            if (i.value.track) {
              const capt = [];
              let j;
              const nsubst = new Map(subst);
              while ((j = s.curLev()) && j.pos !== _kit.Tag.body) {
                yield* walk(s.one(), root, nsubst, capt, labs);
              }
              const loc = j.value.node.loc;
              const lab = s.label();
              let bs;
              if (j.type === _kit.Tag.BlockStatement) {
                yield s.peel();
                yield* s.peelTo(_kit.Tag.body);
                bs = s.sub();
              } else {
                yield s.enter(_kit.Tag.body, _kit.Tag.BlockStatement, {
                  node: {
                    loc
                  }
                });
                yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                bs = s.one();
              }
              const blab = s.label();
              const sw = s.enter(_kit.Tag.push, blockScopeSwitch, {
                enabled: false
              });
              yield sw;
              let pos = _kit.Tag.expression;
              const wrapYldStar = i.value.eff && s.opts.ops && s.opts.ops.YieldExpression;
              const tlab = s.label();
              if (wrapYldStar) {
                yield s.enter(pos, _kit.Tag.YieldExpression, {
                  bind: true,
                  node: {
                    delegate: true
                  }
                });
                pos = _kit.Tag.argument;
              }
              yield s.enter(pos, _kit.Tag.CallExpression, {
                bind: !wrapYldStar && i.value.eff
              });
              const clab = s.label();
              const func = s.enter(_kit.Tag.callee, _kit.Tag.ArrowFunctionExpression, {
                node: {
                  params: [],
                  loc
                },
                opts: root.opts,
                coerce: true,
                topEff: i.value.eff,
                scopeDecls: new Set(),
                savedDecls: new Map()
              });
              yield func;
              yield s.enter(_kit.Tag.params, _kit.Tag.Array);
              for (const [sym] of capt) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                sym,
                lhs: true,
                rhs: false,
                decl: true
              });
              yield* s.leave();
              const b = s.enter(_kit.Tag.body, _kit.Tag.BlockStatement, {
                node: {
                  loc
                },
                ctrl: "#ret",
                labs: ["#ret"],
                ctrlEff: i.value.eff
              });
              yield b;
              const block = b.value;
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              const lmap = new Map();
              const nctrl = {
                cnt: 0,
                block,
                labs: lmap
              };
              if (labs) for (const j of labs.keys()) lmap.set(j, {
                brk: {},
                cnt: {},
                root
              });
              for (const j of i.value.labs) lmap.set(j, {
                brk: {},
                cnt: {},
                root
              });
              lmap.set("##", {
                brk: {},
                cnt: {},
                root
              });
              yield* Kit.reposOne(walk(bs, func.value, subst, null, nctrl, lmap), _kit.Tag.push);
              yield* clab();
              yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
              for (const i of capt) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                sym: i[1],
                lhs: false,
                rhs: true,
                decl: false
              });
              yield* tlab();
              let hasBrk = false;
              if (nctrl.cnt) {
                sw.value.enabled = true;
                yield s.enter(_kit.Tag.cases, _kit.Tag.Array);
                const clab = s.label();
                if (nctrl.ret != null) {
                  yield* enterCase(nctrl.ret);
                  yield s.enter(_kit.Tag.push, _kit.Tag.ReturnStatement, {
                    block
                  });
                  if (ctrl) {
                    const code = ctrl.ret || (ctrl.ret = ctrl.cnt++);
                    yield s.tok(_kit.Tag.argument, _kit.Tag.NumericLiteral, {
                      node: {
                        value: code
                      }
                    });
                  } else if (topRoot.blockResSym) {
                    yield s.tok(_kit.Tag.argument, _kit.Tag.Identifier, {
                      sym: topRoot.blockResSym,
                      lhs: false,
                      rhs: true,
                      decl: false
                    });
                  }
                  yield* clab();
                }
                for (const [k, {
                  brk,
                  cnt
                }] of lmap) {
                  const par = k !== "#" && k !== "##" && ctrl && ctrl.labs.get(k);
                  if (cnt.code != null) {
                    yield* enterCase(cnt.code);
                    if (par) {
                      yield s.enter(_kit.Tag.push, _kit.Tag.ReturnStatement, {
                        block: ctrl.block
                      });
                      const value = par.cnt.code || (par.cnt.code = ctrl.cnt++);
                      par.cnt.block = cnt.block;
                      yield s.tok(_kit.Tag.argument, _kit.Tag.NumericLiteral, {
                        node: {
                          value
                        }
                      });
                    } else {
                      yield s.enter(_kit.Tag.push, _kit.Tag.ContinueStatement, {
                        block: cnt.block,
                        node: {
                          label: k !== "#" ? {
                            type: "Identifier",
                            name: k
                          } : undefined
                        }
                      });
                    }
                    yield* clab();
                  }
                  if (brk.code != null) {
                    if (k === "##") hasBrk = true;
                    yield* enterCase(brk.code);
                    if (par) {
                      yield s.enter(_kit.Tag.push, _kit.Tag.ReturnStatement, {
                        block: ctrl.block
                      });
                      const value = par.brk.code || (par.brk.code = ctrl.cnt++);
                      par.brk.block = brk.block;
                      yield s.tok(_kit.Tag.argument, _kit.Tag.NumericLiteral, {
                        node: {
                          value
                        }
                      });
                    } else {
                      yield s.enter(_kit.Tag.push, _kit.Tag.BreakStatement, {
                        block: brk.block,
                        node: {
                          label: k !== "##" ? {
                            type: "Identifier",
                            name: k
                          } : undefined
                        }
                      });
                    }
                    yield* clab();
                  }
                }
                yield s.enter(_kit.Tag.push, _kit.Tag.SwitchCase);
                yield s.enter(_kit.Tag.consequent, _kit.Tag.Array);
                yield s.tok(_kit.Tag.push, _kit.Tag.ContinueStatement, {
                  block: i.value
                });
              }
              if (hasBrk) {
                yield* blab();
                yield s.tok(_kit.Tag.push, _kit.Tag.BreakStatement, {
                  block: i.value
                });
              }
              yield* lab();
            } else {
              let nlabs;
              if (labs) {
                nlabs = new Map(labs);
                for (const j of i.value.labs) nlabs.set(j, false);
                nlabs.set("##", false);
              }
              yield* walk(s.sub(), root, subst, capt, ctrl, nlabs);
            }
            continue;
          case _kit.Tag.BlockStatement:
          case _kit.Tag.SwitchStatement:
            if (i.value.labs && i.value.labs.length) {
              let nlabs = new Map(labs);
              nlabs = new Map(labs);
              for (const j of i.value.labs) nlabs.set(j === "#" ? "##" : j, false);
              yield i;
              yield* walk(s.sub(), root, subst, capt, ctrl, nlabs);
              continue;
            }
        }
      }
      yield i;
    }
  }
  return postproc(walk(s, s.first.value));
}
const blockScopeSwitch = Kit.symbol("blockScopeSwitch");