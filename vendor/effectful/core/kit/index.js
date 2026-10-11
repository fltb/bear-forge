"use strict";

exports.__esModule = true;
exports.wrap = exports.withOpts = exports.unpack = exports.transform = exports.toks = exports.toArray = exports.timeEnd = exports.time = exports.tillVal = exports.tillLevel = exports.till = exports.tee = exports.stage = exports.skip = exports.single = exports.share = exports.setType = exports.setPos = exports.setOpts = exports.select = exports.saveLast = exports.reverse = exports.result = exports.reposOneArr = exports.reposOne = exports.repos = exports.prepend = exports.pipe = exports.packed = exports.pack = exports.output = exports.optsScopeLift = exports.optsScope = exports.mapPush = exports.mapArr = exports.mapAdd = exports.map = exports.la = exports.isWindows = exports.hasAnnot = exports.groupUniq = exports.group = exports.globalOpts = exports.getOpts = exports.forEach = exports.flatMap = exports.find = exports.filter = exports.fileBody = exports.enableIf = exports.curryN = exports.curry = exports.cons = exports.concat = exports.completeSubst = exports.clone = exports.cleanEmptyExprs = exports.babelPlugin = exports.babelBridge = exports.adjustFieldTypeSimple = exports.adjustFieldType = exports.Subst = void 0;
var _transducers = require("@effectful/transducers");
exports.varScope = _transducers.scope;
exports.isSynthetic = _transducers.isSynthetic;
exports.Tag = _transducers.Tag;
exports.symbol = _transducers.symbol;
exports.symName = _transducers.symName;
exports.symKind = _transducers.symKind;
exports.symInfo = _transducers.symInfo;
exports.dump = _transducers.dump;
exports.trace = _transducers.trace;
exports.scope = _transducers.scope;
exports.typeInfo = _transducers.typeInfo;
exports.resetFieldInfo = _transducers.resetFieldInfo;
exports.invariant = _transducers.invariant;
exports.emitConst = _transducers.emitConst;
var _core = require("./core");
exports.packId = _core.packId;
exports.auto = _core.auto;
exports.autoBlock = _core.autoBlock;
exports.autoBlockPass = _core.autoBlockPass;
exports.rmEmpty = _core.rmEmpty;
exports.removeNulls = _core.removeNulls;
exports.enter = _core.enter;
exports.leave = _core.leave;
exports.tok = _core.tok;
exports.repeat = _core.repeat;
exports.complete = _core.complete;
exports.Any = _core.Any;
exports.completeAny = _core.completeAny;
exports.finalize = _core.finalize;
exports.strip = _core.strip;
exports.swap = _core.swap;
exports.swapTok = _core.swapTok;
exports.produce = _core.produce;
exports.consume = _core.consume;
exports.tagValue = _core.tagValue;
exports.idTok = _core.idTok;
exports.applyIgnoreResult = _core.applyIgnoreResult;
exports.lookahead = _core.lookahead;
exports.rsub = _core.rsub;
exports.prepare = _core.prepare;
exports.resetLevel = _core.resetLevel;
exports.sysId = _core.sysId;
exports.coerceId = _core.coerceId;
exports.skipTillFileBeg = _core.skipTillFileBeg;
const {
  toArray,
  result,
  tillLevel,
  till,
  clone,
  withOpts,
  toks,
  skip,
  setType,
  setPos,
  Subst,
  completeSubst,
  hasAnnot,
  find,
  share,
  wrap,
  saveLast,
  transform,
  babelBridge,
  babelPlugin,
  tee,
  optsScope,
  setOpts,
  getOpts,
  optsScopeLift,
  adjustFieldType,
  adjustFieldTypeSimple,
  select,
  cons,
  la,
  enableIf,
  output,
  repos,
  reposOne,
  reposOneArr,
  reverse,
  pack,
  unpack,
  packed,
  flatMap,
  map,
  forEach,
  filter,
  cleanEmptyExprs,
  mapAdd,
  mapPush,
  mapArr,
  group,
  groupUniq,
  concat,
  stage,
  curryN,
  curry,
  pipe,
  time,
  timeEnd,
  prepend,
  tillVal,
  single,
  fileBody
} = _transducers.kit;
exports.fileBody = fileBody;
exports.single = single;
exports.tillVal = tillVal;
exports.prepend = prepend;
exports.timeEnd = timeEnd;
exports.time = time;
exports.pipe = pipe;
exports.curry = curry;
exports.curryN = curryN;
exports.stage = stage;
exports.concat = concat;
exports.groupUniq = groupUniq;
exports.group = group;
exports.mapArr = mapArr;
exports.mapPush = mapPush;
exports.mapAdd = mapAdd;
exports.cleanEmptyExprs = cleanEmptyExprs;
exports.filter = filter;
exports.forEach = forEach;
exports.map = map;
exports.flatMap = flatMap;
exports.packed = packed;
exports.unpack = unpack;
exports.pack = pack;
exports.reverse = reverse;
exports.reposOneArr = reposOneArr;
exports.reposOne = reposOne;
exports.repos = repos;
exports.output = output;
exports.enableIf = enableIf;
exports.la = la;
exports.cons = cons;
exports.select = select;
exports.adjustFieldTypeSimple = adjustFieldTypeSimple;
exports.adjustFieldType = adjustFieldType;
exports.optsScopeLift = optsScopeLift;
exports.getOpts = getOpts;
exports.setOpts = setOpts;
exports.optsScope = optsScope;
exports.tee = tee;
exports.babelPlugin = babelPlugin;
exports.babelBridge = babelBridge;
exports.transform = transform;
exports.saveLast = saveLast;
exports.wrap = wrap;
exports.share = share;
exports.find = find;
exports.hasAnnot = hasAnnot;
exports.completeSubst = completeSubst;
exports.Subst = Subst;
exports.setPos = setPos;
exports.setType = setType;
exports.skip = skip;
exports.toks = toks;
exports.withOpts = withOpts;
exports.clone = clone;
exports.till = till;
exports.tillLevel = tillLevel;
exports.result = result;
exports.toArray = toArray;
const globalOpts = exports.globalOpts = _transducers.kit.getOpts;
const isWindows = exports.isWindows = typeof process !== "undefined" && process.platform === "win32";