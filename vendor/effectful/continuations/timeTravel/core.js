"use strict";

exports.__esModule = true;
exports.checkpoint = checkpoint;
exports.record = void 0;
exports.reset = reset;
var _config = require("../config");
var _state = require("../state");
function reset(enabled = true) {
  _state.journal.enabled = enabled;
  _state.journal.past = _state.journal.now = _state.journal.future = null;
}

/**
 * Returns an object which can be passed
 * to `undo` to restored the current state
 */
function checkpoint() {
  _state.journal.future = null;
  const {
    now
  } = _state.journal;
  if (now) now.prev = _state.journal.past;
  _state.journal.past = now;
  return _state.journal.now = {
    prev: null
  };
}
/**
 * Registers a function(`f`) to be executed on replay in backward order,
 * if time traveling is enabled
 */
const record = exports.record = _config.default.timeTravel ? function record(f) {
  if (!f) return;
  const {
    now
  } = _state.journal;
  if (!now) return;
  f.prev = now.operations || null;
  now.operations = f;
} : function () {};