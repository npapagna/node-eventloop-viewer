# Event loop viewer

Replays what a real Node.js run did, one step at a time: libuv loop phases,
the nextTick, microtask, timer and immediate queues, and the JS source that
ran, down to each expression.

It needs the instrumented build from this branch (`node.evloop` trace
category). The tracer is in `lib/internal/evloop_trace.js`, plus phase hooks
in libuv and `src/`.

## Build

The viewer is a static page with no build step of its own. What needs
building is Node.js itself, from this branch. First install the tools Node.js
needs for your platform: see [Prerequisites](../../BUILDING.md#prerequisites)
and [Unix and macOS](../../BUILDING.md#unix-and-macos) in `BUILDING.md`.

```bash
git clone https://github.com/npapagna/node-eventloop-viewer.git
cd node-eventloop-viewer
git checkout eventloop-viewer
./configure --node-builtin-modules-path "$(pwd)"   # JS edits apply without rebuilding
make -j8
```

The first build compiles all of Node.js and V8 and takes a while. With
`--node-builtin-modules-path`, edits to `lib/` (the tracer included) take
effect on the next run; edits to `src/` or `deps/uv/` need `make -j8` again.
See [Loading JS files from disk](../../BUILDING.md#loading-js-files-from-disk-instead-of-embedding).

On Windows, build with `vcbuild.bat` as described in
[`BUILDING.md`](../../BUILDING.md#windows). Loop phase events are emitted on
Unix only, so traces there have no phases.

## Run

From the repository root:

```bash
out/Release/node tools/evloop-viewer/server.js     # http://127.0.0.1:8765/
```

Open the URL in a browser. Stop the server with Ctrl+C.

### Run code from the viewer

Pick an example, edit it or write your own, and press **Run** (⌘/Ctrl+Enter).
The server runs it with the instrumented build and loads the trace.

Type what you expect it to print in the box next to the editor. The
**Output** tab then finds the first line Node.js printed differently and explains
why, for example that `process.nextTick` callbacks run before promise jobs.

* Each run is killed after 10 s.
* `.mjs` names run as ES modules.
* `?example=<name>` preselects an example.

The run endpoint executes code, so it only answers the page it served. It
listens on loopback only, checks Host and Origin, and needs a per-process
token.

## What the viewer shows

Each step fits on one screen: your code on the left, and on the right what
just happened (**Now**) above a compact view of the loop. The timeline and the
detail tabs (Up next, Output, Gotchas, Compare, Events) sit below. Click the
open tab to fold the tabs away.

Pick the step size in the header. **Events** (the default) steps through what
the loop does: phases, callbacks queued and run, output. **Statements** and
**Expressions** also step through your code. The View menu has predict mode,
Node.js internals, empty phases, the theme (system, light or dark) and the keys.

* **Timeline**: lanes for loop phases, callbacks, nextTicks and microtasks,
  and output, plus a bar for each callback while it waits in its queue. Each
  call of an async function gets its own lane (up to 8), showing where it
  runs and where it is paused at an `await`.
  _Order_ gives every event the same width; _real time_ shows durations, with
  a warning that tracing makes them longer. Click a block to jump there.
* **Now**: one line on what just happened, and at most a sentence or two of
  warning. **Why now?** opens the rule behind it and the warning's detail (and
  stays open once you open it).
* **Event loop**: compact by default, listing only what is queued; **Expand**
  shows each phase's description and the side panel in full. Each phase with
  the queue it drains (timers, I/O in poll,
  immediates in check), and below them the nextTick, microtask and rejection
  queues that drain after every callback Node.js runs from the loop, in any
  phase. That band lights up while it drains. Each queue has a **?** with what
  it is for and links to the docs. Click a queued callback to see why it
  hasn't run yet: what is ahead of it, which phase it waits for, or how long
  until a timer is due.
* **Paused at await**: the async calls paused right now, where, and since
  when.

## What the viewer explains

* **Async calls**: every call of an async function is numbered
  (`executeAsync #1`, `executeAsync #2`), with steps for when it starts,
  pauses at an `await`, resumes and finishes. When a call resumes, the
  viewer lists what ran while it was paused: other calls and callbacks.
  These gaps are where other code can change state the call relies on.

* **Why now?** Each callback run, phase and I/O callback states the Node.js
  rule that made it next, and links back to the step that queued it.

* **Poll timeouts** say what decided how long libuv may sleep.

* **Up next** predicts the next callbacks from the current queues, then shows
  what actually ran and why it differed.

* **Predict mode** hides the prediction: pick which callback runs next, and the
  viewer jumps there, says whether you were right and keeps score.

* **Phase cards** say what the current phase is for and how much is waiting
  for each phase.

* **Keeping the loop alive** lists what refs the loop after each iteration
  (servers, sockets, timers, requests in flight), and the steps show when the
  loop exits and when `'beforeExit'` runs.

* **Timer lateness** uses the loop clock of Node.js: when the timer was due, and
  what the clock read when its timers phase started.

* **Compare runs**: set a run as the baseline, run again or edit and run, and
  see where the callback order and output differ.

* **Gotchas in this run** flags:
  * `setTimeout(0)` vs `setImmediate` races
  * callbacks that block the loop (20 ms or more), and timers delayed by them
  * chains of 100 or more nextTicks or microtasks that starve the loop
  * delays Node.js changed (`0` and other values below 1 ms become 1 ms)
  * timers that ran out of due order because Node.js runs one timer list (one
    per delay) at a time
  * `setInterval` drifting behind its schedule
  * unhandled rejections, and handlers attached too late
  * extra microtask turns from returning promises in `.then()`
  * extra microtask turns from resolving a promise with another promise
  * `await` on non-promises
  * calls of the same async function that overlap, so shared state can
    change between one call's awaits

Explanations link to the Node.js and libuv docs for the rule behind them.
They come from the trace alone. Durations include tracing overhead.

## Trace any script yourself

```bash
out/Release/node --trace-event-categories node.evloop \
  --trace-event-file-pattern tools/evloop-viewer/traces/mine.json my-script.js
```

Then open `http://127.0.0.1:8765/?trace=traces/mine.json`, or open or drop
the file into the viewer.

## Keys

| Key        | Action                                    |
| ---------- | ----------------------------------------- |
| → / ←      | step / back                               |
| Space      | play / pause                              |
| `o`        | step over (finish the current expression) |
| `p`        | next loop phase                           |
| `r`        | next callback run                         |
| Home / End | first / last step                         |

Letter keys work with or without Shift. Step over only applies to the
Statements and Expressions step sizes.

## Checking the viewer

`test/` runs the viewer script against the saved traces with a stub DOM, so
no browser is needed:

```bash
out/Release/node tools/evloop-viewer/test/check.js       # assert the explanations
out/Release/node tools/evloop-viewer/test/show.js 01-basics [regex]  # print each step
out/Release/node tools/evloop-viewer/test/dump.js <trace.json> <regex>  # raw events
out/Release/node tools/evloop-viewer/test/retrace.js     # re-record traces/ via the running server
```

`test/cdp.js <url> <out-prefix> [js ...]` takes screenshots with headless
Chrome. Set `CHROME` if the browser is not at the default macOS path, and
`WIDTH`/`HEIGHT` to change the 1440x1300 viewport (for example `WIDTH=390`
for a phone).

## Limits

* Only user files are stepped. Node.js internals and `node_modules` are not.
* An `await` whose promise rejects resumes by throwing, which the tracer
  does not see. The call shows as paused until its next `await` or its end.
* `for await` loops, `yield` in async generators, and top-level `await` in
  ES modules are not tracked as pauses.
* Promise jobs are inferred from promise hooks. V8 reports no event when
  resolving a promise with another promise queues a job, so that job
  first shows up when it runs.
* Loop phase events are emitted on Unix only.
* The source line Node.js prints under an uncaught error shows the probe calls.
  Line numbers are still exact.
* `setTimeout(fn, 0)` versus `setImmediate(fn)` from the main script is a
  real race, so traces of it can differ between runs.
* The keep-alive list uses the names from `process.getActiveResourcesInfo()`,
  minus idle handles. Some work, such as `fs.readFile`, has no name there; the
  viewer then only says libuv still has work.
* The compare baseline is kept in this browser only.
