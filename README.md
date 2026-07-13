# llm-agent-loop

[![npm version](https://img.shields.io/npm/v/llm-agent-loop.svg)](https://www.npmjs.com/package/llm-agent-loop)
[![CI](https://github.com/rjolaverria/llm-agent-loop/actions/workflows/test.yml/badge.svg)](https://github.com/rjolaverria/llm-agent-loop/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/llm-agent-loop.svg)](https://github.com/rjolaverria/llm-agent-loop/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/llm-agent-loop.svg)](https://nodejs.org)

A lightweight, provider-agnostic agent loop for building LLM agents in TypeScript.

## Features

- **Generic**: Works with any LLM provider (OpenAI, Anthropic, Gemini, etc.).
- **Flexible**: Custom stop conditions, context updates, and max loop limits.
- **Observable**: Per-step `onStep` callback or a streaming `agentLoopStream` async iterator.
- **Type-Safe**: Written in TypeScript with generic types for response and context.
- **Zero Dependencies**: Pure logic, no bloat.

## Installation

```bash
npm install llm-agent-loop
```

## Usage

```typescript
import { agentLoop } from 'llm-agent-loop';

// Define your context type
interface MyContext {
  messages: { role: string; content: string }[];
}

// Run the loop
const result = await agentLoop<string, MyContext>({
  initialContext: { messages: [] },

  // Function to call your LLM
  llmCaller: async (ctx) => {
    // Call OpenAI, Anthropic, etc.
    return 'Response from LLM';
  },

  // Condition to stop the loop
  stopCondition: (response, context) => {
    return response.includes('DONE');
  },

  // Optional: Update context based on response
  updateContext: (response, ctx) => {
    return {
      messages: [...ctx.messages, { role: 'assistant', content: response }],
    };
  },

  maxLoops: 5,
});

console.log(result.reason); // 'stop_condition' or 'max_loops'
console.log(result.lastResponse);
```

### Real-provider example

The snippet above uses a stubbed `llmCaller`. For an end-to-end example against a
real provider — a Claude tool-calling loop that executes tools and feeds the
results back — see [`examples/anthropic-tool-call.ts`](https://github.com/rjolaverria/llm-agent-loop/blob/main/examples/anthropic-tool-call.ts)
and the [examples README](https://github.com/rjolaverria/llm-agent-loop/tree/main/examples).

## API

### `agentLoop(options)`

Runs the agent loop.

#### Options

- `llmCaller`: `(context: TContext) => Promise<TResponse>` - Function to call the LLM.
- `stopCondition?`: `(response: TResponse, context: TContext) => boolean | Promise<boolean>` - Optional predicate to stop the loop early. If omitted, the loop never stops early and runs until `maxLoops` (or the `signal` aborts).
- `maxLoops?`: `number` (default: 10) - Maximum number of iterations.
- `updateContext?`: `(response: TResponse, context: TContext) => TContext | Promise<TContext>` - Optional function to update context.
- `onStep?`: `(step: AgentLoopStep<TResponse, TContext>) => void | Promise<void>` - Optional per-iteration callback for observability (logging, tracing, progress, token accounting). Called after each LLM response and stop-condition check, before `updateContext` runs. If it returns a promise, the loop awaits it.
- `onError?`: `(error: unknown, info: AgentLoopErrorInfo<TContext>) => 'retry' | 'stop' | 'throw' | Promise<...>` - Optional handler for errors thrown by `llmCaller`. Decide per-error whether to `'retry'` the call, `'stop'` the loop (resolving with `reason: 'error'`), or `'throw'` (re-raise). Only `llmCaller` failures are routed here; errors from `stopCondition`/`updateContext`/`onStep` and aborts always take precedence. See [Error handling](#error-handling-with-onerror).
- `signal?`: `AbortSignal` - Optional signal to cancel the loop. Checked at the start of each iteration; if aborted, the loop resolves with `reason: 'aborted'` (it does not throw). An in-flight `llmCaller` is not interrupted — forward the signal into your `llmCaller` (e.g. to `fetch`) to abort the call itself.
- `collectHistory?`: `boolean` (default: false) - When true, the result includes a `history` array of every response in order. Opt-in to avoid retaining every response for long-running loops.
- `initialContext`: `TContext` - Initial state.

Each `onStep` receives an `AgentLoopStep`:

- `iteration`: `number` - 1-based index of the current iteration.
- `response`: `TResponse` - The response from `llmCaller` this iteration.
- `context`: `TContext` - The context that produced this response (before `updateContext` runs). This is the live reference, not a snapshot — if your `updateContext` mutates in place, copy it inside `onStep` for a stable snapshot.
- `willStop`: `boolean` - Whether the loop will stop after this iteration (stop condition met, `maxLoops` reached, or the `signal` was aborted).

```typescript
const result = await agentLoop<string, MyContext>({
  // ...
  onStep: ({ iteration, response, willStop }) => {
    console.log(`[step ${iteration}] ${response}${willStop ? ' (last)' : ''}`);
  },
});
```

#### Returns

- `finalContext`: `TContext` - The context after the loop finishes. See the note below about the final response.
- `lastResponse`: `TResponse | undefined` - The last response from the LLM.
- `reason`: `'stop_condition' | 'max_loops' | 'aborted' | 'error'` - Why the loop stopped (`'aborted'` only with a `signal`; `'error'` only with an `onError` that returned `'stop'`).
- `iterations`: `number` - Number of iterations performed.
- `durationMs`: `number` - Total wall-clock time of the loop, in milliseconds.
- `history?`: `TResponse[]` - Every response in order, including the one that stopped the loop. Present only when `collectHistory: true`; the property is omitted otherwise (so `result.history` is `undefined`). Unlike `finalContext`, `history` always includes the terminal response, so it's the complete transcript for a `'stop_condition'` stop without the manual append `finalContext` needs.

#### Error handling with `onError`

By default, a single rejected `llmCaller` call rejects the whole loop and discards accumulated context. Since agent loops are long-lived and expect transient failures (rate limits, network blips), pass an `onError` handler to decide what to do per-error:

```typescript
const result = await agentLoop<string, MyContext>({
  // ...
  onError: (error, { attempt }) => {
    if (attempt < 3) return 'retry'; // re-call llmCaller (same iteration)
    return 'throw'; // give up after 3 attempts
  },
});
```

The handler returns one of:

- `'retry'` — call `llmCaller` again with the same context. Retries stay within the same iteration (they don't consume a `maxLoops` turn) and are **caller-bounded**: use `attempt` from the handler's second argument (`info`, destructured as `{ attempt }` above; 1-based, increments per retry) to stop, or the loop retries forever.
- `'stop'` — stop the loop gracefully; the result's `reason` is `'error'`.
- `'throw'` — re-throw the original error (the default when no `onError` is given).

`info` is `{ context, iteration, attempt }`. Only `llmCaller` failures are routed to `onError` — errors thrown by `stopCondition`, `updateContext`, or `onStep` are treated as programming errors and always propagate. An aborted `signal` takes precedence: an abort-caused rejection resolves `'aborted'` without calling `onError`, and if the signal aborts _while_ `onError` is running the loop resolves `'aborted'` regardless of the returned action.

> A handler that ignores its arguments and returns a bare constant (e.g. `() => 'stop'`) needs `as const` or a return annotation (`(): AgentLoopErrorAction => 'stop'`) so TypeScript infers the literal. Handlers that inspect `error`/`info` don't need this.

#### Fixed-iteration loops (no `stopCondition`)

`stopCondition` is optional. Omit it to run a fixed number of turns and let `maxLoops` terminate the loop — no `() => false` boilerplate required:

```typescript
const result = await agentLoop<string, MyContext>({
  initialContext: { messages: [] },
  llmCaller: async (ctx) => 'Response from LLM',
  maxLoops: 3, // run exactly 3 iterations
});

console.log(result.reason); // 'max_loops'
```

#### Cancellation with `AbortSignal`

```typescript
const controller = new AbortController();

// Cancel from a UI "Stop" button or a timeout.
setTimeout(() => controller.abort(), 5000);

const result = await agentLoop<string, MyContext>({
  // ...
  signal: controller.signal,
});

if (result.reason === 'aborted') {
  console.log('Loop was cancelled.');
}
```

The signal is checked at the start of each iteration, so an already-running `llmCaller` still finishes. To cancel the in-flight request too, forward `signal` into your provider call (most SDKs and `fetch` accept one).

### `agentLoopStream(options)`

The streaming counterpart to `agentLoop`. It takes the **same options** and is an async generator that `yield`s each [`AgentLoopStep`](#options) as it happens — ideal for rendering progress as each iteration completes. `agentLoop` is itself implemented by draining this generator, so the two share identical loop, abort, and error semantics.

```typescript
import { agentLoopStream } from 'llm-agent-loop';

for await (const step of agentLoopStream<string, MyContext>({/* ...same options... */})) {
  console.log(`[step ${step.iteration}] ${step.response}${step.willStop ? ' (last)' : ''}`);
}
```

A step is yielded once per iteration that produces a response (after `onStep`, before `updateContext`). For a `'stop_condition'` stop — or a `'max_loops'` stop that ran at least one iteration — the terminal step is yielded before the result is returned. Other outcomes may return **without** a step for the terminating iteration: an already-aborted signal yields nothing, an `onError` that returns `'stop'` produced no response that iteration, and `maxLoops <= 0` returns `'max_loops'` without running at all. `for await` consumes the steps but discards the generator's **return value** (the `AgentLoopResult`). To capture the final result too, iterate manually:

```typescript
const stream = agentLoopStream<string, MyContext>({/* ... */});

let next = await stream.next();
while (!next.done) {
  render(next.value); // a step
  next = await stream.next();
}

const result = next.value; // AgentLoopResult — reason, finalContext, durationMs, ...
```

Unlike `agentLoop`, there is no reason-narrowing overload — `result.reason` is the full `'stop_condition' | 'max_loops' | 'aborted' | 'error'` union.

#### Note: the final response is not folded into `finalContext` on stop

The loop runs in this order each iteration: call `llmCaller` → check `stopCondition` → (if not stopping) run `updateContext`. When `stopCondition` returns `true`, the loop returns **before** `updateContext` runs, so the response that triggered the stop is **not** merged into `finalContext`.

That final response is always available as `result.lastResponse`. If you use `finalContext` as your complete message history/transcript, append `lastResponse` yourself when `reason` is `'stop_condition'`:

```typescript
const result = await agentLoop<string, MyContext>({/* ... */});

// finalContext.messages does NOT include the response that stopped the loop.
const fullMessages =
  result.reason === 'stop_condition' && result.lastResponse !== undefined
    ? [...result.finalContext.messages, { role: 'assistant', content: result.lastResponse }]
    : result.finalContext.messages;
```

## Development Tasks

You can track the development progress and completed tasks in [TASKS.md](./TASKS.md). These tasks are executed by the **Antigravity Agent**.

---

_This project was created with [Google Antigravity](https://antigravity.google/)._
