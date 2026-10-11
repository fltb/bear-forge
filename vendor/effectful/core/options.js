"use strict";

exports.__esModule = true;
exports.ifLoose = exports.ifDirectives = exports.ifDefunct = void 0;
var _kit = require("./kit");
const ifDirectives = exports.ifDirectives = (0, _kit.enableIf)(i => i.$ns && i.opts.directives !== false);
const ifLoose = exports.ifLoose = (0, _kit.enableIf)(i => i.opts.loose);
const ifDefunct = exports.ifDefunct = (0, _kit.enableIf)(i => i.opts.defunct);