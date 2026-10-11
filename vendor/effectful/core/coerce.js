"use strict";

exports.__esModule = true;
exports.block = void 0;
exports.cleanPureJumps = cleanPureJumps;
exports.expr = exports.coerceSymNs = exports.coerceSym = exports.coerceJsxSym = exports.coerceJsxManySym = void 0;
exports.inject = inject;
exports.interpret = interpret;
exports.jsx = jsx;
exports.lift = lift;
var _kit = require("./kit");
var Kit = _kit;
var Block = require("./block");
var Ctrl = require("./control");
const expr = exports.expr = (0, _kit.symbol)("coerceExpr", "ctrl");
const block = exports.block = (0, _kit.symbol)("coerceBlock", "ctrl");
const coerceSym = exports.coerceSym = Kit.sysId("coerce");
const coerceJsxSym = exports.coerceJsxSym = Kit.sysId("el");
const coerceJsxManySym = exports.coerceJsxManySym = Kit.sysId("els");
const coerceSymNs = exports.coerceSymNs = Kit.sysId("coerceNS");
coerceSymNs.nsDefault = true;

/**
 * if there is no coercing pure statement blocks must be turned into effectful
 */
function lift(s) {
  const sl = Kit.auto(s);
  function* walk() {
    for (const i of sl.sub()) {
      yield i;
      if (i.enter && i.value.eff) {
        switch (i.type) {
          case _kit.Tag.IfStatement:
            if (!i.value.eff) {
              yield* s.sub();
              break;
            }
            yield* sl.one();
            for (const j of sl.sub()) {
              yield j;
              if (j.enter) {
                j.value.eff = true;
                yield* walk();
              }
            }
            break;
          case _kit.Tag.SwitchStatement:
            // in switch each branch either ends in break or next branch
            // so it is enough to lift only the last one
            if (!i.value.eff) {
              yield* s.sub();
              break;
            }
            yield* sl.one();
            yield sl.peel();
            const lab = sl.label();
            for (const j of sl.sub()) {
              yield sl.peel(j);
              if (sl.cur().pos === _kit.Tag.test) {
                yield* sl.one();
                yield sl.peel();
                yield* walk();
              } else {
                yield sl.peel();
                const k = sl.peel();
                (0, _kit.invariant)(k.type === _kit.Tag.BlockStatement);
                k.value.eff = true;
                yield k;
                yield* walk();
              }
              yield* lab();
            }
            yield* sl.leave();
            break;
          case _kit.Tag.TryStatement:
            if (!i.value.eff) {
              yield* s.sub();
              break;
            }
            for (const j of sl.sub()) {
              yield j;
              if (j.enter) {
                switch (j.pos) {
                  case _kit.Tag.block:
                  case _kit.Tag.finalizer:
                  case _kit.Tag.body:
                    (0, _kit.invariant)(j.type === _kit.Tag.BlockStatement);
                    j.value.eff = true;
                    yield* walk();
                }
              }
            }
        }
      }
    }
  }
  return walk();
}
function inject(s) {
  const sl = Kit.auto(s);
  const coerce = sl.opts.coerce && !sl.opts.inlineCoerce;
  if (!coerce) return sl;
  const root = sl.first.value;
  return walk(sl);
  function* walk(sw) {
    for (const i of sw) {
      if (i.enter && i.type === Block.app) {
        if (i.value.static === false) {
          yield i;
          yield sl.enter(i.pos, expr);
          yield* walk(sl.one());
          yield* sl.leave();
          continue;
        }
        if (i.value.sym === root.pureId) {
          if (sl.curLev()) {
            const inner = Kit.toArray(sl.sub());
            inner[0].value.result = true;
            yield* inner;
          }
          sl.close(i);
          continue;
        }
      }
      yield i;
    }
  }
}
function interpret(s) {
  const sl = Kit.auto(s);
  if (!sl.opts.coerce) return sl;
  function* _interpret() {
    for (const i of sl.sub()) {
      switch (i.type) {
        case expr:
          if (i.enter) {
            const j = sl.curLev();
            if (!j) continue;
            switch (j.type) {
              case Block.effExpr:
                yield* Kit.reposOne(_interpret(), i.pos);
                continue;
            }
            const lab = sl.label();
            yield sl.enter(i.pos, Block.effExpr);
            yield sl.enter(_kit.Tag.expression, _kit.Tag.CallExpression);
            yield sl.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
              sym: coerceSymNs
            });
            yield sl.enter(_kit.Tag.arguments, _kit.Tag.Array);
            yield* Kit.reposOne(_interpret(), _kit.Tag.push);
            yield* lab();
          }
          continue;
      }
      yield i;
    }
  }
  return _interpret();
}
function cleanPureJumps(si) {
  const s = Kit.auto(si);
  if (!s.opts.coerce) return s;
  const root = s.first.value;
  const {
    pureExitFrame
  } = root;
  return _cleanPureJumps();
  function* _skip(i) {
    yield s.enter(i.pos, Block.effExpr, i.value);
    if (s.curLev()) {
      yield* Kit.reposOne(s.one(), i.pos);
    }
    if (!i.leave) Kit.skip(s.copy(i));
    yield* s.leave();
  }
  function* _cleanPureJumps() {
    for (const i of s) {
      if (i.enter) {
        switch (i.type) {
          case Block.app:
            if (i.value.sym === root.pureId) {
              yield* _skip(i);
              continue;
            }
            break;
          case Block.letStmt:
          case Ctrl.jump:
            if (i.value.goto === pureExitFrame) {
              yield* _skip(i);
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
 * Wraps each react element with specified in `opSym`/`bindName` operation
 */
function jsx(si) {
  const s = Kit.auto(si);
  if (!s.opts.jsxCoerce) return s;
  return _jsxCoerce(false);
  function* _emitCoerce(i, jsx, pos = i.pos, sym = coerceJsxSym) {
    if (jsx) {
      yield s.enter(pos, _kit.Tag.JSXExpressionContainer);
      pos = _kit.Tag.expression;
    }
    yield s.enter(pos, _kit.Tag.CallExpression, {
      bind: true
    });
    yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
      sym
    });
    yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
  }
  function* _jsxCoerce(jsx) {
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.JSXSpreadChild:
            yield i;
            const slab = s.label();
            yield* _emitCoerce(i, false, _kit.Tag.expression, coerceJsxManySym);
            yield* Kit.reposOne(_jsxCoerce(false), _kit.Tag.push);
            yield* slab();
            continue;
          case _kit.Tag.JSXExpressionContainer:
            yield i;
            if (i.pos === _kit.Tag.push) {
              const lab = s.label();
              yield* _emitCoerce(i, false, _kit.Tag.expression);
              yield* Kit.reposOne(_jsxCoerce(false), _kit.Tag.push);
              yield* lab();
              continue;
            }
            yield* _jsxCoerce(false);
            continue;
          case _kit.Tag.JSXElement:
            const lab = s.label();
            const {
              name
            } = i.value.node.openingElement;
            if (name.type === "JSXMemberExpression" || name.type === "JSXIdentifier" && name.name[0].toUpperCase() === name.name[0]) {
              yield* _emitCoerce(i, jsx);
              yield s.peel(Kit.setPos(i, _kit.Tag.push));
              yield* _jsxCoerce(true);
              yield* lab();
              continue;
            }
            yield i;
            yield* _jsxCoerce(true);
            continue;
          case _kit.Tag.JSXFragment:
          case _kit.Tag.JSX:
            yield i;
            yield* _jsxCoerce(true);
            continue;
        }
      }
      yield i;
    }
  }
}