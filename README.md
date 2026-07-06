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

## API

### `agentLoop(options)`

Runs the agent loop.

#### Options

- `llmCaller`: `(context: TContext) => Promise<TResponse>` - Function to call the LLM.
- `stopCondition`: `(response: TResponse, context: TContext) => boolean | Promise<boolean>` - Predicate to stop the loop.
- `maxLoops`: `number` (default: 10) - Maximum number of iterations.
- `updateContext`: `(response: TResponse, context: TContext) => TContext | Promise<TContext>` - Optional function to update context.
- `initialContext`: `TContext` - Initial state.

#### Returns

- `finalContext`: `TContext` - The context after the loop finishes. See the note below about the final response.
- `lastResponse`: `TResponse | undefined` - The last response from the LLM.
- `reason`: `'stop_condition' | 'max_loops'` - Why the loop stopped.
- `iterations`: `number` - Number of iterations performed.

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
