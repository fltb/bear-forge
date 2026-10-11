"use strict";

exports.__esModule = true;
exports.cleanComments = cleanComments;
exports.color = void 0;
exports.copyComment = copyComment;
exports.dumpFin = void 0;
exports.markNodeType = markNodeType;
exports.toConsole = void 0;
exports.toStr = toStr;
var _kit = require("./kit");
var Kit = _kit;
var _generator = require("@babel/generator");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
const isNode = typeof window === "undefined";
function isEsNode(i) {
  return _kit.Tag[i.type] != null && i.type !== _kit.Tag.Array;
}
function* markNodeType(s) {
  for (const i of s) {
    if (i.enter && i.value.comments != null && i.value.comments.length) {
      i.value.comments.unshift({
        txt: ((0, _kit.symName)(i.type).match(/[A-Z]/g) || [(0, _kit.symName)(i.type)]).join(""),
        style: "font-size:xx-small;color:green;font-weight:bolder"
      });
    }
    yield i;
  }
}
const color = exports.color = isNode ? s => s : function* color(s) {
  for (const i of s) {
    if (i.enter && i.value.comments) {
      for (const j of i.value.comments) {
        if (j.style != null && isEsNode(i)) {
          j.txt = `%c${j.txt}%c`;
          j.args = [j.style, ""];
        }
      }
    }
    yield i;
  }
};
function* cleanNonEs(s) {
  const comments = [];
  for (const i of s) {
    if (_kit.Tag[i.type]) {
      if (i.type !== _kit.Tag.Array && i.enter && comments.length) {
        var _i$value$comments;
        if (i.value.comments == null) i.value.comments = [];
        (_i$value$comments = i.value.comments).push.apply(_i$value$comments, comments);
        comments.length = 0;
      }
      yield i;
    } else {
      if (i.enter && i.value.comments != null) comments.push.apply(comments, _toConsumableArray(i.value.comments));
    }
  }
}
function* getArgs(s) {
  for (const i of s) {
    if (i.enter && i.value.comments) {
      for (const j of i.value.comments) {
        if (j.args) for (const k of j.args) yield k;
      }
    }
  }
}
function* setComments(s) {
  for (const i of s) {
    const node = i.value.node;
    if (i.enter && node != null && i.value.comments != null && i.value.comments.length) {
      const cn = {
        type: "CommentBlock",
        value: ""
      };
      if (node.leadingComments) node.leadingComments.push(cn);else node.leadingComments = [cn];
      for (const {
        txt
      } of i.value.comments) {
        if (cn.value.length) cn.value += "|";
        cn.value += txt;
      }
    }
    yield i;
  }
}
const dumpFin = exports.dumpFin = Kit.pipe(cleanNonEs, setComments, Array.from);
const toConsole = exports.toConsole = Kit.curry(function toConsole(tag, s) {
  var _console;
  if (isNode) console.log(`dump ${tag}`);else console.group(`dump %c${tag}`, "color:orange;font-size:large");
  const col = Kit.pipe(cleanNonEs, color, Array.from)(s);
  const fin = Kit.pipe(setComments, Kit.finalize, Array.from)(col);
  const args = Array.from(getArgs(col));
  (0, _kit.consume)(fin);
  (_console = console).log.apply(_console, [(0, _generator.default)(fin[0].value.node).code].concat(args));
  if (!isNode) console.groupEnd();
});
function toStr(s) {
  const fin = dumpFin(s);
  (0, _kit.consume)(Kit.finalize(fin));
  return (0, _generator.default)(fin[0].value.node).code;
}
function copyComment(f, t) {
  Kit.invariant(t.enter);
  if (f.value.comments != null) {
    var _t$value$comments;
    if (t.value.comments == null) t.value.comments = [];
    (_t$value$comments = t.value.comments).push.apply(_t$value$comments, _toConsumableArray(f.value.comments));
  }
  return t;
}
function* cleanComments(s) {
  for (const i of s) {
    yield i;
    if (i.leave) i.value.comments = null;
  }
}