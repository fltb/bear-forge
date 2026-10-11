"use strict";

exports.__esModule = true;
exports.arrowFunToBlock = arrowFunToBlock;
exports.funcWraps = funcWraps;
exports.injectMeta = injectMeta;
exports.restore = restore;
exports.splitScopes = splitScopes;
exports.subScopes = void 0;
var _kit = require("./kit");
var Kit = _kit;
var path = require("path");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
/**
 * unfortunately ObjectMethod type in babylon AST doesn't fit the split
 * pattern, as next passes want the key to remain in parent scope
 * so this pass replaces them to `{Object|Class}Property` and `FunctionExpression`
 * on restore the value is converted back
 * back to {Object|Class}Property with `restoreMethods`
 */
function methodsHack(si) {
  const s = Kit.auto(si);
  function* _methodsHack(sw, cl) {
    for (const i of sw) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.ClassDeclaration:
          case _kit.Tag.ClassExpression:
            yield i;
            const j = s.cur();
            i.value.classId = j.pos === _kit.Tag.id && j.value.sym;
            yield* _methodsHack(s.sub(), i.value);
            continue;
          case _kit.Tag.ClassMethod:
          case _kit.Tag.ClassPrivateMethod:
            i.value.ref = cl;
          case _kit.Tag.ObjectMethod:
            if (i.value.node.kind === "method") {
              yield s.enter(i.pos, i.type === _kit.Tag.ObjectMethod ? _kit.Tag.ObjectProperty : _kit.Tag.ClassProperty, {
                origType: i.type,
                node: {
                  computed: i.value.computed,
                  static: i.value.static
                }
              });
              const k = s.cur();
              yield* _methodsHack(s.one());
              yield s.enter(_kit.Tag.value, _kit.Tag.FunctionExpression, i.value);
              if (k.type === _kit.Tag.Identifier) {
                i.value.funcId = Kit.scope.newSym(k.value.node.name);
                i.value.origType = i.type;
                yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
                  node: {
                    name: k.value.node.name
                  }
                });
              }
              yield* _methodsHack(s.sub());
              yield* s.leave();
              yield* s.leave();
              s.close(i);
              continue;
            }
        }
      }
      yield i;
    }
  }
  return _methodsHack(s);
}

/**
 * restorinng `{Object|Class}Method` from `{Object|Class}ObjectProperty`
 * saved before using `methodsHack`
 */
function restoreMethods(si) {
  const s = Kit.auto(si);
  function* _restoreMethods(sw) {
    for (const i of sw) {
      if (i.enter && (i.type === _kit.Tag.ObjectProperty || i.type === _kit.Tag.ClassProperty) && i.value.origType != null && i.value.origType !== i.type) {
        const key = Kit.toArray(_restoreMethods(s.one()));
        if (s.cur().type === _kit.Tag.FunctionExpression) {
          const f = s.take();
          if (s.cur().pos === _kit.Tag.id) Kit.skip(s.one());
          yield s.enter(i.pos, i.value.origType, f.value);
          yield* key;
          yield* _restoreMethods(s.sub());
          yield* s.leave();
          s.close(f);
          s.close(i);
          continue;
        }
        yield i;
        yield* key;
        continue;
      } else if (i.enter && !i.leave && i.type === _kit.Tag.ClassExpression) {
        yield i;
        if (i.value.classId && s.cur().pos !== _kit.Tag.id) yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
          sym: i.value.classId
        });
      } else if (i.enter && !i.value.opts.closWrap && i.type === _kit.Tag.FunctionExpression && i.value.origType === _kit.Tag.FunctionDeclaration) {
        yield i;
        if (s.cur().pos === _kit.Tag.id) Kit.skip(s.one());
        yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
          sym: Kit.scope.newSym(i.value.funcId.name),
          decl: true
        });
      } else yield i;
    }
  }
  return _restoreMethods(s);
}

/**
 * takes a stream of tokens and split it into an array of streams
 * with each element representing a function from the original stream
 */
function splitScopes(si) {
  const s = Kit.auto(methodsHack(si));
  const module = s.first.value;
  const scopes = module.scopes = [];
  const frames = [];
  frames.push(_toConsumableArray(_splitScopes(s.take())));
  if (module.opts.metaParentClosure) {
    for (const i of scopes) {
      let sym = null;
      for (let j = i.parentScope; j && (sym = j.metaId); j = j.parentScope) break;
      i.metaArgs[20] = [sym ? s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
        sym
      }) : s.tok(_kit.Tag.push, _kit.Tag.NullLiteral)];
    }
  }
  return frames;
  function* _splitScopes(p) {
    yield s.enter(_kit.Tag.top, p.type, p.value);
    for (const i of s.sub()) {
      if (i.enter && !i.leave && s.curLev() != null && i.value.func) {
        frames.push(_toConsumableArray(_splitScopes(i)));
        // reversing to make closure parents go first
        scopes.unshift(i.value);
        i.value.parScope = p.value;
        i.value.module = module;
        if (!i.value.funcId) i.value.funcId = Kit.scope.newSym("fn");
        if (i.value.opts.wrapFunction) i.value.wrapId = i.type === _kit.Tag.FunctionExpression ? i.value.funcId : Kit.scope.newSym(i.value.funcId.orig);
        i.value.wrapArgs = [];
        if (i.value.opts.injectFuncMeta) {
          i.value.metaId = Kit.scope.newSym(`meta$${i.value.funcId.orig}`);
          i.value.metaArgs = {};
          i.value.wrapArgs.push(s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
            sym: i.value.metaId
          }));
        }
        yield s.tok(i.pos, i.type, i.value);
        continue;
      }
      yield i;
    }
    yield* s.leave();
    s.close(p);
  }
}
function injectMeta(si) {
  const s = Kit.auto(si);
  const module = s.first.value;
  if (!module.scopes.length) return s;
  return _injectMeta();
  function* _injectMeta() {
    for (const i of s) {
      yield i;
      if (i.pos === _kit.Tag.declarations) break;
    }
    yield* s.sub();
    const lab = s.label();
    if (module.memoVars && module.memoVars.size) {
      for (const [sym, init] of module.memoVars) {
        yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
        yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
          sym
        });
        yield* init;
        yield* s.leave();
      }
    }
    for (const i of module.scopes) {
      const name = i.opts.injectFuncMeta;
      if (!name) continue;
      const sym = Kit.sysId(name);
      yield s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator);
      yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
        sym: i.metaId
      });
      yield s.enter(_kit.Tag.init, _kit.Tag.CallExpression);
      yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
        sym
      });
      yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
      for (const j in i.metaArgs) yield* i.metaArgs[j];
      yield* lab();
    }
    yield* s;
  }
}

/**
 * converts list of token streams into a single stream with all scopes
 * unfolded in original positions
 */
function restore(root, scopes) {
  let start;
  const m = new Map();
  for (const i of scopes) {
    const value = i[0].value;
    if (value === root) start = i;else m.set(value, i);
  }
  (0, _kit.invariant)(start);
  return restoreMethods(_restore(start, _kit.Tag.top));
  function* _restore(si, pos, type) {
    const s = Kit.toArray(si);
    const first = s[0];
    if (!type) type = first.type;
    yield Kit.enter(pos, type, first.value);
    (0, _kit.invariant)(s[0].pos === _kit.Tag.top);
    (0, _kit.invariant)(s[s.length - 1].pos === _kit.Tag.top);
    (0, _kit.invariant)(s[s.length - 1].value === s[0].value);
    for (const i of s.slice(1, s.length - 1)) {
      if (i.value.func) {
        const sub = m.get(i.value);
        if (sub != null) {
          if (i.enter) {
            yield* _restore(sub, i.pos, i.type);
          }
          continue;
        }
      }
      yield i;
    }
    yield Kit.leave(pos, type, first.value);
  }
}

/** runs `pass` for each function in `s` */
const subScopes = exports.subScopes = Kit.curry(function (pass, s) {
  const res = [];
  for (const i of splitScopes(s)) res.push(_toConsumableArray(pass(i)));
  return restore(res);
});
const emptyMap = new Map();
function injectModuleDescr(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  if (!(s.opts.injectFuncMeta || s.opts.injectModuleMeta) || !root.hasEff) return s;
  const sym = root.modDescrSym;
  const postfix = s.opts.evalCtx ? "" : s.opts.staticBundler ? ",module" : ",module,require";
  const name = s.opts.injectModuleDescr && s.opts.injectModuleDescr.substr ? s.opts.injectModuleDescr : "module";
  return _injectModuleDescr();
  function* _injectModuleDescr() {
    for (const i of s) {
      yield i;
      if (i.enter && i.pos === _kit.Tag.body) break;
    }
    yield* s.template(_kit.Tag.push, `var $I = $I.${name}($E${postfix})`, {
      metaInfo: true
    }, sym, root.$ns);
    let module = s.opts.moduleName;
    if (module !== false) {
      if (module == null) {
        const {
          file
        } = s.opts;
        if (file) {
          module = file.filename;
          if (s.opts.srcRoot) {
            const root = s.opts.srcRoot === true ? file.root || file.cwd : s.opts.srcRoot;
            module = path.relative(root, module);
          }
          module = path.normalize(module);
          // we don't want the end user knows if we built this on windows
          if (Kit.isWindows) module = module.replace(/\\/g, "/");
        } else module = "*";
      }
      if (s.opts.moduleNamePrefix && typeof module === "string") module = `${s.opts.moduleNamePrefix}${module}`;
      yield* Kit.emitConst(_kit.Tag.push, module);
    }
    if (root.evalCtxSym) yield* Kit.emitConst(_kit.Tag.push, s.opts.evalCtx);
    yield* s.leave();
    for (const i of s) {
      if (i.enter && i.value.func && i.value.metaArgs) i.value.metaArgs[10] = [s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
        sym
      })];
      yield i;
    }
  }
}

/**
 * if `wrapFunction` is set for a function expression or declaration
 * it will be wrapped with the call to runtime function with a name
 * from the argument value
 */
function funcWraps(si) {
  const s = Kit.auto(injectModuleDescr(si));
  const root = s.first.value;
  const ns = root.$ns;
  const mods = root.injectRT || emptyMap;
  const rootDefs = mods.get(ns);
  return hoist(_funcWraps(s));
  function sysId(name) {
    const sym = Kit.sysId(name);
    if (rootDefs) rootDefs.usages.add(sym);
    return sym;
  }
  function check(i) {
    if (i.value.topEff && i.value.opts.transform) {
      if (i.value.opts.wrapFunction) return true;
      if (i.value.opts.defunctHandlerInProto && !i.value.opts.closConv) throw s.error("`defunctHandlerInProto` requires `wrapFunction` or `closConv`");
    }
    return false;
  }
  function* implFrame(root) {
    if (root.wrapArgs) yield* root.wrapArgs;
    if (!root.opts.defunctHandlerInProto) return;
    if (!root.opts.defunct) throw s.error("`defunctHandlerInProto` requires `defunct`");
    const sym = root.implFrame && root.implFrame.value.declSym;
    if (!sym) return;
    if (root.opts.topLevel) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      sym
    });else yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      sym: Kit.scope.undefinedSym
    });
    yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      sym: root.errMapSym || Kit.scope.undefinedSym
    });
    yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
      sym: root.resMapSym || Kit.scope.undefinedSym
    });
  }
  function hoist(si) {
    const s = Kit.auto(Kit.toArray(si));
    let nsFound = !root.nsImported;
    return _hoist(s);
    function* _hoist(sw, subst) {
      for (const i of sw) {
        if (i.enter) {
          switch (i.type) {
            case _kit.Tag.ClassDeclaration:
            case _kit.Tag.ClassExpression:
              if (i.value.wraps.length) {
                const decl = i.type === _kit.Tag.ClassDeclaration;
                const lab = s.label();
                let pos = i.pos;
                let sym;
                let slab;
                if (decl) {
                  sym = s.cur().value.sym;
                  (0, _kit.invariant)(sym);
                  if (i.pos !== _kit.Tag.push) {
                    yield s.enter(i.pos, _kit.Tag.BlockStatement);
                    yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                    pos = _kit.Tag.push;
                  }
                  slab = s.label();
                } else {
                  yield s.enter(pos, _kit.Tag.SequenceExpression);
                  yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
                  slab = s.label();
                }
                for (const j of i.value.wraps) {
                  if (!j.keySimple) {
                    const sym = j.key[0].value.substTempVar;
                    yield s.enter(_kit.Tag.push, _kit.Tag.AssignmentExpression, {
                      node: {
                        operator: "="
                      }
                    });
                    yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                      sym
                    });
                    yield* Kit.reposOne(j.key, _kit.Tag.right);
                    yield* s.leave();
                    j.key = [s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
                      sym
                    })];
                  }
                }
                if (!decl) {
                  sym = i.value.wrapsTempVar;
                  yield s.enter(_kit.Tag.push, _kit.Tag.AssignmentExpression, {
                    node: {
                      operator: "="
                    }
                  });
                  yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                    sym
                  });
                  pos = _kit.Tag.right;
                }
                yield s.peel(Kit.setPos(i, pos));
                const nsubst = new Map();
                for (const j of i.value.wraps) {
                  nsubst.set(j.wrapId, j.buf = _toConsumableArray(function* () {
                    yield s.enter(_kit.Tag.push, _kit.Tag.MemberExpression, {
                      node: {
                        computed: j.computed
                      }
                    });
                    if (j.static) {
                      yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
                        sym
                      });
                    } else {
                      yield s.enter(_kit.Tag.object, _kit.Tag.MemberExpression);
                      yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
                        sym
                      });
                      yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
                        node: {
                          name: "prototype"
                        }
                      });
                      yield* s.leave();
                    }
                    yield* Kit.reposOne(j.key, _kit.Tag.property);
                    yield* s.leave();
                    if (j.params) yield* j.params;
                  }()));
                }
                yield* _hoist(s.sub(), nsubst);
                yield* slab();
                if (decl) {
                  yield s.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
                  yield s.enter(_kit.Tag.expression, _kit.Tag.SequenceExpression);
                  yield s.enter(_kit.Tag.expressions, _kit.Tag.Array);
                }
                const elab = s.label();
                for (const {
                  name,
                  ns,
                  buf
                } of i.value.wraps) {
                  yield s.enter(_kit.Tag.push, _kit.Tag.CallExpression);
                  yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
                    sym: sysId(name),
                    ns
                  });
                  yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
                  yield* buf;
                  yield* elab();
                }
                if (!decl) yield s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                  sym
                });
                yield* lab();
                continue;
              }
              break;
            case _kit.Tag.ClassPrivateMethod:
            case _kit.Tag.ClassMethod:
            case _kit.Tag.ClassProperty:
            case _kit.Tag.ClassPrivateProperty:
              yield i;
              const ksym = s.cur().value.substTempVar;
              if (ksym) {
                yield s.tok(_kit.Tag.key, _kit.Tag.Identifier, {
                  sym: ksym
                });
                Kit.skip(s.one());
              }
              continue;
            case _kit.Tag.Identifier:
              let substBuf;
              const {
                sym
              } = i.value;
              if (sym) {
                if (subst && i.pos !== _kit.Tag.property && (substBuf = subst.get(i.value.sym))) {
                  yield* Kit.clone(substBuf);
                } else {
                  yield* s.copy(i);
                }
                if (sym === ns && i.value.lhs) {
                  const j = s.cur();
                  if (!j || !j.leave || j.type !== _kit.Tag.VariableDeclarator) nsFound = true;
                }
                continue;
              }
              break;
            case _kit.Tag.Program:
              if (i.value.wraps.length) {
                const lab = s.label();
                yield s.peel(i);
                yield* s.peelTo(_kit.Tag.body);
                while (s.curLev() && !nsFound) yield* _hoist(s.one(), subst);
                yield* Kit.skipTillFileBeg(s);
                yield* i.value.wraps;
                yield* _hoist(s.sub(), subst);
                yield* lab();
                continue;
              }
              break;
            case _kit.Tag.BlockStatement:
              if (i.value.wraps && i.value.wraps.length) {
                const lab = s.label();
                yield s.peel(i);
                yield* s.peelTo(_kit.Tag.body);
                yield* i.value.wraps;
                yield* _hoist(s.sub(), subst);
                yield* lab();
                continue;
              }
              break;
          }
        }
        yield i;
      }
    }
  }
  function* _funcWraps(sw, block, classKeys, classMethods) {
    function tempVar(name, sym = Kit.scope.newSym(name)) {
      const lab = s.label();
      block.push(s.enter(_kit.Tag.push, _kit.Tag.VariableDeclaration, {
        node: {
          kind: "var"
        }
      }), s.enter(_kit.Tag.declarations, _kit.Tag.Array), s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator), s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
        sym,
        decl: true
      }));
      block.push.apply(block, _toConsumableArray(lab()));
      return sym;
    }
    for (const i of sw) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.Program:
          case _kit.Tag.BlockStatement:
            yield i;
            yield* _funcWraps(s.sub(), i.value.wraps = []);
            continue;
          case _kit.Tag.ObjectMethod:
            if (check(i)) {
              const lab = s.label();
              yield s.peel(Kit.setType(i, _kit.Tag.ObjectProperty));
              yield* s.one();
              yield s.enter(_kit.Tag.value, _kit.Tag.CallExpression);
              yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
                ns: i.value.$ns,
                sym: sysId(i.value.opts.wrapFunction)
              });
              yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
              yield s.enter(_kit.Tag.push, _kit.Tag.FunctionExpression);
              yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
                sym: i.value.wrapId
              });
              yield* _funcWraps(s.sub(), block);
              yield* s.leave();
              yield* implFrame(i.value);
              yield* lab();
              continue;
            }
            break;
          case _kit.Tag.ClassPrivateMethod:
          case _kit.Tag.ClassMethod:
          case _kit.Tag.ClassProperty:
          case _kit.Tag.ClassPrivateProperty:
            if (!check(i)) break;
            yield i;
            let key = Kit.toArray(_funcWraps(s.one(), block));
            yield* key;
            let keySimple = false;
            let computed = i.value.node.computed;
            switch (key[0].type) {
              case _kit.Tag.Identifier:
              case _kit.Tag.StringLiteral:
              case _kit.Tag.NumericLiteral:
              case _kit.Tag.BooleanLiteral:
                keySimple = true;
                break;
              case _kit.Tag.MemberExpression:
                keySimple = key[1].type === _kit.Tag.Identifier && key[1].value.sym === Kit.scope.SymbolSym;
                break;
            }
            if (!keySimple) classKeys.push(key);
            yield* _funcWraps(s.sub(), block);
            if (check(i) && i.value.node.kind === "method") classMethods.push({
              key,
              keySimple,
              static: i.value.node.static,
              computed,
              name: i.value.opts.wrapFunction,
              wrapId: i.value.wrapId,
              ns: i.value.$ns,
              params: _toConsumableArray(implFrame(i.value))
            });
            continue;
          case _kit.Tag.ClassExpression:
          case _kit.Tag.ClassDeclaration:
            yield i;
            const keys = [];
            const wraps = i.value.wraps = [];
            yield* _funcWraps(s.sub(), block, keys, wraps);
            if (!wraps.length) continue;
            if (wraps.some(i => !i.keySimple)) {
              for (const j of keys) j[0].value.substTempVar = tempVar();
            }
            if (i.value.wraps.length && i.type === _kit.Tag.ClassExpression) {
              i.value.wrapsTempVar = tempVar(i.value.node.id && i.value.node.id.name);
            }
            continue;
          case _kit.Tag.FunctionDeclaration:
            if (check(i) && i.value.funcId) {
              const lab = s.label();
              const wraps = [s.enter(_kit.Tag.push, _kit.Tag.VariableDeclaration, {
                node: {
                  kind: "var"
                }
              }), s.enter(_kit.Tag.declarations, _kit.Tag.Array), s.enter(_kit.Tag.push, _kit.Tag.VariableDeclarator), s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
                sym: i.value.wrapId,
                decl: true
              }), s.enter(_kit.Tag.init, _kit.Tag.CallExpression), s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
                ns: i.value.$ns,
                sym: sysId(i.value.opts.wrapFunction)
              }), s.enter(_kit.Tag.arguments, _kit.Tag.Array), s.tok(_kit.Tag.push, _kit.Tag.Identifier, {
                sym: i.value.funcId
              })].concat(_toConsumableArray(implFrame(i.value)), _toConsumableArray(lab()));
              if (i.pos === _kit.Tag.push || i.pos === _kit.Tag.declaration) {
                yield s.peel(i);
                yield* _funcWraps(s.sub());
                yield* s.leave();
                block.push.apply(block, _toConsumableArray(wraps));
              } else {
                yield s.enter(i.pos, _kit.Tag.BlockStatement);
                yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                yield* wraps;
                yield s.peel(i);
                yield* Kit.reposOne(_funcWraps(s.sub(), block), _kit.Tag.push);
                yield* s.leave();
              }
              yield* lab();
              continue;
            }
            break;
          case _kit.Tag.FunctionExpression:
            if (check(i)) {
              const lab = s.label();
              yield s.enter(i.pos, _kit.Tag.CallExpression);
              yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
                ns: i.value.$ns,
                sym: sysId(i.value.opts.wrapFunction)
              });
              yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
              yield s.peel(Kit.setPos(i, _kit.Tag.push));
              if (s.cur().pos !== _kit.Tag.id) yield s.tok(_kit.Tag.id, _kit.Tag.Identifier, {
                sym: i.value.wrapId
              });else s.cur().value.sym = i.value.wrapId;
              yield* _funcWraps(s.sub(), block);
              yield* s.leave();
              yield* implFrame(i.value);
              yield* lab();
              continue;
            }
            break;
          case _kit.Tag.ArrowFunctionExpression:
            if (check(i)) {
              const lab = s.label();
              tempVar(null, i.value.wrapId);
              yield s.enter(i.pos, _kit.Tag.AssignmentExpression, {
                node: {
                  operator: "="
                }
              });
              yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                sym: i.value.wrapId
              });
              yield s.enter(_kit.Tag.right, _kit.Tag.CallExpression);
              yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
                ns: i.value.$ns,
                sym: sysId(i.value.opts.wrapFunction)
              });
              yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
              yield s.peel(Kit.setPos(i, _kit.Tag.push));
              yield* _funcWraps(s.sub(), block);
              yield* s.leave();
              yield* implFrame(i.value);
              yield* lab();
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
 * if arrow function has expression, converts it into block statement
 * with return to simplify next steps
 */
function arrowFunToBlock(si) {
  const s = Kit.auto(si);
  return _arrowFunToBlock(s);
  function* _arrowFunToBlock(sw) {
    for (const i of sw) {
      yield i;
      if (i.enter && i.type === _kit.Tag.ArrowFunctionExpression && i.value.opts.transform) {
        i.value.node.expression = false;
        while (s.cur().pos !== _kit.Tag.body) yield* _arrowFunToBlock(s.one());
        if (s.cur().type !== _kit.Tag.BlockStatement) {
          const lab = s.label();
          yield s.enter(_kit.Tag.body, _kit.Tag.BlockStatement, {
            decls: s.cur().value.decls,
            node: {
              loc: i.value.node.loc
            }
          });
          yield s.enter(_kit.Tag.body, _kit.Tag.Array);
          yield s.enter(_kit.Tag.push, _kit.Tag.ReturnStatement, {
            node: {
              loc: i.value.node.loc
            }
          });
          yield* Kit.reposOne(_arrowFunToBlock(s.one()), _kit.Tag.argument);
          yield* lab();
        }
      }
    }
  }
}