"use strict";

exports.__esModule = true;
exports.openBlock = openBlock;
exports.openVarDecl = openVarDecl;
exports.peelBlockFrom = peelBlockFrom;
var _transducers = require("@effectful/transducers");
var _core = require("./core");
function* openVarDecl(idNode, s, kind = "var") {
  const value = idNode.node === null ? {
    node: idNode,
    lhs: true,
    decl: true,
    rhs: false
  } : idNode;
  yield s.enter(_transducers.Tag.init, _transducers.Tag.VariableDeclaration, {
    node: {
      kind
    }
  });
  yield s.enter(_transducers.Tag.declarations, _transducers.Tag.Array);
  yield s.enter(_transducers.Tag.push, _transducers.Tag.VariableDeclarator);
  yield (0, _core.tok)(_transducers.Tag.id, _transducers.Tag.Identifier, value);
}
function* openBlock(pos, s) {
  yield s.enter(pos, _transducers.Tag.BlockStatement);
  yield s.enter(_transducers.Tag.push, _transducers.Tag.Array);
}
function* peelBlockFrom(s) {
  const i = s.cur();
  if (i != null && i.type === _transducers.Tag.BlockStatement) {
    yield s.peel();
    yield* s.peelTo(_transducers.Tag.body);
  } else {
    yield s.enter(i.pos, _transducers.Tag.BlockStatement);
    yield s.enter(_transducers.Tag.body, _transducers.Tag.Array);
    yield s.enter(_transducers.Tag.push, _core.Subst);
  }
}