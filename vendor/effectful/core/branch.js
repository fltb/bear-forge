"use strict";

exports.__esModule = true;
exports.addAlternate = addAlternate;
exports.clean = clean;
exports.fork = void 0;
exports.normalizeSwitch = normalizeSwitch;
exports.thread = void 0;
exports.toBlocks = toBlocks;
var _kit = require("./kit");
var Kit = _kit;
var Bind = require("./bind");
const fork = exports.fork = (0, _kit.symbol)("branch.fork");
const thread = exports.thread = (0, _kit.symbol)("branch.thread");

/**
 * if switch statement contains effects in tests it will resort to
 * a chain of if-statements
 */
function normalizeSwitch(si) {
  const sa = Kit.toArray(si);
  let any = false;
  mark();
  return any ? convert() : sa;
  function mark() {
    const s = Kit.auto(sa);
    return walk();
    function stmt(i) {
      i.value.useIfs = false;
      for (const j of s.sub()) {
        if (j.enter) {
          if (j.type === _kit.Tag.SwitchCase) {
            const k = s.curLev();
            if (k && k.pos === _kit.Tag.test && k.value.eff) {
              i.value.useIfs = true;
              any = true;
              break;
            }
          } else if (j.type === _kit.Tag.SwitchStatement && i.value.eff) {
            stmt(j);
          }
        }
      }
    }
    function walk() {
      for (const i of s.sub()) {
        if (i.enter && i.type === _kit.Tag.SwitchStatement && i.value.eff) {
          stmt(i);
        }
      }
    }
  }
  function convert() {
    const s = Kit.auto(sa);
    return walk();
    function* walk() {
      for (const i of s.sub()) {
        if (i.enter && i.type === _kit.Tag.SwitchStatement && i.value.useIfs) {
          const lab = s.label();
          if (i.pos !== _kit.Tag.push) {
            yield s.enter(i.pos, _kit.Tag.BlockStatement);
            yield s.enter(_kit.Tag.body, _kit.Tag.Array);
          }
          const ilab = s.label();
          const sym = Bind.tempVarSym(s.first.value, "pat");
          // sym.singleAssign = true;
          yield s.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
          yield s.enter(_kit.Tag.expression, _kit.Tag.AssignmentExpression, {
            node: {
              operator: "="
            }
          });
          yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
            sym,
            lhs: true,
            rhs: false,
            decl: false
          });
          yield* Kit.reposOne(s.one(), _kit.Tag.right);
          yield* ilab();
          for (const j of s.sub()) {
            if (j.type === _kit.Tag.SwitchCase) {
              if (s.cur().pos === _kit.Tag.test) {
                yield s.enter(_kit.Tag.push, _kit.Tag.IfStatement);
                yield s.enter(_kit.Tag.test, _kit.Tag.BinaryExpression, {
                  node: {
                    operator: "==="
                  }
                });
                yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
                  sym,
                  lhs: false,
                  rhs: true,
                  decl: false
                });
                yield* Kit.reposOne(s.one(), _kit.Tag.right);
                yield* s.leave();
                yield s.enter(_kit.Tag.consequent, _kit.Tag.BlockStatement);
                yield* Kit.repos(walk(), _kit.Tag.body);
              } else {
                const conseq = s.take();
                (0, _kit.invariant)(conseq.pos === _kit.Tag.consequent);
                yield* walk();
                s.close(conseq);
              }
              yield* ilab();
              s.close(j);
            }
          }
          yield* lab();
          s.close(i);
          continue;
        }
        yield i;
      }
    }
  }
}

/** adds block statement to block-less branches */
function toBlocks(si) {
  const s = Kit.auto(si);
  function* walk() {
    for (const i of s.sub()) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.SwitchStatement:
            if (i.value.eff) {
              const lab = s.label();
              yield s.enter(i.pos, _kit.Tag.BlockStatement, i.value);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              yield s.enter(_kit.Tag.push, _kit.Tag.SwitchStatement, {
                origSwitch: i.value,
                node: {
                  loc: i.value.node && i.value.node.loc
                }
              });
              yield* walk();
              yield* lab();
              s.close(i);
              continue;
            }
            break;
          case _kit.Tag.ConditionalExpression:
            yield i;
            yield* s.sub();
            continue;
        }
        switch (i.pos) {
          case _kit.Tag.consequent:
          case _kit.Tag.alternate:
            const lab = s.label();
            if (i.type === _kit.Tag.Array) {
              // switch/case
              yield i;
              yield s.enter(_kit.Tag.push, _kit.Tag.BlockStatement);
              yield s.enter(_kit.Tag.body, _kit.Tag.Array);
              yield* walk();
            } else if ((0, _kit.symInfo)(i.type).expr) {
              yield i;
              continue;
            } else {
              if (i.type !== _kit.Tag.BlockStatement || i.value.ctrl) {
                yield s.enter(i.pos, _kit.Tag.BlockStatement);
                yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                yield s.peel(Kit.setPos(i, _kit.Tag.push));
              } else yield i;
              yield* walk();
            }
            yield* lab();
            continue;
        }
      }
      yield i;
    }
  }
  return walk();
}

/** removes empty branches */
function* clean(s) {
  s = Kit.auto(s);
  for (const i of s) {
    if (i.enter) {
      switch (i.pos) {
        case _kit.Tag.alternate:
          if (i.type === _kit.Tag.BlockStatement && i.value.node.loc == null) {
            const buf = [];
            const j = Kit.result(s.findPos(_kit.Tag.body), buf);
            if (j.value === s.cur().value) {
              i.value.empty = true;
              Kit.skip(s.till(v => v.leave && v.pos === _kit.Tag.alternate));
              continue;
            }
            yield i;
            yield* buf;
            yield j;
            continue;
          }
      }
    }
    yield i;
  }
}

/**
 * for each effectful branching statements adds alternate statement
 * if it doesn't exists
 */
function addAlternate(si) {
  const s = Kit.auto(si);
  function* walk(sw) {
    for (const i of sw) {
      if (i.enter) {
        switch (i.type) {
          case _kit.Tag.IfStatement:
            if (i.value.eff) {
              yield i;
              yield* walk(s.one());
              yield* walk(s.one());
              if (!s.curLev()) {
                yield s.enter(_kit.Tag.alternate, _kit.Tag.BlockStatement);
                yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                yield* s.leave();
                yield* s.leave();
              }
              continue;
            }
            break;
          case _kit.Tag.SwitchStatement:
            if (i.value.eff) {
              yield i;
              yield* s.one();
              yield s.peel();
              let found = false;
              for (const j of s.sub()) {
                yield j;
                if (s.cur().pos === _kit.Tag.consequent) found = true;
                yield* walk(s.sub());
                yield s.close(j);
              }
              if (!found) {
                yield s.enter(_kit.Tag.push, _kit.Tag.SwitchCase);
                yield s.enter(_kit.Tag.consequent, _kit.Tag.Array);
                yield* s.leave();
                yield* s.leave();
              }
              yield* s.leave();
              yield s.close(i);
              continue;
            }
            break;
        }
      }
      yield i;
    }
  }
  return walk(s);
}