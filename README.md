# llm-agent-loop

A lightweight, provider-agnostic agent loop for building LLM agents in TypeScript.

## Features

- **Generic**: Works with any LLM provider (OpenAI, Anthropic, Gemini, etc.).
- **Flexible**: Custom stop conditions, context updates, and max loop limits.
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
    return "Response from LLM"; 
  },

  // Condition to stop the loop
  stopCondition: (response, context) => {
    return response.includes("DONE");
  },

  // Optional: Update context based on response
  updateContext: (response, ctx) => {
    return {
      messages: [...ctx.messages, { role: 'assistant', content: response }]
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
- `stopCondition`: `(response: TResponse, context: TContext) => boolean | Promise<boolean>` - Optional predicate to stop the loop early. If omitted, the loop never stops early and runs until `maxLoops` (or the `signal` aborts).
- `maxLoops`: `number` (default: 10) - Maximum number of iterations.
- `updateContext`: `(response: TResponse, context: TContext) => TContext | Promise<TContext>` - Optional function to update context.
- `onStep`: `(step: AgentLoopStep<TResponse, TContext>) => void | Promise<void>` - Optional per-iteration callback for observability (logging, tracing, progress, token accounting). Called after each LLM response and stop-condition check, before `updateContext` runs. If it returns a promise, the loop awaits it.
- `signal`: `AbortSignal` - Optional signal to cancel the loop. Checked at the start of each iteration; if aborted, the loop resolves with `reason: 'aborted'` (it does not throw). An in-flight `llmCaller` is not interrupted — forward the signal into your `llmCaller` (e.g. to `fetch`) to abort the call itself.
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
- `reason`: `'stop_condition' | 'max_loops' | 'aborted'` - Why the loop stopped.
- `iterations`: `number` - Number of iterations performed.

#### Fixed-iteration loops (no `stopCondition`)

`stopCondition` is optional. Omit it to run a fixed number of turns and let `maxLoops` terminate the loop — no `() => false` boilerplate required:

```typescript
const result = await agentLoop<string, MyContext>({
  initialContext: { messages: [] },
  llmCaller: async (ctx) => "Response from LLM",
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

#### Note: the final response is not folded into `finalContext` on stop

The loop runs in this order each iteration: call `llmCaller` → check `stopCondition` → (if not stopping) run `updateContext`. When `stopCondition` returns `true`, the loop returns **before** `updateContext` runs, so the response that triggered the stop is **not** merged into `finalContext`.

That final response is always available as `result.lastResponse`. If you use `finalContext` as your complete message history/transcript, append `lastResponse` yourself when `reason` is `'stop_condition'`:

```typescript
const result = await agentLoop<string, MyContext>({ /* ... */ });

// finalContext.messages does NOT include the response that stopped the loop.
const fullMessages =
  result.reason === 'stop_condition' && result.lastResponse !== undefined
    ? [...result.finalContext.messages, { role: 'assistant', content: result.lastResponse }]
    : result.finalContext.messages;
```

## Development Tasks

You can track the development progress and completed tasks in [TASKS.md](./TASKS.md). These tasks are executed by the **Antigravity Agent**.

---

*This project was created with [Google Antigravity](https://antigravity.google/).*
