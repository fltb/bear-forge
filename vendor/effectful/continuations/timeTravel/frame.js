"use strict";

exports.__esModule = true;
exports.checkpoint = checkpoint;
exports.journal = void 0;
exports.recordFrame = recordFrame;
var State = require("../state");
var S = require("@effectful/serialization");
var Binds = require("./binds");
var Core = require("./core");
const {
  record
} = Core;
const {
  record2,
  record5,
  record9
} = Binds;
const journal = exports.journal = State.journal;
const context = State.context;
function recordContext() {
  record5(resetContextOp, context.top, context.enabled, context.brk, context.value, context.error);
}
function resetContextOp() {
  const {
    a: top,
    b: enabled,
    c: brk,
    d: value,
    e: error
  } = this;
  this.a = context.top;
  this.b = context.enabled;
  this.c = context.brk;
  this.d = context.value;
  this.e = context.error;
  record(this);
  context.top = top;
  context.enabled = enabled;
  context.brk = brk;
  context.value = value;
  context.error = error;
}
S.regOpaqueObject(resetContextOp, "@effectful/debug/reset#ctx");
function checkpoint() {
  if (!journal.enabled) return null;
  const cp = Core.checkpoint();
  const top = context.top;
  if (top) recordFrame(top);
  recordContext();
  return cp;
}
function restoreFrameFullOp() {
  const {
    a: frame,
    b: saved
  } = this;
  this.b = State.native.Object.assign({}, frame);
  State.native.Object.assign(frame, saved);
  record(this);
}
S.regOpaqueObject(restoreFrameFullOp, "#frame");
function restoreFrameOp() {
  const {
    a: frame,
    b: goto,
    c: state,
    d: brk,
    e: $
  } = this;
  this.b = frame.goto;
  this.c = frame.state;
  this.d = frame.brk;
  this.e = frame.$;
  record(this);
  frame.goto = goto;
  frame.state = state;
  frame.brk = brk;
  frame.timestamp = journal.now;
  frame.$ = $;
}
S.regOpaqueObject(restoreFrameOp, "#frame");
function restoreGeneratorFrameOp() {
  const {
    a: frame,
    b: goto,
    c: state,
    d: brk,
    e: $,
    f: flags,
    g: sent,
    h: next,
    i: caller
  } = this;
  this.b = frame.goto;
  this.c = frame.state;
  this.d = frame.brk;
  this.e = frame.$;
  this.f = frame.flags;
  this.g = frame.sent;
  this.h = frame.next;
  this.i = frame.caller;
  record(this);
  frame.goto = goto;
  frame.state = state;
  frame.brk = brk;
  frame.$ = $;
  frame.flags = flags;
  frame.sent = sent;
  frame.timestamp = journal.now;
  frame.next = next;
  frame.caller = caller;
}
S.regOpaqueObject(restoreGeneratorFrameOp, "#frame$g");
const Flag = State.Flag;
function recordFrame(frame) {
  if (journal.enabled && frame.timestamp !== journal.now) {
    const flags = frame.meta.flags;
    if (flags & Flag.GENERATOR_FUNCTION) {
      if (flags & Flag.ASYNC_FUNCTION) {
        frame.timestamp = journal.now;
        // TODO: saved only needed properties
        record2(restoreFrameFullOp, frame, State.native.Object.assign({}, frame));
      } else {
        record9(restoreGeneratorFrameOp, frame, frame.goto, frame.state, frame.brk, frame.$, frame.flags, frame.sent, frame.next, frame.caller);
      }
    } else {
      if ((flags & Flag.ASYNC_FUNCTION) !== 0) {
        record2(restoreFrameFullOp, frame, State.native.Object.assign({}, frame));
      } else {
        record5(restoreFrameOp, frame, frame.goto, frame.state, frame.brk, frame.$);
      }
    }
  }
}