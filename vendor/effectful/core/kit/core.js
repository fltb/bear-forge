"use strict";

exports.__esModule = true;
exports.Subst = exports.Any = void 0;
exports.auto = auto;
exports.bracket = bracket;
exports.complete = void 0;
exports.completeAny = completeAny;
exports.completeAutoClose = completeAutoClose;
exports.completeSubst = completeSubst;
exports.concatArraysPass = concatArraysPass;
exports.consume = void 0;
exports.enter = enter;
exports.filter = void 0;
exports.finalize = finalize;
exports.findValue = findValue;
exports.idTok = idTok;
exports.leave = leave;
exports.lookahead = lookahead;
exports.map = void 0;
exports.nextLevel = nextLevel;
exports.one = one;
exports.prepare = exports.peel = void 0;
exports.produce = produce;
exports.removeNulls = removeNulls;
exports.repeat = repeat;
exports.resetLevel = resetLevel;
exports.resetParent = resetParent;
exports.rfrom = rfrom;
exports.rmEmpty = void 0;
exports.rsub = rsub;
exports.setPos = setPos;
exports.setType = setType;
exports.skip = skip;
exports.skipTillFileBeg = skipTillFileBeg;
exports.strip = strip;
exports.sub = sub;
exports.swap = swap;
exports.swapTok = swapTok;
exports.sysId = sysId;
exports.tagValue = tagValue;
exports.tillExit = tillExit;
exports.tillLevel = tillLevel;
exports.tok = tok;
exports.until = until;
exports.wrap = wrap;
var _transducers = require("@effectful/transducers");
var _kit = require("@effectful/transducers/kit");
var T = require("@babel/types");
let curId = 0;
function tagValue(pos, type, v) {
  if (v.tag != null) return v;
  const info = (0, _transducers.symInfo)(type);
  const res = {
    tag: true
  };
  res.id = curId++;
  res.origType = type;
  res.origPos = pos;
  res.stmt = info.stmt;
  res.expr = info.expr;
  res.func = info.func;
  res.coerce = info.coerce;
  res.boundary = res.stmt && !(type === _transducers.Tag.VariableDeclaration && pos === _transducers.Tag.init) || type === _transducers.Tag.CatchClause;
  Object.assign(res, v);
  return res;
}
function guessType(pos, type, value) {
  if (pos.pos && type == null && value == null) {
    type = pos.type;
    value = pos.value;
    pos = pos.pos;
  }
  if (type == null) {
    type = pos;
  } else if (!(0, _transducers.isSymbol)(type) && value == null) {
    value = type;
    type = null;
  }
  if (type == null) {
    type = pos;
    if (value.node && value.node.type) {
      type = _transducers.Tag[value.node.type];
      if (type == null) type = pos;
    }
  }
  if (value == null) {
    value = {};
  }
  if (value.node == null) {
    switch (type) {
      case _transducers.Tag.Array:
        value.node = [];
        break;
      case _transducers.Tag.Null:
        value.node = null;
        break;
      default:
        value.node = {};
    }
  }
  return [pos, type, value];
}
function* removeNulls(s) {
  const stack = [];
  for (const i of s) {
    if (i.type === _transducers.Tag.Null) {
      if (i.enter && i.pos != _transducers.Tag.push && stack[0]) stack[0][(0, _transducers.symName)(i.pos)] = null;
      continue;
    }
    yield i;
    if (i.enter) stack.unshift(i.value.node);
    if (i.leave) stack.shift();
  }
}
_transducers.Tag.AutoClose = (0, _transducers.symbol)("AutoClose", "ctrl");
function* completeAutoClose(s) {
  const stack = [];
  let level = 0;
  for (const i of s) {
    if (i.pos === _transducers.Tag.AutoClose) {
      if (i.enter) stack.push(level);
      if (i.leave) {
        for (let j = stack.shift(); j < level; j++) yield leave();
      }
    } else {
      if (i.enter) level++;
      if (i.leave) level--;
      yield i;
    }
  }
}
function tok(pos, type, value) {
  [pos, type, value] = guessType(pos, type, value);
  value = tagValue(pos, type, value);
  return {
    enter: true,
    leave: true,
    type,
    pos,
    value
  };
}
function enter() {
  let [pos, type, value] = guessType.apply(null, arguments);
  (0, _transducers.invariant)(pos && type && value);
  value = tagValue(pos, type, value);
  return {
    enter: true,
    leave: false,
    type,
    pos,
    value
  };
}
const Any = exports.Any = (0, _transducers.symbol)("Any", "ctrl");
function leave() {
  if (!arguments.length) return {
    enter: false,
    leave: true,
    type: Any,
    pos: Any,
    value: {}
  };
  const [pos, type, value] = arguments.length ? guessType.apply(null, arguments) : [Any, Any, {}];
  return {
    enter: false,
    leave: true,
    type,
    pos,
    value
  };
}

/**
 * sets `parentType` field describing current parent node type
 * in the stream for each token
 */

function* resetParent(s) {
  const stack = [];
  for (const i of s) {
    if (i.enter) {
      i.value.parentType = stack[0];
      stack.unshift(i.type);
    }
    yield i;
    if (i.leave) stack.shift();
  }
}

/**
 * resets level field field of value, to current value,
 * it must be reapplied after each change
 */
function* resetLevel(s) {
  let level = 0;
  for (const i of s) {
    //TODO: keep level in stream
    if (i.enter) level++;
    // i.level = level
    // yield i
    yield {
      enter: i.enter,
      leave: i.leave,
      type: i.type,
      pos: i.pos,
      value: i.value,
      level
    };
    if (i.leave) level--;
  }
}

/**
 * modifies token replacing its `type` field
 */
function setType(i, type) {
  return {
    enter: i.enter,
    leave: i.leave,
    type,
    pos: i.pos,
    value: i.value
  };
}

/**
 * modifies token replacing its `pos` field
 */
function setPos(i, pos) {
  return {
    enter: i.enter,
    leave: i.leave,
    type: i.type,
    pos,
    value: i.value
  };
}
function* repeat(num, tok) {
  for (let i = 0; i < num; i++) yield tok;
}
function* completeAny(s) {
  const stack = [];
  for (const i of s) {
    if (i.enter) stack.unshift(i);
    if (i.leave) {
      const t = stack.shift();
      i.value = t.value;
      if (i.pos === Any) {
        yield {
          enter: i.enter,
          leave: i.leave,
          type: t.type,
          pos: t.pos,
          value: i.value,
          comment: i.comment
        };
        continue;
      }
    }
    yield i;
  }
}
const consume = exports.consume = _transducers.consume;
function* completeSubst(s) {
  const sl = auto(s);
  function* subst(pos) {
    for (const i of sl.sub()) {
      if (i.type === Subst) {
        if (i.enter) yield* subst(pos);
      } else {
        yield sl.peel(setPos(i, pos));
        yield* walk();
        yield* sl.leave();
      }
    }
  }
  function* walk() {
    for (const i of sl.sub()) {
      if (i.type === Subst) {
        if (i.enter) {
          (0, _transducers.invariant)(!i.leave);
          yield* subst(i.pos);
        }
      } else yield i;
    }
  }
  yield* walk();
}
const complete = exports.complete = (0, _kit.pipe)(completeAny, resetLevel);
const Subst = exports.Subst = (0, _transducers.symbol)("Subst", "ctrl");
function* wrap(i, tok, value) {
  if (i.enter) yield enter(i.pos, tok, value);
  yield i;
  if (i.leave) yield leave(i.pos, tok, value);
}
function* bracket(i, pos, tok, value) {
  yield enter(pos, tok, value);
  yield* i;
  yield leave(pos, tok, value);
}
const map = exports.map = (0, _kit.curry)(function* map(f, s) {
  for (const i of s) yield f(i);
});
const filter = exports.filter = (0, _kit.curry)(function* filter(pred, s) {
  for (const i of s) if (pred(i)) yield i;
});
function* concatArraysPass(s) {
  let buf = null;
  for (const i of s) {
    if (buf != null) {
      if (!i.enter || i.pos !== buf.pos) {
        yield buf;
        yield i;
      }
      buf = null;
    } else if (i.leave && i.type === _transducers.Tag.Array) {
      buf = i;
    } else {
      yield i;
    }
  }
  if (buf != null) yield buf;
}
const sysSyms = new Map();

/** returns Symbol marked with lib=true field */
function sysId(name, scoped) {
  let res = sysSyms.get(name);
  if (res != null) return res;
  sysSyms.set(name, res = _transducers.scope.newSym(name, true));
  res.lib = true;
  res.nsDefault = false;
  res.scoped = scoped;
  return res;
}

/** returns `tok` with type = Tag.Identifier at `pos` with `sym` */
function idTok(pos, sym) {
  return tok(pos, _transducers.Tag.Identifier, {
    sym
  });
}
function lookahead(s) {
  if (s.lookahead != null) return s;
  const i = s[Symbol.iterator]();
  return {
    lookahead: i.next(),
    take(v) {
      const n = this.next(v);
      return n.done ? null : n.value;
    },
    cur() {
      const la = this.lookahead;
      return la.done ? null : la.value;
    },
    next(v) {
      const cur = this.lookahead;
      if (cur.done) return cur;
      this.lookahead = i.next(v);
      return cur;
    },
    [Symbol.iterator]() {
      return {
        next: v => this.next(v)
      };
    },
    closedLevel() {
      return this.lookahead.done || !this.lookahead.value.enter;
    }
  };
}

/**
 * iterator for current level sequence, takes `lookahead` iterable
 */
function* sub(s) {
  const {
    lookahead
  } = s;
  if (lookahead.done) return;
  const {
    value
  } = lookahead;
  if (!value.enter) return;
  const exit = value.level;
  for (const i of s) {
    yield i;
    if (s.lookahead.done || s.lookahead.value.level < exit) return;
  }
}
function* one(s) {
  const c = s.cur();
  if (c == null) return;
  if (!c.enter) return;
  const exit = c.level;
  for (const i of s) {
    //TODO: use the one from s
    const level = i.level;
    yield i;
    if (i.leave && exit === level) return;
  }
}

// TODO: merge with sub
function* until(pred, s) {
  const i = s.cur();
  if (i == null) return;
  if (!i.enter) return;
  const level = i.level;
  const exit = level - 1;
  for (const i of s) {
    yield i;
    const c = s.cur();
    if (!c) return;
    const cur = c.value.level;
    if (cur === exit || cur === level && pred(c)) return;
  }
}
function* nextLevel(s) {
  const i = s.take();
  (0, _transducers.invariant)(i.enter);
  yield i;
  if (!i.leave) {
    yield* tillLevel(i.level, s);
  }
}

/**
 * sub as `sub` but for reversed iterator
 */
function* rsub(s) {
  const {
    lookahead
  } = s;
  if (lookahead.done) return;
  const {
    value
  } = lookahead;
  if (value.enter) return;
  const exit = value.level - 1;
  for (const i of s) {
    yield i;
    if (s.lookahead.done || s.lookahead.value.level === exit) return;
  }
}
function swapTok(i) {
  return {
    enter: i.leave,
    leave: i.enter,
    type: i.type,
    pos: i.pos,
    value: i.value
  };
}
function* swap(s) {
  for (const i of s) yield {
    enter: i.leave,
    leave: i.enter,
    type: i.type,
    pos: i.pos,
    value: i.value
  };
}

/**
 * takes reverse iterator and creates normal order array with the elements
 */
function rfrom(s) {
  return Array.from(s).reverse();
}

/**
 * values until leaving specified level
 */
function* tillLevel(level, s) {
  for (const i of s) {
    yield i;
    if (i.leave && i.level === level) return;
  }
}
function* tillExit(s) {
  let level = null;
  for (const i of s) {
    if (i.leave) {
      if (level == null || level > i.level) return;
    }
    yield i;
    if (i.enter) {
      if (level == null) level = i.level;
    }
  }
}
function skip(s) {
  const i = s[Symbol.iterator]();
  for (;;) {
    const v = i.next();
    if (v.done) return v.value;
  }
}
const prepare = exports.prepare = (0, _kit.pipe)(resetLevel, function* prepare(s) {
  const stack = [];
  const si = lookahead(s);
  for (const i of si) {
    let key = false;
    switch (i.pos) {
      case _transducers.Tag.label:
        if (i.enter) skip(sub(si));
        continue;
      case _transducers.Tag.id:
        key = true;
        break;
      case _transducers.Tag.property:
      case _transducers.Tag.key:
        if (i.enter && i.type === _transducers.Tag.Identifier) {
          const f = stack[0];
          if (f && f.computed) key = true;
        }
        break;
    }
    if (i.enter) {
      const tv = tagValue(i.pos, i.type, {
        node: i.value.node
      });
      if (key) tv.expr = false;
      stack.unshift(tv);
    }
    yield {
      enter: i.enter,
      leave: i.leave,
      type: i.type,
      pos: i.pos,
      value: stack[0]
    };
    if (i.leave) stack.shift();
  }
}, resetLevel);
function produce(ast, pos) {
  return prepare((0, _transducers.produce)(ast, pos));
}
function finalize(s) {
  return s;
}
function* findValue(pred, s) {
  for (const i of s) {
    yield i;
    if (i.enter && pred(i.value)) return i;
  }
  return null;
}
const peel = exports.peel = (0, _kit.curry)(function* peel(step, s) {
  const i = s.take();
  yield enter(i);
  yield* step(s);
  if (i.leave) yield leave(i);else yield s.take();
});

/**
 * removes nodes with specified type without content
 */
const rmEmpty = exports.rmEmpty = (0, _kit.curry)(function* rmEmpty(ty, s) {
  const sl = lookahead(s);
  for (const i of sl) {
    if (i.type === ty && i.enter) {
      if (i.leave) continue;
      const c = sl.cur();
      if (c != null) {
        if (c.type === ty) {
          sl.next();
          continue;
        }
      }
    }
    yield i;
  }
});

/**
 * removes all additional information from nodes
 */
function* strip(s) {
  for (const i of s) {
    if (i.enter) {
      switch (i.type) {
        case _transducers.Tag.Array:
          i.value.node = [];
          break;
        case _transducers.Tag.Empty:
        case _transducers.Tag.Null:
          i.value.node = null;
          break;
        default:
          if (_transducers.Tag[i.type] != null && i.pos !== _transducers.Tag.top) {
            const r = {};
            for (const j of T.BUILDER_KEYS[(0, _transducers.symName)(i.type)]) r[j] = i.value.node[j];
            if (i.value.node.leadingComments) {
              r.leadingComments = [];
              for (const j of i.value.node.leadingComments) r.leadingComments.push({
                type: j.type,
                value: j.value
              });
            }
            i.value.node = r;
          }
      }
    }
    yield i;
  }
}
function ctor(pos, type, value) {
  [pos, type, value] = guessType(pos, type, value);
  value = tagValue(pos, type, value);
  // if (this != null && value.opts == null)
  // value.opts = this.opts
  return [pos, type, value];
}
function CtorWrap(i) {
  _kit.Wrapper.call(this, i);
}
CtorWrap.prototype = Object.create(_kit.Wrapper.prototype);
CtorWrap.prototype.valCtor = ctor;
function auto(i) {
  if (i.valCtor) return i;
  return new CtorWrap(i);
}
function* skipTillFileBeg(s) {
  for (let la; (la = s.cur()) != null;) {
    switch (la.type) {
      case _transducers.Tag.ImportDeclaration:
        yield* s.one();
        continue;
      case _transducers.Tag.VariableDeclaration:
        if (la.value.metaInfo) {
          yield* s.one();
          continue;
        }
    }
    break;
  }
}