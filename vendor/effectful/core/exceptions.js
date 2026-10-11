"use strict";

exports.__esModule = true;
exports.handleId = exports.finallyId = void 0;
exports.inject = inject;
var _kit = require("./kit");
var Kit = _kit;
var Block = require("./block");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
const handleId = exports.handleId = Kit.sysId("handle");
const finallyId = exports.finallyId = Kit.sysId("finally");

/** injects `Block.app` for try-catch statements */
function* inject(s) {
  const sl = Kit.auto(s);
  const root = sl.first.value;
  const raiseId = root.raiseId || (root.raiseId = Kit.sysId(s.opts.raiseName || "raise"));
  function* walk(sw) {
    for (const i of sw) {
      if (i.value.eff) {
        switch (i.type) {
          case _kit.Tag.TryStatement:
            if (i.enter) {
              const body = sl.cur();
              (0, _kit.invariant)(body.pos === _kit.Tag.block);
              const buf = _toConsumableArray(walk(sl.one()));
              let handle = null;
              let handlePat = null;
              let fin = null;
              let j = sl.curLev();
              if (j != null && j.pos === _kit.Tag.handler) {
                const k = sl.peel();
                (0, _kit.invariant)(k.type === _kit.Tag.CatchClause);
                if (sl.curLev().pos === _kit.Tag.param) {
                  handlePat = _toConsumableArray(sl.one());
                  handlePat[0].pos = handlePat[handlePat.length - 1].pos = _kit.Tag.push;
                }
                handle = _toConsumableArray(walk(sl.one()));
                (0, _kit.invariant)(handle[0].pos === _kit.Tag.body);
                Kit.skip(sl.leave());
                j = sl.curLev();
              }
              if (j != null && j.pos === _kit.Tag.finalizer) {
                fin = _toConsumableArray(walk(sl.one()));
              }
              yield sl.enter(i.pos, Block.letStmt, {
                pat: [],
                bind: true,
                eff: true
              });
              if (fin != null) yield sl.enter(_kit.Tag.expression, Block.app, {
                sym: finallyId
              });
              if (handle != null) yield sl.enter(_kit.Tag.expression, Block.app, {
                sym: handleId
              });
              yield* Kit.reposOneArr(buf, _kit.Tag.push);
              if (handle != null) {
                yield sl.enter(_kit.Tag.params, _kit.Tag.Array);
                if (handlePat) yield* handlePat;
                yield* sl.leave();
                yield* Kit.reposOneArr(handle, _kit.Tag.push);
                yield* sl.leave();
              }
              if (fin != null) {
                yield sl.enter(_kit.Tag.params, _kit.Tag.Array);
                yield* sl.leave();
                yield* Kit.reposOneArr(fin, _kit.Tag.push);
                yield* sl.leave();
              }
              yield* sl.leave();
            }
            continue;
          case _kit.Tag.ThrowStatement:
            if (i.enter && sl.opts.jsExceptions !== false) {
              const lab = sl.label();
              yield sl.enter(i.pos, Block.letStmt, {
                pat: [],
                bind: true,
                eff: true
              });
              yield sl.enter(_kit.Tag.expression, _kit.Tag.CallExpression);
              yield Kit.idTok(_kit.Tag.callee, raiseId);
              yield sl.enter(_kit.Tag.arguments, _kit.Tag.Array);
              yield* Kit.reposOne(walk(sl.sub()), _kit.Tag.push);
              yield* lab();
              sl.close(i);
              continue;
            }
            break;
        }
      }
      yield i;
    }
  }
  yield* walk(sl);
}