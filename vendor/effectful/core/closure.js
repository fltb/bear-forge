"use strict";

exports.__esModule = true;
exports.closConv = closConv;
exports.contextDecls = void 0;
exports.convertCalls = convertCalls;
exports.depsToTop = depsToTop;
exports.flattenModuleDecls = flattenModuleDecls;
exports.substContextIds = substContextIds;
exports.topToIIFE = topToIIFE;
var _kit = require("./kit");
var Kit = _kit;
var State = require("./state");
var Bind = require("./bind");
var Block = require("./block");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
const emptyArr = [];

/** for module-level definitions we need to re-arrange its
 * declarations so they are visible from handlers
 */
function flattenModuleDecls(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  if (!s.opts.topLevel || !root.hasTop) return s;
  const closConv = s.opts.closConv;
  return _topModuleVars(s);
  function* toExpr(i, j, vars) {
    const id = s.cur().value;
    vars.push(id);
    const lab = s.label();
    yield s.enter(i.pos, _kit.Tag.ExpressionStatement);
    yield s.enter(_kit.Tag.expression, _kit.Tag.AssignmentExpression, {
      node: {
        operator: "="
      }
    });
    yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
      sym: id.sym,
      node: id.node
    });
    yield s.peel(Kit.setType(Kit.setPos(j, _kit.Tag.right), j.type === _kit.Tag.ClassDeclaration ? _kit.Tag.ClassExpression : _kit.Tag.FunctionExpression));
    yield* s.sub();
    yield* lab();
  }
  function* _topModuleVars(si) {
    const s = Kit.auto(si);
    for (const i of s) {
      yield i;
      if (i.pos === _kit.Tag.body) break;
    }
    const vars = [];
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ClassDeclaration:
          case _kit.Tag.FunctionDeclaration:
            if (closConv) {
              yield* toExpr(i, i, vars);
              break;
            }
          case _kit.Tag.ExportNamedDeclaration:
          case _kit.Tag.ExportDefaultDeclaration:
          case _kit.Tag.ExportAllDeclaration:
            if (closConv) {
              const la = s.cur();
              if (la.type === _kit.Tag.FunctionDeclaration) {
                yield i;
                const lab = s.label();
                yield s.enter(la.pos, _kit.Tag.VariableDeclaration, {
                  node: {
                    kind: "var"
                  }
                });
                yield s.enter(_kit.Tag.declarations, _kit.Tag.Array);
                yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
                const f = s.take();
                Kit.invariant(s.cur().pos === _kit.Tag.id);
                yield* s.one();
                yield s.enter(_kit.Tag.init, _kit.Tag.FunctionExpression, la.value);
                yield* s.sub();
                yield* lab();
                s.close(f);
                yield* s.sub();
                yield s.close(i);
                continue;
              }
            }
          case _kit.Tag.ImportDeclaration:
          case _kit.Tag.VariableDeclaration:
          case _kit.Tag.ExpressionStatement:
            yield* s.copy(i);
            break;
          default:
            yield i;
            if (i.leave) continue;
            for (const j of s.sub()) {
              if (j.enter) {
                switch (j.type) {
                  case _kit.Tag.ExpressionStatement:
                  case _kit.Tag.FunctionExpression:
                  case _kit.Tag.ClassExpression:
                  case _kit.Tag.ObjectExpression:
                  case _kit.Tag.ArrowFunctionExpression:
                    yield* s.copy(j);
                    continue;
                  case _kit.Tag.ClassDeclaration:
                  case _kit.Tag.FunctionDeclaration:
                    yield* toExpr(i, j, vars);
                    continue;
                  case _kit.Tag.VariableDeclaration:
                    let any = false;
                    const vlab = s.label();
                    for (const j of s.sub()) {
                      if (j.enter && j.type === _kit.Tag.VariableDeclarator) {
                        const pat = [];
                        for (const k of s.one()) {
                          if (k.enter && k.type === _kit.Tag.Identifier && k.value.decl) {
                            vars.push(k.value);
                            pat.push(s.tok(k.pos, _kit.Tag.Identifier, {
                              sym: k.value.sym,
                              node: k.value.node
                            }));
                            s.close(k);
                          } else pat.push(k);
                        }
                        if (s.curLev()) {
                          if (!any) {
                            yield s.enter(i.pos, _kit.Tag.ExpressionStatement);
                            yield s.enter(_kit.Tag.expression, _kit.Tag.SequenceExpression);
                            yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
                            any = true;
                          }
                          yield s.enter(_kit.Tag.push, _kit.Tag.AssignmentExpression, {
                            node: {
                              operator: "="
                            }
                          });
                          yield* Kit.reposOne(pat, _kit.Tag.left);
                          yield* Kit.reposOne(s.one(), _kit.Tag.right);
                          yield* s.leave();
                        }
                      }
                    }
                    s.close(j);
                    yield* vlab();
                    continue;
                }
              }
              yield j;
            }
            yield s.close(i);
        }
      }
    }
    if (vars.length) {
      yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclaration, {
        node: {
          kind: "var"
        }
      });
      yield s.enter(_kit.Tag.declarations, _kit.Tag.Array);
      for (const [sym, node] of new Map(vars.map(i => [i.sym, i.node]))) {
        yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
        yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
          sym,
          node
        });
        yield* s.leave();
      }
      yield* s.leave();
      yield* s.leave();
    }
    yield* s;
  }
}

/** moves frame steps to top level of JS module */
function depsToTop(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  const top = [];
  if (!root.hasTop) return s;
  return _depsToTop();
  function* _depsToTop() {
    for (const i of s) {
      yield i;
      if (i.pos === _kit.Tag.body && i.type === _kit.Tag.Array) break;
    }
    yield* Kit.skipTillFileBeg(s);
    yield* collect();
    for (const i of top) {
      yield* i;
    }
    yield* s;
  }
  function* collect() {
    for (const i of s.sub()) {
      if (i.enter && i.type === _kit.Tag.FunctionDeclaration && i.value.moveToTop) {
        top.push([i].concat(_toConsumableArray(collect()), [s.close(i)]));
      } else yield i;
    }
  }
}

/** moves function constructors to meta constructors */
function closConv(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  const {
    opts
  } = root;
  if (!opts.closConv) return s;
  const {
    closureShortcuts
  } = opts;
  if (!opts.topLevel) throw s.error("`closConv` requires `topLevel`");
  if (opts.wrapFunction) throw s.error("`closConv` doesn't work with `wrapFunction`");
  return Kit.toArray(_closConv());
  function* _closConv() {
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ClassExpression:
          case _kit.Tag.ClassDeclaration:
            throw s.error("ES classes aren't yet supported with `closConv`");
          case _kit.Tag.ObjectMethod:
            throw s.error("object methods aren't yet supported with `closConv`");
          case _kit.Tag.ArrowFunctionExpression:
            i.type = _kit.Tag.FunctionExpression;
          case _kit.Tag.FunctionExpression:
            if (!i.value.metaId) break;
            if (!i.value.opts.injectFuncMeta) throw s.error("`closConv` requires `injectFuncMeta`");
            const lab = s.label();
            const args = [];
            i.value.metaArgs[30] = args;
            args.push.apply(args, [s.enter(_kit.Tag.push, _kit.Tag.FunctionExpression), s.enter(_kit.Tag.params, _kit.Tag.Array), s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym: i.value.closureArgSym
            })].concat(_toConsumableArray(s.leave()), [s.enter(_kit.Tag.body, _kit.Tag.BlockStatement), s.enter(_kit.Tag.body, _kit.Tag.Array), s.enter(_kit.Tag.push, _kit.Tag.ReturnStatement)], _toConsumableArray(s.opts.closWrap ? [s.enter(_kit.Tag.argument, _kit.Tag.CallExpression), s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
              sym: Kit.sysId(s.opts.closWrap)
            }), s.enter(_kit.Tag.arguments, _kit.Tag.Array), s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym: i.value.closureArgSym
            }), s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym: i.value.metaId
            }), s.peel(Kit.setPos(i, _kit.Tag.push))] : [s.peel(Kit.setPos(i, _kit.Tag.argument))])));
            const id = s.cur();
            if (id.pos !== _kit.Tag.id) {
              // args.push(s.tok(Tag.id, Tag.Identifier, { sym: i.value.funcId }));
              args.push(s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
                sym: i.value.funcAlias
              }));
            } else id.value.sym = i.value.funcAlias;
            args.push.apply(args, _toConsumableArray(_closConv()).concat(_toConsumableArray(lab())));
            if (i.value.implFrame) args.push(s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym: i.value.implFrame.value.declSym
            }));
            args.push(s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym: i.value.errMapSym || Kit.scope.undefinedSym
            }));
            args.push(s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym: i.value.resMapSym || Kit.scope.undefinedSym
            }));
            yield s.enter(i.pos, _kit.Tag.CallExpression);
            yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
              sym: i.value.metaId
            });
            yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
            if (closureShortcuts === false) {
              if (i.value.captureParent && i.value.parScope && i.value.parScope.captureInChildren !== false && i.value.parScope.contextSym) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                sym: i.value.parScope.contextSym
              });else yield s.tok(_kit.Tag.push, _kit.Tag.NullLiteral);
            } else {
              if (i.value.closSavedDecls && i.value.closSavedDecls.size) {
                yield s.enter(_kit.Tag.push, _kit.Tag.ObjectExpression);
                yield s.enter(_kit.Tag.properties, _kit.Tag.Array);
                for (const [key, {
                  init
                }] of i.value.closSavedDecls) {
                  yield s.enter(_kit.Tag.push, _kit.Tag.ObjectProperty);
                  yield s.tok(_kit.Tag.key, _kit.Tag.Identifier, {
                    node: {
                      name: key.fieldName || key.orig
                    }
                  });
                  yield* Kit.reposOne(init, _kit.Tag.value);
                  yield* s.leave();
                }
              }
            }
            yield* lab();
            continue;
        }
      }
      yield i;
    }
  }
}
const parentTag = Kit.sysId("parentTag");

/**
 * adds declarations and constructions for context objects
 */
const contextDecls = exports.contextDecls = Kit.map(function contextDecls(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  const ctxSyms = [];
  const {
    topEff,
    contextSym
  } = root;
  const saved = root.savedDecls || (root.savedDecls = new Map());
  const decls = root.scopeDecls;
  for (const i of decls) if (i.interpr === Bind.ctxField && i.subField !== false) ctxSyms.push(i);
  // for not effectful function with captured
  const funcId = root.funcId;
  const funcAlias = root.funcAlias = Kit.scope.newSym(funcId ? funcId.orig : void 0);
  funcAlias.num = -funcAlias.num;
  funcAlias.strict = true;
  funcId.strict = false;
  // if (s.opts.closWrap) root.wrapId = funcId;
  if (s.opts.closWrap) root.wrapId = funcAlias;
  if (ctxSyms.length || root.opts.transform && (root.opts.scopeContext || root.opts.contextMethodOps)) {
    contextSym.bound = true;
    State.allUniqFields(ctxSyms, s.opts.closVarPrefix, s.opts.closVarPostfix);
    // needs both because after loop block scoping pure functions may have
    // same options (TODO: unify them)
    const constr = topEff ? s.opts.scopeConstructor : s.opts.pureScopeConstructor;
    const constrSym = root.constrSym = constr && Kit.sysId(constr);
    const wrapId = root.wrapId || root.closureArgSym;
    const thisExpr = wrapId && s.opts.thisField && root.origType === _kit.Tag.ArrowFunctionExpression ? [s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      sym: parentTag
    })] : [s.tok(_kit.Tag.push, _kit.Tag.ThisExpression)];
    const node = {};
    if (root.opts.bodyCommentHack) node.leadingComments = [{
      type: "CommentBlock",
      value: root.opts.bodyCommentHack
    }];
    saved.set(contextSym, {
      raw: null,
      init: constr ? [s.enter(_kit.Tag.init, _kit.Tag.CallExpression, {
        node
      }), s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
        sym: constrSym,
        ns: false
      }), s.enter(_kit.Tag.arguments, _kit.Tag.Array)].concat(_toConsumableArray(wrapId ? [s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
        sym: wrapId,
        keepClos: true
      })] : emptyArr), _toConsumableArray(root.opts.passNewTarget ? [].concat(thisExpr, [s.enter(_kit.Tag.push, _kit.Tag.MemberExpression), s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
        node: {
          name: "new"
        }
      }), s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
        node: {
          name: "target"
        }
      })], _toConsumableArray(s.leave())) : root.opts.passNewTarget === false && root.usesThis ? thisExpr : emptyArr), _toConsumableArray(s.leave()), _toConsumableArray(s.leave())) : [s.enter(_kit.Tag.init, _kit.Tag.ObjectExpression, {
        node
      }), s.enter(_kit.Tag.properties, _kit.Tag.Array)].concat(_toConsumableArray(prop(s.opts.varStorageField)), _toConsumableArray(prop(s.opts.closureStorageField !== s.opts.varStorageField && s.opts.closureStorageField)), _toConsumableArray(s.leave()), _toConsumableArray(s.leave()))
    });
  }
  return s;
  function* prop(name) {
    if (name) {
      yield s.enter(_kit.Tag.push, _kit.Tag.ObjectProperty);
      yield s.tok(_kit.Tag.key, _kit.Tag.Identifier, {
        node: {
          name
        }
      });
      yield s.enter(_kit.Tag.value, _kit.Tag.ObjectExpression);
      yield s.tok(_kit.Tag.properties, _kit.Tag.Array);
      yield* s.leave();
      yield* s.leave();
    }
  }
});

/** converts context fields identifier to JS member expression */
function substContextIds(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  const {
    opts,
    contextSym,
    ctxDeps
  } = root;
  const {
    closureShortcuts
  } = opts;
  const varsSubField = opts.varStorageField;
  const closSubField = opts.closureStorageField || varsSubField;
  const wrapCalls = !s.opts.noClosThis;
  if (!contextSym) return s;
  return walk();
  function* emitSubField(subField, pos) {
    if (subField && subField !== true) {
      yield s.enter(pos, _kit.Tag.MemberExpression);
      yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
        sym: contextSym,
        lhs: false,
        rhs: true,
        decl: false
      });
      yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
        node: {
          name: subField
        }
      });
      yield* s.leave();
    } else {
      yield s.tok(pos, _kit.Tag.Identifier, {
        sym: contextSym,
        lhs: false,
        rhs: true,
        decl: false
      });
    }
  }
  function* id(pos, sym, i) {
    (0, _kit.invariant)(sym.fieldName || sym.fieldName === null);
    const subField = sym.subField == null ? varsSubField : sym.subField;
    const lab = s.label();
    if (pos === _kit.Tag.callee && wrapCalls && i.value.parent.origType === _kit.Tag.CallExpression) {
      yield s.enter(pos, _kit.Tag.SequenceExpression);
      yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
      yield s.tok(_kit.Tag.push, _kit.Tag.NumericLiteral, {
        node: {
          value: 0
        }
      });
      pos = _kit.Tag.push;
    }
    if (sym.fieldName) {
      yield s.enter(pos, _kit.Tag.MemberExpression, {
        origSym: sym
      });
      pos = _kit.Tag.object;
    }
    if (ctxDeps && sym.declScope !== root) {
      const info = ctxDeps.get(sym.declScope);
      (0, _kit.invariant)(info);
      if (closureShortcuts === false) {
        if (!closSubField) throw s.error(`"closureShortcuts:false" requires "closureStorageField"`);
        const {
          distance
        } = info;
        (0, _kit.invariant)(distance > 0);
        if (subField) {
          yield s.enter(pos, _kit.Tag.MemberExpression);
          pos = _kit.Tag.object;
        }
        for (let i = 0; i < distance; i++) {
          yield s.enter(pos, _kit.Tag.MemberExpression);
          pos = _kit.Tag.object;
        }
        yield s.tok(pos, _kit.Tag.Identifier, {
          sym: contextSym,
          lhs: false,
          rhs: true,
          decl: false
        });
        for (let i = 0; i < distance; i++) {
          yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
            node: {
              name: closSubField
            }
          });
          yield* s.leave();
        }
        if (subField) {
          yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
            node: {
              name: varsSubField
            }
          });
          yield* s.leave();
        }
      } else {
        const {
          copy
        } = info;
        if (copy.interpr === Bind.ctxField) {
          (0, _kit.invariant)(copy.fieldName);
          yield s.enter(pos, _kit.Tag.MemberExpression, {
            origSym: copy
          });
          pos = _kit.Tag.object;
          yield* emitSubField(copy.subField || closSubField, pos);
          yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
            node: {
              name: copy.fieldName
            }
          });
          yield* s.leave();
        } else {
          yield s.tok(pos, _kit.Tag.Identifier, {
            sym: copy,
            lhs: false,
            rhs: true,
            decl: false
          });
        }
      }
    } else {
      yield* emitSubField(sym.subField == null ? varsSubField : sym.subField, pos);
    }
    if (sym.fieldName) yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
      node: {
        name: sym.fieldName
      }
    });
    yield* lab();
  }
  function* walk() {
    for (const i of s) {
      if (i.enter && i.type === _kit.Tag.Identifier) {
        const {
          sym
        } = i.value;
        if (!i.value.decl && sym && sym.interpr === Bind.ctxField && !i.value.keepClos) {
          yield* id(i.pos, sym, i);
          s.close(i);
          continue;
        }
      }
      yield i;
    }
  }
}

/** convert's a module's top level block into an export of IIFE */
function topToIIFE(si) {
  const s = Kit.auto(si);
  const modSym = s.first.value.modDescrSym = Kit.scope.newSym("$module");
  if (!s.opts.topIIFE) return s;
  const module = s.first.value;
  const exportsSym = Kit.sysId("wrapExport");
  module.hasEsImports = false;
  return _topToIIFE();
  function* _topToIIFE() {
    let prog;
    for (const i of s) {
      yield i;
      if (i.type === _kit.Tag.Program) prog = i.value;
      if (i.pos === _kit.Tag.body) break;
    }
    yield* s.template(_kit.Tag.push, `module.exports = $I($E)`, exportsSym);
    const lab = s.label();
    yield s.enter(_kit.Tag.push, _kit.Tag.FunctionExpression, {
      opts: module.opts,
      func: true,
      transform: module.transform,
      topEff: module.topEff,
      node: {
        loc: prog.node.loc
      },
      babelHoistReHack: true
    });
    module.transform = false;
    module.topEff = false;
    yield s.enter(_kit.Tag.params, _kit.Tag.Array);
    yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      node: {
        name: "module"
      }
    });
    yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      node: {
        name: "exports"
      }
    });
    yield* s.leave();
    yield s.enter(_kit.Tag.body, _kit.Tag.BlockStatement, {
      opts: prog.opts,
      node: {
        loc: prog.node.loc
      }
    });
    yield s.enter(_kit.Tag.body, _kit.Tag.Array);
    yield* s.sub();
    yield* lab();
    if (s.opts.injectModuleDescr) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      sym: modSym
    });
    yield* s.leave();
    yield* s;
  }
}

/** interprets `callProtocol` */
function convertCalls(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  if (!s.opts.callProtocol && !s.opts.newProtocol) return s;
  let tmpThis;
  return _convertCalls(s);
  function* _convertCalls(sw) {
    for (const i of sw) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.NewExpression:
            const {
              newProtocol
            } = s.opts;
            if (!newProtocol) break;
            let newName = s.opts.newName || "construct";
            const npLab = s.label();
            if (newProtocol === "op") {
              const sym = Kit.sysId(newName);
              yield s.enter(i.pos, Block.op, {
                sym
              });
              yield* Kit.reposOne(_convertCalls(s.one()), _kit.Tag.push);
            } else if (newProtocol === "method") {
              yield s.enter(i.pos, _kit.Tag.CallExpression, i.value);
              yield s.enter(_kit.Tag.callee, _kit.Tag.MemberExpression);
              yield* Kit.reposOne(_convertCalls(s.one()), _kit.Tag.object);
              yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
                node: {
                  name: newName
                }
              });
              yield* s.leave();
              yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
            } else throw s.error(`not supported newProtocol:"${newProtocol}"`);
            const neArgs = s.take();
            yield s.enter(_kit.Tag.push, _kit.Tag.ArrayExpression);
            yield s.enter(_kit.Tag.elements, _kit.Tag.Array);
            yield* _convertCalls(s.sub());
            s.close(neArgs);
            s.close(i);
            yield* npLab();
            continue;
          case _kit.Tag.CallExpression:
            const protocol = s.opts.callProtocol;
            if (!protocol) break;
            const name = s.opts.callName || protocol;
            const la = s.cur();
            const lab = s.label();
            let sym;
            if (la.type === _kit.Tag.MemberExpression) {
              s.take();
              let obj = s.cur();
              let pos = i.pos;
              if ((obj.type === _kit.Tag.Identifier || obj.type === Block.bindPat) && (sym = obj.value.sym)) {
                Kit.skip(s.one());
                sym = obj.value.sym;
              } else {
                if (!tmpThis) tmpThis = Bind.tempVarSym(root);
                sym = tmpThis;
                yield s.enter(i.pos, _kit.Tag.SequenceExpression);
                yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
                yield s.enter(_kit.Tag.push, _kit.Tag.AssignmentExpression, {
                  node: {
                    operator: "="
                  }
                });
                yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                  sym
                });
                yield* Kit.reposOne(_convertCalls(s.one()), _kit.Tag.right);
                yield* s.leave();
                pos = _kit.Tag.push;
                obj = s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
                  sym
                });
              }
              yield s.enter(pos, i.type, i.value);
              yield s.enter(_kit.Tag.callee, _kit.Tag.MemberExpression, la);
              yield s.enter(_kit.Tag.object, _kit.Tag.MemberExpression);
              yield s.tok(_kit.Tag.object, obj.type, obj.value);
              yield* _convertCalls(s.one());
              yield* s.leave();
              s.close(la);
            } else {
              sym = Kit.scope.undefinedSym;
              yield s.enter(i.pos, i.type, i.value);
              yield s.enter(_kit.Tag.callee, _kit.Tag.MemberExpression);
              yield* Kit.reposOne(_convertCalls(s.one()), _kit.Tag.object);
            }
            yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
              node: {
                name
              }
            });
            yield* s.leave();
            const args = s.take();
            yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
            yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
              sym
            });
            if (protocol === "apply") {
              yield s.enter(_kit.Tag.push, _kit.Tag.ArrayExpression);
              yield s.enter(_kit.Tag.elements, _kit.Tag.Array);
            }
            yield* _convertCalls(s.sub());
            s.close(args);
            s.close(i);
            yield* lab();
            continue;
        }
      }
      yield i;
    }
  }
}