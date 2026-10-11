"use strict";

exports.__esModule = true;
exports.default = void 0;
var Kit = require("./kit");
/**
 * babel plugin for common configuration
 *
 * This will replace any object expression with a value specified in its parameter.
 */
var _default = exports.default = Kit.babelPlugin(function* (si) {
  const s = Kit.auto(si);
  for (const i of s) {
    if (i.enter && i.type === Kit.Tag.ObjectExpression) {
      yield* Kit.emitConst(i.pos, s.opts.pluginOpts);
      Kit.skip(s.copy(i));
    } else yield i;
  }
});