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

- `finalContext`: `TContext` - The context after the loop finishes.
- `lastResponse`: `TResponse | undefined` - The last response from the LLM.
- `reason`: `'stop_condition' | 'max_loops'` - Why the loop stopped.
- `iterations`: `number` - Number of iterations performed.

## Development Tasks

You can track the development progress and completed tasks in [TASKS.md](./TASKS.md). These tasks are executed by the **Antigravity Agent**.

---

*This project was created with [Google Antigravity](https://antigravity.google/).*
