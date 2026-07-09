# Examples

Runnable, real-provider examples for `llm-agent-loop`.

## `anthropic-tool-call.ts`

A tool-calling agent loop against the real Anthropic (Claude) API. Claude is
given a `get_weather` tool; the loop executes each tool call it requests, feeds
the results back, and stops once Claude returns a final text answer.

### Run it

From a clone of this repo. The example imports `llm-agent-loop`, which resolves
to the built `dist/`, so build first:

```bash
npm install
npm run build
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx examples/anthropic-tool-call.ts
```

In your own project you'd install the published package instead:
`npm install llm-agent-loop @anthropic-ai/sdk`.

> The example calls a paid API and will incur token costs.

### What it shows

- Wiring a real provider SDK into `llmCaller`.
- Driving a multi-turn tool-use loop via `updateContext` (append the assistant
  turn, run the tools, append `tool_result` messages).
- Stopping on `stop_reason === 'end_turn'`.
- Reading the final answer from `result.lastResponse` — because the loop stops
  _before_ `updateContext` runs on the final turn, the terminating response is
  intentionally _not_ folded into `finalContext`.

The same flow is exercised without a real API key in
[`src/claude_simulation.test.ts`](../src/claude_simulation.test.ts).
