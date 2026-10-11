"use strict";

exports.__esModule = true;
exports.addLabels = addLabels;
exports.dump = exports.dumbBindStmt = void 0;
exports.dumpDeps = dumpDeps;
exports.mark = exports.framesTxt = exports.dumpOld = exports.dumpEffBlock = void 0;
exports.markBindEff = markBindEff;
exports.singleFrameToks = singleFrameToks;
exports.singleFrameTxt = singleFrameTxt;
exports.traceOld = exports.traceAll = exports.trace = void 0;
var Kit = require("./kit");
var Trace = require("./kit/trace");
var _transducers = require("@effectful/transducers");
var D = require("@effectful/transducers/dump");
var T = require("@effectful/transducers/trace");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function isBindTok(v) {
  return isIf(v) || (0, _transducers.symInfo)(v.type).kind === "ctrl";
}
function isIf(v) {
  return v.pos === _transducers.Tag.consequent || v.pos === _transducers.Tag.alternate || v.type === _transducers.Tag.IfStatement || v.type === _transducers.Tag.ArrowFunctionExpression;
}
function* traceHighlight(s) {
  function flag(n, opts = {}) {
    const def = opts.val == null ? true : opts.val;
    const txt = opts.txt || n;
    const collapsed = opts.collapsed || false;
    const st = opts.st;
    const ste = opts.ste || st;
    const stl = opts.stl || st;
    return i => {
      const st = i.enter ? ste : stl;
      if (i.obj[n] === def) {
        i.collapsed = collapsed;
        i.flags.push(`${st == null ? "" : "%c"}${txt}`);
        if (st != null) i.flagsStyles.push(st);
      }
    };
  }
  const flags = [flag("eff", {
    ste: "color:red;font-size:large",
    stl: "color:orange;font-style:italic"
  }), flag("shallowEff", {
    ste: "color:red",
    stl: "color:orange;font-style:italic",
    val: true,
    txt: "shallow",
    collapsed: true
  }), flag("eff", {
    ste: "color:green",
    stl: "color:green;font-style:italic",
    val: false,
    txt: "pure",
    collapsed: true
  }), flag("bracket", {
    ste: "color:blue;font-size:large",
    stl: "color:skyblue;font-style:italic"
  })];
  for (const i of s) {
    flags.map(f => f(i));
    yield i;
  }
}
function pad(s) {
  if (s.length % 2) s += " ";
  const sps = Array(Math.max(20 - s.length / 2, 2)).join(" ");
  return sps + s + sps;
}
const traceOld = exports.traceOld = Kit.curry((prefix, s) => {
  console.log(`%c${pad(prefix)}%c`, `background:#2B81AF;color:#fff;font-size:xx-large;
              text-shadow:rgba(0, 0, 0, 0.5) 2px 2px 1px`, "");
  return Kit.pipe(Trace.of(Kit.pipe(Trace.highlight(v => v.type === Kit.Subst || isBindTok(v)), traceHighlight, Trace.prefix(prefix))), T.cleanComments, prefix[0] === "!" ? v => v : T.verify, Array.from)(s);
});
function hl(t, e, style) {
  return D.setComment(e, t, style || "large");
}
function hls(t, e, n) {
  return D.setComment(e, t, `small${n || ""}`);
}
function* dumpDeps(s) {
  for (const i of s) {
    yield i.enter && (i.value.deps != null || i.value.fdeps != null) ? hls("D:" + (i.value.deps ? JSON.stringify(i.value.deps.map(v => _toConsumableArray(v.fwd.keys() || []))) : `${i.value.fdeps.x} -> ${JSON.stringify(_toConsumableArray(i.value.fdeps.fwd.keys() || []))}`), i) : i;
  }
}
const dumbBindStmt = exports.dumbBindStmt = Kit.pipe(function* debDumbBindStmt(s) {
  for (const i of s) {
    switch ((0, _transducers.symName)(i.type)) {
      case "letStmt":
        const hasBind = i.value.sym != null;
        if (i.enter) {
          if (hasBind) {
            yield D.copyComment(i, D.setComment(Kit.enter(i.pos, _transducers.Tag.VariableDeclaration, {
              node: {
                kind: "var"
                // kind:"const"
              },
              eff: i.value.eff
            }), "S", "font-size:xx-large;color:orange"));
            yield Kit.enter(_transducers.Tag.declarations, _transducers.Tag.Array);
            yield Kit.enter(_transducers.Tag.push, _transducers.Tag.VariableDeclarator);
            yield Kit.tok(_transducers.Tag.id, _transducers.Tag.Identifier, {
              sym: i.value.sym
            });
            yield Kit.enter(_transducers.Tag.init, Kit.Subst);
          } else {
            yield D.copyComment(i, D.setComment(Kit.enter(i.pos, _transducers.Tag.ExpressionStatement, {
              node: {},
              eff: i.value.eff
            }), "S", "font-size:xx-large;color:orange"));
            yield Kit.enter(_transducers.Tag.expression, Kit.Subst);
          }
        }
        if (i.leave) yield* Kit.repeat(hasBind ? 4 : 2, Kit.leave());
        break;
      case "bindPat":
        if (i.enter) yield Kit.tok(i.pos, _transducers.Tag.Identifier, {
          sym: i.value.sym,
          node: i.value.node
        });
        break;
      default:
        yield i;
    }
  }
}, Kit.complete, Kit.completeSubst);
function* addLabels(s) {
  const sl = Kit.auto(s);
  const labs = {};
  function* walk(rename) {
    for (const i of sl.sub()) {
      if (i.value.ctrl) {
        if (i.enter) {
          const lab = sl.label();
          let pos = i.pos;
          const j = i.value.ctrl;
          if (j !== "#" && j !== "#ret") {
            let nm = j;
            nm = nm.replace("#", "_");
            const lx = labs[j] || 0;
            if (lx !== 0) nm += lx;
            labs[nm] = lx + 1;
            rename[j] = nm;
            yield sl.enter(pos, _transducers.Tag.LabeledStatement, {
              node: {
                label: {
                  type: "Identifier",
                  name: nm
                }
              }
            });
            pos = _transducers.Tag.body;
          }
          yield sl.peel(Kit.setPos(i, pos));
          yield* walk(Object.create(rename));
          yield* lab();
          continue;
        }
      }
      if (i.value.node != null && i.value.node.label != null) {
        const name = rename[i.value.node.label.name];
        if (name != null) i.value.node.label = {
          type: "Identifier",
          name
        };
      }
      yield i;
    }
  }
  yield* walk({});
}
const dumpEffBlock = exports.dumpEffBlock = Kit.pipe(function* dumpEffBlock(s) {
  const b = Kit.auto(s);
  function* walk() {
    for (const i of b.sub()) {
      switch ((0, _transducers.symName)(i.type)) {
        case "jump":
          if (i.enter) {
            yield D.copyComment(i, b.enter(i.pos, _transducers.Tag.CallExpression));
            yield Kit.tok(_transducers.Tag.callee, _transducers.Tag.Identifier, {
              node: {
                name: "jump"
              }
            });
            yield b.enter(_transducers.Tag.arguments, _transducers.Tag.Array);
            const d = i.value.node.dst;
            if (d != null) yield Kit.tok(_transducers.Tag.push, _transducers.Tag.StringLiteral, {
              node: {
                value: i.value.node.dst.name
              }
            });
            yield* walk();
            yield* b.leave();
            yield* b.leave();
          }
          break;
        case "scope":
          if (i.enter) {
            yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.BlockStatement), `$${i.value.node.name}`, "color:blue;font-size:large"));
            yield b.enter(_transducers.Tag.body, _transducers.Tag.Array);
            yield b.enter(_transducers.Tag.push, Kit.Subst);
            yield* walk();
            yield* b.leave();
            yield* b.leave();
            yield* b.leave();
          }
          break;
        case "writeState":
          if (i.enter) {
            yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.CallExpression, {
              node: {
                callee: {
                  type: "Identifier",
                  name: "write"
                }
              }
            }), `write`, "color:blue;font-size:large"));
            yield b.enter(_transducers.Tag.arguments, _transducers.Tag.Array);
            yield b.enter(_transducers.Tag.push, Kit.Subst);
            yield* walk();
            yield* b.leave();
            yield* b.leave();
            yield* b.leave();
          }
          break;
        case "forPar":
          if (i.enter) {
            yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.ArrowFunctionExpression, {
              node: {
                params: []
              }
            }), `PAR`, "color:blue;font-size:large"));
            yield b.enter(_transducers.Tag.body, _transducers.Tag.ForStatement);
            yield* walk();
            yield* b.leave();
            yield* b.leave();
          }
          break;
        case "effExpr":
          if (i.enter) {
            yield b.enter(i.pos, Kit.Subst);
            yield* walk();
            yield* b.leave();
          }
          break;
        case "chain":
          if (i.enter) {
            yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.BlockStatement), `..`, "color:blue;font-size:large"));
            yield b.enter(_transducers.Tag.body, _transducers.Tag.Array);
            yield* walk();
            yield* b.leave();
            yield* b.leave();
          }
          break;
        case "pure":
          if (i.enter) {
            yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.CallExpression, {
              node: {
                callee: {
                  type: "Identifier",
                  name: "pure"
                }
              }
            }), `..`, "color:blue;font-size:large"));
            yield b.enter(_transducers.Tag.arguments, _transducers.Tag.Array);
            yield b.enter(_transducers.Tag.push, Kit.Subst);
            yield* walk();
            yield* b.leave();
            yield* b.leave();
            yield* b.leave();
          }
          break;
        case "frame":
          if (i.enter) {
            const lab = b.label();
            let txt = `#${i.value.patSym && i.value.patSym.id || ""}`;
            if (i.value.bindsResult) txt += "_";
            if (i.value.hasStmts) txt += "=";
            yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.BlockStatement), txt, "color:blue;font-size:large"));
            yield b.enter(_transducers.Tag.body, _transducers.Tag.Array);
            yield b.enter(_transducers.Tag.push, Kit.Subst);
            yield* walk();
            yield* lab();
          }
          break;
        default:
          if (i.type.ctrl) {
            if (i.type.arg === "b") {
              if (i.enter) {
                yield D.copyComment(i, D.setComment(b.enter(i.pos, _transducers.Tag.BlockStatement), (0, _transducers.symName)(i.type), "color:blue;font-size:large"));
                yield b.enter(_transducers.Tag.body, _transducers.Tag.Array);
                yield b.enter(_transducers.Tag.push, Kit.Subst);
                yield* walk();
                yield* b.leave();
                yield* b.leave();
                yield* b.leave();
              }
              break;
            }
          }
          yield i;
      }
    }
  }
  yield* walk();
}, Kit.completeSubst);
function* dumpCasts(s) {
  const sl = Kit.auto(s);
  function* toExpr(pos) {
    const lab = sl.label();
    const b = sl.take();
    if (b.value.stmt) {
      yield hl("expr", sl.enter(pos, _transducers.Tag.CallExpression, {
        node: {
          arguments: []
        }
      }));
      yield sl.enter(_transducers.Tag.callee, _transducers.Tag.FunctionExpression, {
        node: {
          parameters: []
        }
      });
      if (b.type === _transducers.Tag.BlockStatement) yield sl.peel(Kit.setPos(b, _transducers.Tag.body));else {
        yield sl.enter(_transducers.Tag.body, _transducers.Tag.BlockStatement);
        yield sl.enter(_transducers.Tag.body, _transducers.Tag.Array);
        yield sl.peel(Kit.setPos(b, _transducers.Tag.push));
      }
    } else {
      yield sl.peel(Kit.setPos(b, pos));
    }
    yield* walk();
    yield* lab();
  }
  function* toBlock(pos) {
    const lab = sl.label();
    const b = sl.take();
    if (b.value.expr) {
      yield hl("block", sl.enter(_transducers.Tag.body, _transducers.Tag.ExpressionStatement));
      yield sl.peel(Kit.setPos(b, _transducers.Tag.expression));
    } else {
      if ((0, _transducers.symName)(b.type) === "castToBlock" || (0, _transducers.symName)(b.type) === "castToBody") {
        yield* toBlock(pos);
        return;
      }
      if (b.type === _transducers.Tag.BlockStatement) {
        yield sl.peel(Kit.setPos(b, pos));
      } else {
        yield sl.enter(pos, _transducers.Tag.BlockStatement);
        yield sl.enter(_transducers.Tag.body, _transducers.Tag.Array);
        yield sl.peel(Kit.setPos(b, _transducers.Tag.push));
      }
    }
    yield* walk();
    yield* lab();
  }
  function* walk() {
    for (const i of sl.sub()) {
      switch ((0, _transducers.symName)(i.type)) {
        case "castToExpr":
          if (i.enter) yield* toExpr(i.pos);
          break;
        case "castToBody":
        case "castToBlock":
          if (i.enter) yield* toBlock(i.pos);
          break;
        default:
          yield i;
      }
    }
  }
  yield* walk();
}
function* markBindEff(s) {
  for (let i of s) {
    if (i.enter) {
      if (i.value.bind) i = hls("B", i, "H");else if (i.value.bind === false) i = hls("P", i, "H");else if (i.value.eff) i = hls("E", i, "H");else if (i.value.shallowEff) i = hls("e", i, "H");
    }
    yield i;
  }
}
function* removeSubScopes(s) {
  for (const i of s) {
    if (i.enter && i.pos !== _transducers.Tag.top) {
      switch (i.type) {
        case _transducers.Tag.FunctionDeclaration:
          if (i.leave) {
            yield Kit.enter(i.pos, _transducers.Tag.ExpressionStatement);
            yield Kit.tok(_transducers.Tag.expression, _transducers.Tag.Identifier, {
              node: {
                name: "$$$"
              }
            });
            yield Kit.leave(i.pos, _transducers.Tag.ExpressionStatement);
            continue;
          }
          break;
        case _transducers.Tag.FunctionExpression:
        case _transducers.Tag.ArrowFunctionExpression:
          if (i.leave) {
            yield Kit.tok(i.pos, _transducers.Tag.Identifier, {
              node: {
                name: "$$$"
              }
            });
            continue;
          }
      }
    }
    yield i;
  }
}
const undefPatSym = Kit.scope.newSym("__");
function singleFrameTxt(frame, s) {
  const sa = Kit.toArray(s);
  if (sa.length === 0) return "<EMPTY>";
  const f = Kit.toArray(singleFrameToks(frame, sa));
  return D.toStr(D.fin(f), {
    comments: false
  });
}
function* singleFrameToks(frame, si) {
  const s = Kit.auto(si);
  yield* s.template(_transducers.Tag.push, `($I) => {$_}`, frame && frame.patSym || undefPatSym);
  yield* _frame();
  yield* s.leave();
  function* _frame() {
    for (const i of s.sub()) {
      if (i.enter) {
        switch ((0, _transducers.symName)(i.type)) {
          case "bindPat":
            yield s.tok(i.pos, _transducers.Tag.Identifier, {
              sym: i.value.sym
            });
            Kit.skip(s.copy(i));
            continue;
          case "app":
            yield* s.template(_transducers.Tag.push, `=$I($E)`, i.value.sym);
            if (!i.leave) yield* _frame();
            yield* s.leave();
            s.close(i);
            continue;
          case "letStmt":
            {
              const args = [];
              if (i.value.sym) args.push(i.value.sym);
              if (i.value.tmpVar) args.push(i.value.tmpVar);
              yield* s.template.apply(s, [_transducers.Tag.push, `=${i.value.sym ? "$I =" : ""}` + `${i.value.bindName || (i.value.eff ? "e" : "p")}` + `(${i.value.tmpVar ? "$I=" : ""}` + `$E${i.value.goto ? "," + i.value.goto.declSym.id : ""}` + `${i.value.indirGoto ? "," + i.value.indirGoto.declSym.id : ""}` + `,${i.value.id})`].concat(args));
              if (!i.leave) yield* Kit.reposOne(_frame(), i.value.tmpVar ? _transducers.Tag.right : _transducers.Tag.push);
              yield* s.leave();
            }
            s.close(i);
            continue;
          case "jump":
            {
              const args = [];
              if (i.value.tmpVar) args.push(i.value.tmpVar);
              if (i.value.goto) args.push(i.value.goto.declSym);
              yield* s.template.apply(s, [_transducers.Tag.push, `=${i.value.tmpVar ? "$I =" : ""}` + `j($E${i.value.goto ? "," + i.value.goto.declSym.id : ""}` + `${i.value.indirGoto ? "," + i.value.indirGoto.declSym.id : ""}` + `,${i.value.id})`].concat(args));
              if (!i.leave) yield* Kit.reposOne(_frame(), _transducers.Tag.push);
              yield* s.leave();
            }
            s.close(i);
            continue;
          case "fork":
            yield* s.template(_transducers.Tag.push, `=F($E)`, i.value.sym);
            yield* Kit.reposOne(_frame(), _transducers.Tag.push);
            yield* s.leave();
            s.close(i);
            continue;
        }
      }
      yield i;
    }
  }
}
const framesTxt = (opts = {}) => si => {
  const sa = Kit.toArray(si);
  const s = Kit.auto(sa);
  for (const i of s) {
    if (i.enter && (0, _transducers.symName)(i.type) === "frame") i.value[`deb_txt_${opts.name || ""}`] = singleFrameTxt(i.value, s.sub());
  }
  return sa;
};
exports.framesTxt = framesTxt;
const dumpPrep = Kit.pipe(addLabels, dumpDeps, dumbBindStmt, markBindEff, dumpEffBlock, dumpCasts, _transducers.scope.resolve);
const markOld = exports.mark = Kit.pipe(dumpPrep, D.fin);
// TODO: remove from tests

const dumpOld = exports.dumpOld = Kit.curry(function dumpConsole(tag, s) {
  s = Kit.toArray(s);
  D.toConsole(tag, dumpPrep(removeSubScopes(Kit.clone(s))));
  return s;
});
const emptySet = new Set();
const mark = Kit.pipe(T.cleanComments,
//  addLabels,
markBindEff, markFrameSyms);

/** adds flatten related comments */
function* markFrameSyms(s) {
  function id(i) {
    if (!i) return "-";
    let res = i.id;
    if (i.interpr) res += `#${i.interpr.$}`;
    if (i.numConst) res += `$${i.numConst}`;
    if (i.dummy) res += ".dummy";
    if (i.bound != null) {
      res += i.bound ? "+" : "-";
    }
    return res;
  }
  for (let i of s) {
    if (i.enter) {
      if (i.pos === _transducers.Tag.top) {
        let txt = "";
        if (i.value.savedDecls) txt += `|decls:[${_toConsumableArray(i.value.savedDecls.keys()).map(id).join(",")}]`;
        if (i.value.errSym) txt += `|errSym:[${id(i.value.errSym)}]`;
        if (i.value.resSym) txt += `|resSym:[${id(i.value.resSym)}]`;
        i = D.setComment(i, txt, "hl");
      }
      const v = i.value;
      if (v.funcId) i = D.setComment(i, `${v.funcId.id}`, "hl");
      if (v.sym) {
        i = D.setComment(i, `[${id(v.sym)}]`, "hl");
      }
      if (v.declSym != null) {
        let hndl = "";
        if (v.repeatStart) hndl += "|Repeat";
        if (v.catchCont) {
          if (v.catchCont.goto) hndl += `|Err{${v.catchCont.errSym ? id(v.catchCont.errSym) : "?"}<-${id(v.catchCont.goto.declSym)}}`;
          hndl += v.catchCont.frameArgs ? `|ErrArgs{${_toConsumableArray(v.catchCont.frameArgs).map(([k, v]) => `${id(k)}=${id(v)}`).join()}}` : "";
          if (v.catchCont.preCompose) hndl += `|ErrPre{${v.catchCont.preCompose.map(i => id(i.declSym) + "->" + (i.contArg ? id(i.contArg.declSym) : "")).join()}}`;
          if (v.catchCont.indirJumps && v.catchCont.indirJumps.size) hndl += `|ErrIndir{${_toConsumableArray(v.catchCont.indirJumps).map(([f, a]) => `${id(a.declSym)}->${id(f.declSym)}`).join()}}`;
        }
        if (v.resultCont) {
          if (v.resultCont.goto) hndl += `|Res{${id(v.resultCont.goto.declSym)}}`;
          if (v.resultCont.preCompose) hndl += `|ResPre{${v.resultCont.preCompose.map(i => id(i.declSym) + "->" + (i.contArg ? id(i.contArg.declSym) : "")).join()}}`;
          if (v.resultCont.indirJumps && v.resultCont.indirJumps.size) hndl += `|ResIndir{${_toConsumableArray(v.resultCont.indirJumps).map(([f, a]) => `${id(a.declSym)}->${id(f.declSym)}`).join()}}`;
        }
        if (v.catchContRedir) hndl += `|ErrRedir{${id(v.catchContRedir.declSym)}}`;
        if (v.resultContRedir) hndl += `|ResRedir{${id(v.resultContRedir.declSym)}}`;
        let fin = v.finallyCont && v.finallyCont.length ? `|Finally{${v.finallyCont.map(i => id(i.declSym)).join()}}` : "";
        const avail = v.frameAvail || emptySet;
        const locals = v.frameLocals || emptySet;
        const params = v.frameParams || emptySet;
        const clos = v.frameParamsClos || emptySet;
        const dst = v.dstClassParams || emptySet;
        const w = v.stateVars ? v.stateVars.w : emptySet;
        const r = v.stateVars ? v.stateVars.r : emptySet;
        const d = v.stateVars && v.stateVars.d || emptySet;
        const s = v.stateVars && v.stateVars.s || emptySet;
        const saved = v.savedDecls ? new Set(v.savedDecls.keys()) : emptySet;
        const all = new Set([].concat(_toConsumableArray(avail), _toConsumableArray(locals), _toConsumableArray(clos), _toConsumableArray(saved), _toConsumableArray(dst), _toConsumableArray(params), _toConsumableArray(w), _toConsumableArray(r), _toConsumableArray(d), _toConsumableArray(s)));
        if (v.patSym) all.add(v.patSym);
        if (v.errSym) all.add(v.errSym);
        if (v.sym) all.add(v.sym);
        const paramStr = all.size ? `|Params{${_toConsumableArray(all).map(i => id(i) + ":" + (avail.has(i) ? "A" : "") + (locals.has(i) ? "L" : "") + (params.has(i) ? "P" : clos.has(i) ? "p" : "") + (r.has(i) ? "R" : "") + (w.has(i) ? "W" : "") + (s.has(i) ? "!" : "") + (d.has(i) ? "d" : "") + (saved.has(i) ? "D" : "") + (i === v.sym ? "S" : "") + (!clos.has(i) && dst.has(i) ? "C" : "") + (i === v.errSym ? "E" : "") + (i === v.patSym ? "B" : ":")).join()}}` : "";
        i = D.setComment(i, `label{${id(v.declSym)}}${paramStr}${hndl}${fin}`, "hl");
        if (i.dstClass) i = D.setComment(i, `class{${id(i.dstClass.declSym)}}`);
      }
      if ((0, _transducers.symName)(i.type) === "letStmt" || (0, _transducers.symName)(i.type) === "jump") {
        let fin = v.preCompose && v.preCompose.length ? `|Pre{${v.preCompose.map(i => id(i.declSym) + "->" + (i.contArg ? id(i.contArg.declSym) : "")).join()}}` : "";
        let args = v.frameArgs ? `|Args{${_toConsumableArray(v.frameArgs).map(([k, v]) => `${id(k)}=${id(v)}`).join()}}` : "";
        if (v.indirJumps && v.indirJumps.size) args += `|Indir{${_toConsumableArray(v.indirJumps).map(([f, a]) => `${id(a.declSym)}->${id(f.declSym)}`).join()}}`;
        const thread = v.threadArgs && v.threadArgs.length ? `|Thread{${v.threadArgs.map(i => id(i[0]) + "<-" + id(i[1])).join()}}` : "";
        let dst = v.goto ? v.goto.declSym.id : "EXIT";
        if (v.goto && v.goto.instances) {
          const inst = _toConsumableArray(v.goto.instances).map(i => id(i.declSym)).join();
          dst = `|${dst}<${inst}>`;
        }
        if (v.indirGoto) dst = `${dst}~>${v.indirGoto.declSym.id}`;
        let name = v.result ? "ret" : "goto";
        if (v.ext) name += `.X-${v.ext.funcId.id}`;
        if (v.tmpVar) name += `.T-${v.tmpVar.id}`;
        if (v.contextSym) name += `.S-${v.contextSym.id}`;
        i = D.setComment(i, `${name}[${dst}${args}${thread}${fin}]#${i.value.id || "u"}`, "hl");
      }
    }
    yield i;
  }
}
const traceAll = exports.traceAll = Kit.curry((name, s) => T.all(name, mark(s)));
const trace = exports.trace = Kit.curry((name, s) => T.lazy(name, mark(s)));
const dump = exports.dump = Kit.curry((name, s) => D.output(name, name[0] === "-" ? T.cleanComments(s) : mark(s)));