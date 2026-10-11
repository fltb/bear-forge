"use strict";

exports.__esModule = true;
exports.replaceEvalDir = replaceEvalDir;
var Kit = require("./kit");
var Scope = require("./scope");
var Ctx = require("./context");
const {
  Tag
} = Kit;
const FLAGS = Scope.HAS_THIS_FLAG | Scope.HAS_ARGUMENTS_FLAG;
function replaceEvalDir() {
  const {
    root
  } = Ctx;
  const sym = Scope.sysSym("evalAt");
  for (let i = root.nextCallExpression, n; i !== root; i = n) {
    n = i.nextCallExpression;
    const callee = i.firstChild;
    if (callee.type === Tag.Identifier && callee.sym === Scope.evalSym) {
      Kit.replace(callee, Scope.sysId(Tag.callee, sym));
      const p = i.prevCallExpression;
      p.nextCallExpression = n;
      n.prevCallExpression = p;
      for (let j = i.parentFunc; j; j = j.parentFunc) {
        j.flags |= FLAGS;
        if (j.type !== Tag.ArrowFunctionExpression) break;
      }
    }
  }
}