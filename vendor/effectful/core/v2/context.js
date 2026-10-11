"use strict";

exports.__esModule = true;
exports.root = exports.file = void 0;
exports.setRoot = setRoot;
// stores current File's root node to avoid passing it to each function
let file = exports.file = null;
let root = exports.root = null;
function setRoot(r) {
  exports.root = root = r;
}