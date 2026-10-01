'use strict';

// Emits `node.evloop` trace events describing when callbacks enter and leave
// the JS-side queues (nextTick, microtasks, timers, immediates). Loop phase
// boundaries are emitted from C++ (see EvloopPhaseHook in src/env.cc).

const {
  ArrayIsArray,
  ArrayPrototypeIndexOf,
  ArrayPrototypeJoin,
  ArrayPrototypePop,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ArrayPrototypeSort,
  ArrayPrototypeSplice,
  NumberIsFinite,
  ObjectDefineProperty,
  ObjectFreeze,
  SafeSet,
  SafeWeakMap,
  String,
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  globalThis,
} = primordials;

const {
  categoryEnabledChecker,
  kTraceInstant,
  nodeTraceEventCategory,
  trace,
} = require('internal/trace_events');

const kCategory = nodeTraceEventCategory('node.evloop');
const kFrameCount = 12;

// Stays off until setupEvloopTrace() runs at pre-execution, so nothing
// resolved while building the startup snapshot leaks into runtime. Callers
// reach it through module.exports, which setupEvloopTrace() replaces, so
// each check is a single call.
let isEnabled = () => false;

// Whether __evloop exists for instrumented code to call. It is defined only
// when the category is on at startup; enabling it later must not instrument.
let probesInstalled = false;

// Modules that only relay a scheduling request. The frame below them tells
// whether user code or Node itself asked for the work.
const kSchedulers = new SafeSet([
  'node:internal/evloop_trace',
  'node:internal/process/promises',
  'node:internal/process/task_queues',
  'node:internal/promise_hooks',
  'node:internal/timers',
  'node:timers',
  'node:timers/promises',
]);

let getCallSites;
// Returns the frame that scheduled the work, or undefined when that frame is
// inside Node (e.g. a stream scheduling its own nextTick on behalf of
// console.log), so that work can be hidden as internal.
function userSite() {
  getCallSites ??= internalBinding('util').getCallSites;
  const sites = getCallSites(kFrameCount);
  for (let i = 0; i < sites.length; i++) {
    const { scriptName, lineNumber, columnNumber, functionName } = sites[i];
    if (scriptName === '' || kSchedulers.has(scriptName))
      continue;
    if (StringPrototypeStartsWith(scriptName, 'node:'))
      return undefined;
    return `${functionName || '<anonymous>'} ${scriptName}:${lineNumber}:${columnNumber}`;
  }
}

function emit(queue, op, id, extra) {
  const data = { queue, op, id, ...extra };
  trace(kTraceInstant, kCategory, `${queue}:${op}`, 0, data);
}

let getFunctionSourcePosition;
function enqueue(queue, id, fn, extra) {
  const site = userSite();
  getFunctionSourcePosition ??=
    internalBinding('util').getFunctionSourcePosition;
  emit(queue, 'enqueue', id, {
    name: fn?.name || '<anonymous>',
    // [script name, offset in the instrumented source]; the viewer maps it
    // back to the callback's own code.
    fn: site === undefined ? undefined : getFunctionSourcePosition(fn),
    site,
    internal: site === undefined,
    ...extra,
  });
}

// The delay a timer was created with, before Node clamps it (0, negative,
// NaN or too large all become 1 ms) and truncates it to whole milliseconds.
let requestedDelays;

function noteRequestedDelay(timer, after) {
  requestedDelays ??= new SafeWeakMap();
  // Node coerces the delay to a number, so '10' asks for 10 ms.
  if (typeof after === 'string' && NumberIsFinite(+after)) after = +after;
  requestedDelays.set(timer,
                      NumberIsFinite(after) ? after : String(after));
}

// Returns the requested delay the first time a timer is queued, when it
// differs from what Node used. Later re-arms (intervals, refresh()) get none.
function takeRequestedDelay(timer, msecs) {
  const requested = requestedDelays?.get(timer);
  if (requested === undefined) return undefined;
  requestedDelays.delete(timer);
  return requested === msecs ? undefined : requested;
}

let nextMicrotaskId = 0;

function wrapMicrotask(callback) {
  const id = `m${++nextMicrotaskId}`;
  enqueue('microtask', id, callback, { kind: 'queueMicrotask' });
  return function() {
    emit('microtask', 'run', id);
    try {
      callback();
    } finally {
      emit('microtask', 'done', id);
    }
  };
}

// V8 has no hook for individual microtask enqueue, so promise reaction jobs
// are inferred from promise hooks: a reaction is enqueued when `then` is
// called on a settled promise, or when a pending promise settles. Each `then`
// call is also recorded on its own, so a reaction that waits on a pending
// promise is visible before it is queued. A reaction
// that leaves its promise unsettled returned a thenable, which enqueues a
// PromiseResolveThenableJob for that same promise. Resolving any other
// promise with a thenable (`resolve(p)`, or `return p` from an async
// function) queues that job with no hook, so it is only seen when it runs.
// The reaction that job queues on the thenable is named after the promise
// being resolved.
function startPromiseTracking() {
  const promises = new SafeWeakMap();
  const running = [];
  let nextPromiseId = 0;

  function stateOf(promise) {
    let state = promises.get(promise);
    if (state === undefined) {
      state = {
        id: `p${++nextPromiseId}`,
        settled: false,
        waiting: [],
        parent: undefined,
        queued: false,
        thenableQueued: false,
        site: undefined,
        kind: 'promise reaction',
      };
      promises.set(promise, state);
    }
    return state;
  }

  let promiseDetails;
  function settledAs(promise) {
    promiseDetails ??= internalBinding('util');
    const { 0: state } = promiseDetails.getPromiseDetails(promise);
    return state === promiseDetails.constants.kRejected ? 'rejected' : 'fulfilled';
  }

  // `cause` says what queued the reaction: the `then` call itself (its
  // promise was already `outcome`), or `by` settling at `bySite` later.
  function enqueueReaction(state, kind, cause, outcome, by, bySite) {
    state.queued = true;
    const site = state.site;
    emit('microtask', 'enqueue', state.id, {
      name: kind,
      kind,
      site,
      internal: site === undefined,
      cause,
      outcome,
      by,
      bySite,
    });
  }

  require('internal/promise_hooks').createHook({
    init(promise, parent) {
      const state = stateOf(promise);
      state.site = userSite();
      if (parent === undefined) return;
      const job = running[running.length - 1];
      if (state.site === undefined && job?.thenable) {
        state.site = job.state.site;
        state.kind = 'adopt job';
      }
      const parentState = stateOf(parent);
      // The reaction is registered now, whether or not it can be queued yet.
      // An adopt job's `then` is V8's own call, so it is left out.
      if (state.kind === 'promise reaction') {
        emit('microtask', 'then', state.id, {
          kind: state.kind,
          promise: parentState.id,
          settled: parentState.settled,
          site: state.site,
          internal: state.site === undefined,
        });
      }
      if (parentState.settled) {
        enqueueReaction(state, state.kind, 'then', settledAs(parent));
      } else {
        state.parent = parentState;
        ArrayPrototypePush(parentState.waiting, state);
      }
    },
    settled(promise) {
      const state = stateOf(promise);
      state.settled = true;
      // A reaction's promise only settles once its job has run. Settling
      // while still waiting means V8 linked it to the parent for another
      // reason (e.g. the wrapper promise of `await`), so it is not a job.
      if (state.parent !== undefined) {
        const waiting = state.parent.waiting;
        const at = ArrayPrototypeIndexOf(waiting, state);
        if (at !== -1) ArrayPrototypeSplice(waiting, at, 1);
        state.parent = undefined;
      }
      const waiting = state.waiting;
      state.waiting = [];
      if (waiting.length === 0) return;
      const bySite = userSite();
      const outcome = settledAs(promise);
      for (let i = 0; i < waiting.length; i++) {
        waiting[i].parent = undefined;
        enqueueReaction(waiting[i], waiting[i].kind, 'settle', outcome, state.id, bySite);
      }
    },
    before(promise) {
      const state = stateOf(promise);
      ArrayPrototypePush(running, {
        state,
        thenable: state.thenableQueued || !state.queued,
      });
      emit('microtask', 'run', state.id, state.queued ? undefined : {
        kind: 'thenable job',
        site: state.site,
        internal: state.site === undefined,
      });
    },
    after(promise) {
      const state = stateOf(promise);
      ArrayPrototypePop(running);
      emit('microtask', 'done', state.id);
      if (state.queued && !state.settled && !state.thenableQueued) {
        state.thenableQueued = true;
        enqueueReaction(state, 'thenable job', 'thenable');
      }
    },
  });
}

// Source instrumentation: user files are rewritten at load time so that each
// statement and each non-trivial expression reports when it runs. Probes
// never add newlines, so line numbers in stack traces stay exact.

// Expressions worth a step of their own. Literals, identifiers, `this`,
// functions and array/object literals are skipped as noise (their children
// are still instrumented).
const kWrappable = new SafeSet([
  'AssignmentExpression', 'AwaitExpression', 'BinaryExpression',
  'CallExpression', 'ChainExpression', 'ConditionalExpression',
  'ImportExpression', 'LogicalExpression', 'MemberExpression',
  'NewExpression', 'TaggedTemplateExpression', 'TemplateLiteral',
  'UnaryExpression', 'UpdateExpression', 'YieldExpression',
]);

const kPatternTypes = new SafeSet([
  'ArrayPattern', 'ObjectPattern', 'RestElement', 'AssignmentPattern',
]);

const kStatementLists = {
  __proto__: null,
  Program: 'body',
  BlockStatement: 'body',
  StaticBlock: 'body',
  SwitchCase: 'consequent',
};

// Statement positions that may hold a single statement instead of a block.
const kSingleStatementBodies = {
  __proto__: null,
  IfStatement: ['consequent', 'alternate'],
  ForStatement: ['body'],
  ForInStatement: ['body'],
  ForOfStatement: ['body'],
  WhileStatement: ['body'],
  DoWhileStatement: ['body'],
  WithStatement: ['body'],
};

const kFunctionTypes = new SafeSet([
  'ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression',
]);

const kSkipKeys = new SafeSet(['type', 'start', 'end', 'loc', 'range']);

// Syntax highlighting comes from the same acorn parse used for probes, so
// it follows the grammar Node actually accepted.
const kTokenClasses = [
  'keyword', 'string', 'number', 'regexp', 'comment', 'function',
  'property', 'literal', 'builtin',
];
const kTok = {
  __proto__: null,
  keyword: 0, string: 1, number: 2, regexp: 3, comment: 4, function: 5,
  property: 6, literal: 7, builtin: 8,
};
const kContextualKeywords = new SafeSet([
  'async', 'await', 'let', 'of', 'yield', 'static', 'from', 'as',
]);
const kLiteralNames = new SafeSet(['undefined', 'NaN', 'Infinity']);
const kBuiltinNames = new SafeSet([
  'console', 'process', 'require', 'module', 'exports', '__dirname',
  '__filename', 'globalThis', 'Promise', 'setTimeout', 'setInterval',
  'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'structuredClone', 'fetch', 'Buffer', 'URL', 'Error',
  'TypeError', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date',
  'RegExp', 'BigInt', 'AbortController', 'EventTarget',
]);

// Returns a flat [start, end, classIndex, ...] list, comments included.
function classifyTokens(tokens, comments) {
  const out = [];
  for (let i = 0; i < comments.length; i++)
    ArrayPrototypePush(out, comments[i].start, comments[i].end, kTok.comment);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const { label, keyword } = tok.type;
    let cls = -1;
    if (keyword !== undefined) {
      cls = keyword === 'true' || keyword === 'false' || keyword === 'null' ?
        kTok.literal : kTok.keyword;
    } else if (label === 'string' || label === 'template' || label === '`') {
      cls = kTok.string;
    } else if (label === 'num') {
      cls = kTok.number;
    } else if (label === 'regexp') {
      cls = kTok.regexp;
    } else if (label === 'privateId') {
      cls = kTok.property;
    } else if (label === 'name') {
      const prev = tokens[i - 1]?.type;
      const next = tokens[i + 1]?.type;
      if (prev?.label === '.' || prev?.label === '?.') {
        cls = next?.label === '(' ? kTok.function : kTok.property;
      } else if (kContextualKeywords.has(tok.value)) {
        cls = kTok.keyword;
      } else if (kBuiltinNames.has(tok.value)) {
        cls = kTok.builtin;
      } else if (next?.label === '(' || prev?.keyword === 'function') {
        cls = kTok.function;
      } else if (kLiteralNames.has(tok.value)) {
        cls = kTok.literal;
      }
    } else if (label === '=>') {
      cls = kTok.keyword;
    }
    if (cls !== -1) ArrayPrototypePush(out, tok.start, tok.end, cls);
  }
  return out;
}

let nextSourceNodeId = 0;
let nextAsyncFnId = 0;
let acornParse;

function isUserFile(filename) {
  return typeof filename === 'string' &&
    !StringPrototypeStartsWith(filename, 'node:') &&
    StringPrototypeIndexOf(filename, '/node_modules/') === -1 &&
    StringPrototypeIndexOf(filename, '\\node_modules\\') === -1;
}

function instrument(source, filename, isModule) {
  if (!probesInstalled || !isEnabled() || !isUserFile(filename)) return source;
  acornParse ??= require('internal/deps/acorn/acorn/dist/acorn').parse;
  let ast;
  const tokens = [];
  const comments = [];
  try {
    ast = acornParse(source, {
      __proto__: null,
      ecmaVersion: 'latest',
      sourceType: isModule ? 'module' : 'script',
      allowHashBang: true,
      allowReturnOutsideFunction: !isModule,
      allowAwaitOutsideFunction: isModule,
      onToken: tokens,
      onComment: comments,
    });
  } catch {
    // Let V8 report the syntax error on the original source.
    return source;
  }

  const base = nextSourceNodeId;
  // One row per probe: [kind ('s' statement | 'e' expression), start, end,
  // id of the enclosing statement, or -1 when the expression is its own].
  const nodes = [];
  // Text insertions: [pos, isClose, span, rank, text].
  const inserts = [];
  // Original [start, end] of every function, to name queued callbacks.
  const funcs = [];
  // [id, start, end, name] of every async function. Each call of one gets an
  // activation id, so its awaits can be told apart from another call's.
  const asyncFns = [];
  // The innermost function being visited; awaits belong to its activation.
  let fnContext = null;

  function addNode(kind, node, stmt) {
    const id = nextSourceNodeId++;
    ArrayPrototypePush(nodes, [kind, node.start, node.end, stmt]);
    return id;
  }

  function probeStatement(stmt, braces) {
    const id = addNode('s', stmt, -1);
    const span = stmt.end - stmt.start;
    if (braces) {
      ArrayPrototypePush(inserts, [stmt.start, false, span, 0, '{']);
      ArrayPrototypePush(inserts, [stmt.end, true, span, 1, '}']);
    }
    ArrayPrototypePush(inserts, [stmt.start, false, span, 1,
                                 `__evloop.s(${id});`]);
    return id;
  }

  function wrapExpression(node, stmt) {
    const id = addNode('e', node, stmt);
    const span = node.end - node.start;
    ArrayPrototypePush(inserts, [node.start, false, span, 2,
                                 `__evloop.x(${id},(__evloop.e(${id}),`]);
    ArrayPrototypePush(inserts, [node.end, true, span, 0, '))']);
    return id;
  }

  function isProbedStatement(stmt) {
    if (stmt.directive !== undefined) return false;
    switch (stmt.type) {
      case 'FunctionDeclaration':
      case 'ImportDeclaration':
      case 'EmptyStatement':
        return false;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        return stmt.declaration?.type !== 'FunctionDeclaration';
      default:
        return true;
    }
  }

  // Whether wrapping `node` (found at `parent[key]`) in a function call keeps
  // the program's meaning.
  function canWrap(node, parent, key, inChain, inPattern) {
    if (inChain || inPattern || !kWrappable.has(node.type)) return false;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
      return false;
    switch (parent.type) {
      case 'AssignmentExpression':
        return key !== 'left';
      case 'UpdateExpression':
        return false;
      case 'UnaryExpression':
        return parent.operator !== 'typeof' && parent.operator !== 'delete';
      case 'CallExpression':
        // Wrapping `a.b` in `a.b()` would lose `this`.
        return key !== 'callee' ||
          (node.type !== 'MemberExpression' && node.type !== 'ChainExpression');
      case 'NewExpression':
        return key !== 'callee';
      case 'TaggedTemplateExpression':
        return false;
      default:
        return true;
    }
  }

  // Offset just past the `=>` of a concise arrow function.
  function arrowEnd(fn) {
    let lo = 0;
    let hi = tokens.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tokens[mid].start < fn.body.start) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    for (let i = found; i >= 0; i--)
      if (tokens[i].type.label === '=>') return tokens[i].end;
  }

  // The name a function gets from where it is defined, if any.
  function functionName(fn, parent, key) {
    if (fn.id) return fn.id.name;
    const keyName = (k) => (k.type === 'Identifier' ? k.name :
      k.type === 'Literal' ? String(k.value) : undefined);
    switch (parent.type) {
      case 'VariableDeclarator':
        return parent.id.type === 'Identifier' ? parent.id.name : undefined;
      case 'AssignmentExpression':
        if (parent.left.type === 'Identifier') return parent.left.name;
        if (parent.left.type === 'MemberExpression' && !parent.left.computed)
          return keyName(parent.left.property);
        return undefined;
      case 'Property':
      case 'MethodDefinition':
      case 'PropertyDefinition':
        return key === 'value' && !parent.computed ? keyName(parent.key) : undefined;
    }
  }

  // Each call of an async function reports when it starts and ends. The body
  // runs inside try/finally so a throw still reports the end.
  function traceActivation(fn, parent, key) {
    const id = nextAsyncFnId++;
    ArrayPrototypePush(asyncFns, [id, fn.start, fn.end, functionName(fn, parent, key)]);
    const span = fn.end - fn.start;
    const enter = `const __evloopA=__evloop.a(${id});try{`;
    const exit = '}finally{__evloop.f(__evloopA)}';
    if (fn.body.type === 'BlockStatement') {
      // Directives must stay first, or the body would lose 'use strict'.
      const body = fn.body.body;
      let at = fn.body.start + 1;
      for (let i = 0; i < body.length && body[i].directive !== undefined; i++)
        at = body[i].end;
      ArrayPrototypePush(inserts, [at, false, span, 0, `;${enter}`]);
      ArrayPrototypePush(inserts, [fn.body.end - 1, true, span, 9, exit]);
    } else {
      // Inserting right after `=>` keeps any parentheses around the body
      // inside the return.
      ArrayPrototypePush(inserts, [arrowEnd(fn), false, span, 0, `{${enter}return(`]);
      ArrayPrototypePush(inserts, [fn.end, true, span, 9, `)${exit}}`]);
    }
  }

  // `await x` becomes `r(a, at, await p(a, at, x))`: p reports the pause
  // once x is evaluated, r the resume. The activation and offset arguments
  // are evaluated before the function pauses.
  function traceAwait(node) {
    const span = node.end - node.start;
    const arg = node.argument;
    const argSpan = arg.end - arg.start;
    ArrayPrototypePush(inserts, [node.start, false, span, 3,
                                 `__evloop.r(__evloopA,${node.start},`]);
    ArrayPrototypePush(inserts, [node.end, true, span, -1, ')']);
    ArrayPrototypePush(inserts, [arg.start, false, argSpan, 1,
                                 `__evloop.p(__evloopA,${node.start},`]);
    ArrayPrototypePush(inserts, [arg.end, true, argSpan, 1, ')']);
  }

  function visit(node, parent, key, stmt, inChain, inPattern, skipSelf) {
    if (!kFunctionTypes.has(node.type)) {
      // Top-level await in a module belongs to no activation.
      if (node.type === 'AwaitExpression' && fnContext?.async) traceAwait(node);
      visitNode(node, parent, key, stmt, inChain, inPattern, skipSelf);
      return;
    }
    const outer = fnContext;
    fnContext = { async: node.async };
    if (node.async) traceActivation(node, parent, key);
    visitNode(node, parent, key, stmt, inChain, inPattern, skipSelf);
    fnContext = outer;
  }

  function visitNode(node, parent, key, stmt, inChain, inPattern, skipSelf) {
    if (kFunctionTypes.has(node.type))
      ArrayPrototypePush(funcs, node.start, node.end);
    if (!skipSelf && canWrap(node, parent, key, inChain, inPattern))
      wrapExpression(node, stmt);

    if (node.type === 'ArrowFunctionExpression' && node.expression) {
      // A concise arrow body has no statement, so the body is its own step
      // and serves as the "statement" of the expressions inside it.
      const body = node.body;
      let bodyStmt = stmt;
      if (kWrappable.has(body.type)) bodyStmt = wrapExpression(body, -1);
      visit(body, node, 'body', bodyStmt, false, false, true);
      for (let i = 0; i < node.params.length; i++)
        visitChild(node, 'params', node.params[i], stmt, false, false);
      return;
    }

    const listKey = kStatementLists[node.type];
    if (listKey !== undefined) {
      const list = node[listKey];
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        const id = isProbedStatement(child) ? probeStatement(child, false) : stmt;
        visit(child, node, listKey, id, false, false);
      }
      if (node.type === 'SwitchCase' && node.test)
        visit(node.test, node, 'test', stmt, false, false);
      return;
    }

    const singles = kSingleStatementBodies[node.type];
    if (node.type === 'LabeledStatement') {
      // The probe sits before the label so `continue label` keeps working;
      // the labelled statement itself gets no extra braces.
      visitChildren(node.body, stmt, false, false);
      return;
    }

    for (const childKey in node) {
      if (kSkipKeys.has(childKey)) continue;
      const value = node[childKey];
      if (value === null || typeof value !== 'object') continue;
      if (singles !== undefined && ArrayPrototypeIndexOf(singles, childKey) !== -1 &&
          value.type !== 'BlockStatement' && value.type !== 'EmptyStatement') {
        const id = probeStatement(value, true);
        visit(value, node, childKey, id, false, false);
        continue;
      }
      if (ArrayIsArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] !== null && typeof value[i].type === 'string')
            visitChild(node, childKey, value[i], stmt, inChain, inPattern);
        }
      } else if (typeof value.type === 'string') {
        visitChild(node, childKey, value, stmt, inChain, inPattern);
      }
    }
  }

  function visitChildren(node, stmt, inChain, inPattern) {
    visit(node, { type: '' }, '', stmt, inChain, inPattern, true);
  }

  // Works out the chain and pattern context of `child` from its position.
  function visitChild(node, key, child, stmt, inChain, inPattern) {
    const childInChain =
      (node.type === 'ChainExpression' && key === 'expression') ||
      (inChain &&
       ((node.type === 'MemberExpression' && key === 'object') ||
        (node.type === 'CallExpression' && key === 'callee')));

    let childInPattern = inPattern;
    if (kPatternTypes.has(child.type) ||
        (node.type === 'AssignmentExpression' && key === 'left') ||
        (node.type === 'VariableDeclarator' && key === 'id') ||
        ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') &&
         key === 'left') ||
        (node.type === 'CatchClause' && key === 'param') ||
        key === 'params') {
      childInPattern = true;
    }
    // Defaults and computed keys inside a pattern are ordinary expressions.
    if ((node.type === 'AssignmentPattern' && key === 'right') ||
        (node.type === 'Property' && key === 'key' && node.computed) ||
        (node.type === 'MemberExpression' && key === 'object') ||
        (node.type === 'MemberExpression' && key === 'property' && node.computed)) {
      childInPattern = false;
    }
    // A pattern's default value can still assign to the target: only
    // AssignmentPattern.left stays a target.
    if (node.type === 'AssignmentPattern' && key === 'left')
      childInPattern = true;

    visit(child, node, key, stmt, childInChain, childInPattern);
  }

  visitChildren(ast, -1, false, false);

  // At the same offset, closings come first (innermost first), then
  // openings (outermost first); `rank` breaks ties between equal spans.
  ArrayPrototypeSort(inserts, (a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] ? -1 : 1;
    if (a[1]) return (a[2] - b[2]) || (a[3] - b[3]);
    return (b[2] - a[2]) || (a[3] - b[3]);
  });
  const parts = [];
  // Inserted length up to and including each insertion, to map original
  // offsets to offsets in the instrumented source.
  const shiftAt = [];
  let shift = 0;
  let last = 0;
  for (let i = 0; i < inserts.length; i++) {
    const { 0: pos, 4: text } = inserts[i];
    ArrayPrototypePush(parts, StringPrototypeSlice(source, last, pos), text);
    shift += text.length;
    ArrayPrototypePush(shiftAt, pos, shift);
    last = pos;
  }
  ArrayPrototypePush(parts, StringPrototypeSlice(source, last));
  const out = ArrayPrototypeJoin(parts, '');

  // Offset in `out` of original offset `pos`, past every insertion at it.
  let cursor = 0;
  let shifted = 0;
  function outPos(pos) {
    while (cursor < shiftAt.length && shiftAt[cursor] <= pos) {
      shifted = shiftAt[cursor + 1];
      cursor += 2;
    }
    return pos + shifted;
  }
  // Flat [start, end, outStart, outEnd, ...] sorted by start; outPos needs
  // ascending input, so ends are mapped in a second sorted pass.
  const funcRows = [];
  for (let i = 0; i < funcs.length; i += 2)
    ArrayPrototypePush(funcRows, [funcs[i], funcs[i + 1], 0, 0]);
  ArrayPrototypeSort(funcRows, (a, b) => a[0] - b[0]);
  for (let i = 0; i < funcRows.length; i++) funcRows[i][2] = outPos(funcRows[i][0]);
  const byEnd = ArrayPrototypeSlice(funcRows);
  ArrayPrototypeSort(byEnd, (a, b) => a[1] - b[1]);
  cursor = 0;
  shifted = 0;
  for (let i = 0; i < byEnd.length; i++) byEnd[i][3] = outPos(byEnd[i][1]);

  trace(kTraceInstant, kCategory, 'src:source', 0, {
    queue: 'src', op: 'source', file: filename, text: source, base, nodes,
    funcs: funcRows,
    asyncFns,
    tokenClasses: kTokenClasses,
    tokens: classifyTokens(tokens, comments),
  });
  return out;
}

function probe(op, id) {
  trace(kTraceInstant, kCategory, 'src', 0, { queue: 'src', op, id });
}

let nextActivationId = 0;

function setupEvloopTrace() {
  isEnabled = categoryEnabledChecker(kCategory);
  module.exports.isEnabled = isEnabled;
  if (!isEnabled()) return;
  startPromiseTracking();
  ObjectDefineProperty(globalThis, '__evloop', {
    __proto__: null,
    enumerable: false,
    configurable: false,
    writable: false,
    value: ObjectFreeze({
      __proto__: null,
      s(id) { probe('s', id); },
      e(id) { probe('e', id); },
      x(id, value) { probe('x', id); return value; },
      // Async function activations: a call starts (a), pauses at an await
      // (p), resumes after it (r) and ends (f). `at` is the await's offset.
      a(fn) {
        const id = ++nextActivationId;
        emit('act', 'enter', id, { fn });
        return id;
      },
      p(id, at, value) { emit('act', 'await', id, { at }); return value; },
      r(id, at, value) { emit('act', 'resume', id, { at }); return value; },
      f(id) { emit('act', 'exit', id); },
    }),
  });
  probesInstalled = true;
}

module.exports = {
  isEnabled,
  emit,
  enqueue,
  instrument,
  noteRequestedDelay,
  takeRequestedDelay,
  userSite,
  wrapMicrotask,
  setupEvloopTrace,
};
