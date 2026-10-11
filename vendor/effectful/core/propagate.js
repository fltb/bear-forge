"use strict";

exports.__esModule = true;
exports.assignEff = assignEff;
exports.prepare = void 0;
exports.propagateEff = propagateEff;
exports.recalcEff = recalcEff;
var _kit = require("./kit");
var Kit = _kit;
function propagateEff(s) {
  const sa = Kit.toArray(s);
  const si = Kit.auto(sa);
  function func(i) {
    i.value.opts.transform ? sub(i.value) : skip();
    si.close(i);
  }
  function skip() {
    for (const i of si.sub()) if (i.enter && i.value.func) func(i);
  }
  function sub(root) {
    let res = false;
    const stack = [];
    function propagate(s) {
      res = true;
      for (const [v, i] of s) {
        const stop = v.eff;
        v.eff = true;
        if (v.ctrl) {
          v.ctrlEff = true;
        }
        if (i != null) {
          for (const j of i) propagate(j);
        }
        if (stop) break;
      }
    }
    function expr(i) {
      si.peel(i);
      let eff = i.value.eff || i.value.bind;
      for (const j of si.sub()) {
        if (j.value.func) {
          func(j);
          continue;
        }
        eff = expr(j) || eff;
      }
      switch (i.type) {
        case _kit.Tag.Array:
          break;
        default:
          i.value.eff = eff;
      }
      Kit.skip(si.leave());
      return eff;
    }
    const coerce = root.coerce || si.opts.coerce;
    for (const i of si.sub()) {
      if (i.enter) {
        if (i.value.func) {
          func(i);
          continue;
        }
        if (i.value.expr && i.pos !== _kit.Tag.top && !i.value.boundary) {
          if (expr(i)) stack[0][0].shallowEff = true;
          continue;
        }
        if (i.value.boundary) {
          const v = i.value;
          let info = [];
          if (v.ctrl != null && v.ctrl.length) {
            v.effDeps = info;
            if (v.ctrl === "#ret" && !coerce) v.bind = true;
          }
          stack.unshift([v, info]);
          if (v.block) {
            const l = v.block.effDeps;
            if (l == null) throw new Error(`no such label ${v.block.ctrl}`);
            if (v.block.eff) propagate(stack);else l.push(stack.concat());
          }
        }
      }
      if (i.leave) {
        if (i.value.boundary) {
          if (i.value.bind) {
            i.value.eff = false; // preventing the propagation's stop immediately
            propagate(stack);
            stack.shift();
          } else if (i.value.shallowEff || i.value.eff) {
            stack.shift();
            propagate(stack);
          } else {
            stack.shift();
          }
        }
      }
    }
    root.topEff = res;
  }
  func(si.take());
  return sa;
}
// lightweight version of propagateEff, it doesn't follow labels
// must be performed after AST was changed
function recalcEff(s) {
  const sa = Kit.toArray(s);
  const stack = [];
  for (const i of sa) {
    const v = i.value;
    if (i.enter && i.pos !== _kit.Tag.top) {
      v.eff = v.bind;
      v.shallowEff = null;
      stack.unshift(i);
      if (v.block) v.eff = v.eff || v.block.ctrlEff;
    }
    if (i.leave) {
      stack.shift();
      const j = stack[0];
      if (j != null) {
        const f = j.value;
        if (v.eff || v.shallowEff) {
          if (j.type === _kit.Tag.ForStatement && (i.pos === _kit.Tag.update || i.pos === _kit.Tag.test)) {
            f.eff = true;
          } else if (v.expr && f.stmt && !v.boundary) {
            f.shallowEff = true;
          } else {
            f.eff = true;
          }
        }
      }
    }
  }
  return sa;
}
function* assignEff(s) {
  for (const i of s) {
    switch (i.type) {
      case _kit.Tag.CallExpression:
        i.value.bind = i.value.eff = true;
        break;
    }
    yield i;
  }
}

/** in some positions VariableDeclarations aren't really statements,
 *  e.g. `for` statement init, so the pass marks them
 */
function* prepForStmtVarDecl(s) {
  const stack = [];
  for (const i of s) {
    switch (i.type) {
      case _kit.Tag.ForOfStatement:
      case _kit.Tag.ForInStatement:
      case _kit.Tag.ForStatement:
        if (i.enter) stack.unshift(i.level + 1);
        if (i.leave) stack.shift();
        break;
      case _kit.Tag.VariableDeclaration:
        if (stack[0] == i.level) {
          switch (i.pos) {
            case _kit.Tag.left:
            case _kit.Tag.init:
              if (i.enter) {
                i.value.stmt = false;
                i.value.expr = true;
                i.value.boundary = false;
                i.value.decl = true;
              }
              break;
          }
        }
        break;
    }
    if (stack[0] == i.level) {
      switch (i.pos) {
        case _kit.Tag.test:
        case _kit.Tag.update:
          i.value.boundary = true;
      }
    }
    yield i;
  }
}
const prepare = exports.prepare = Kit.pipe(prepForStmtVarDecl, Array.from);