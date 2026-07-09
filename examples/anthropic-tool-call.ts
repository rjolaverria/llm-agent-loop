/**
 * Real-provider example: a tool-calling agent loop with Anthropic's Claude.
 *
 * This mirrors the pattern exercised by `src/claude_simulation.test.ts`, but
 * against the real API instead of a mock. It:
 *   1. Sends a user question to Claude with a `get_weather` tool available.
 *   2. Executes any tool calls Claude requests and feeds the results back.
 *   3. Loops until Claude produces a final text answer (stop_reason 'end_turn').
 *
 * Run it from a clone of this repo (the `llm-agent-loop` import resolves to the
 * built `dist/`, so a build step is required):
 *   npm install
 *   npm run build
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npx tsx examples/anthropic-tool-call.ts
 *
 * In your own project, install the published package instead:
 *   npm install llm-agent-loop @anthropic-ai/sdk
 */
import { agentLoop } from 'llm-agent-loop';
import Anthropic from '@anthropic-ai/sdk';

// The SDK automatically reads the ANTHROPIC_API_KEY environment variable.
const client = new Anthropic();

// The tool we expose to the model.
const tools: Anthropic.Tool[] = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a location.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name, e.g. "San Francisco"' },
      },
      required: ['location'],
    },
  },
];

// Our own tool implementations. In a real app these would hit an API/DB.
// The model controls tool inputs, so validate them rather than trusting the shape.
function runTool(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'get_weather': {
      const location = args.location;
      if (typeof location !== 'string' || location.trim() === '') {
        return 'Error: get_weather requires a non-empty "location" string.';
      }
      return `The weather in ${location} is sunny and 72°F.`;
    }
    default:
      return `Error: unknown tool "${name}".`;
  }
}

interface ChatContext {
  messages: Anthropic.MessageParam[];
}

async function main() {
  const initialContext: ChatContext = {
    messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
  };

  const result = await agentLoop<Anthropic.Message, ChatContext>({
    initialContext,

    // Call the real Claude API with the running conversation.
    llmCaller: (ctx) =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools,
        messages: ctx.messages,
      }),

    // Stop once Claude gives a normal text answer instead of another tool call.
    stopCondition: (response) => response.stop_reason === 'end_turn',

    // Fold the assistant turn (and any tool results) back into the transcript.
    updateContext: (response, ctx) => {
      const messages = [...ctx.messages];

      // 1. Record the assistant's message (may contain tool_use blocks).
      messages.push({ role: 'assistant', content: response.content });

      // 2. Execute every tool the model asked for and return the results.
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (toolUses.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((block) => ({
          type: 'tool_result',
          tool_use_id: block.id,
          content: runTool(block.name, block.input),
        }));
        messages.push({ role: 'user', content: toolResults });
      }

      return { messages };
    },

    maxLoops: 5,
  });

  // NOTE: because the loop stops *before* updateContext runs on the final turn,
  // the last assistant answer is NOT in `finalContext.messages` — it lives on
  // `lastResponse`, which is why we read the answer from there below.
  const finalText = result.lastResponse?.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );

  console.log(`Stopped because: ${result.reason} (after ${result.iterations} iterations)`);
  console.log(`Answer: ${finalText?.text ?? '(no text answer)'}`);
}

main().catch((err) => {
  console.error('Agent loop failed:', err);
  // Rethrow so the process exits with a non-zero status (e.g. on a missing
  // ANTHROPIC_API_KEY, a 401, or a rate-limit error) instead of looking
  // successful to shells and CI.
  throw err;
});
