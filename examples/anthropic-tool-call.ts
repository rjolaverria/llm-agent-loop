/**
 * Real-provider example: a tool-calling agent loop with Anthropic's Claude.
 *
 * This mirrors the pattern exercised by `src/claude_simulation.test.ts`, but
 * against the real API instead of a mock. It:
 *   1. Sends a user question to Claude with a `get_weather` tool available.
 *   2. Executes any tool calls Claude requests and feeds the results back.
 *   3. Loops until Claude produces a final text answer (stop_reason 'end_turn').
 *
 * Run it:
 *   npm install llm-agent-loop @anthropic-ai/sdk
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npx tsx examples/anthropic-tool-call.ts
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
function runTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'get_weather':
      return `The weather in ${String(input.location)} is sunny and 72°F.`;
    default:
      return `Unknown tool: ${name}`;
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
    llmCaller: async (ctx) => {
      return await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools,
        messages: ctx.messages,
      });
    },

    // Stop once Claude gives a normal text answer instead of another tool call.
    stopCondition: (response) => response.stop_reason === 'end_turn',

    // Fold the assistant turn (and any tool results) back into the transcript.
    updateContext: (response, ctx) => {
      const messages = [...ctx.messages];

      // 1. Record the assistant's message (may contain tool_use blocks).
      messages.push({ role: 'assistant', content: response.content });

      // 2. Execute every tool the model asked for and return the results.
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (toolUses.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((block) => ({
          type: 'tool_result',
          tool_use_id: block.id,
          content: runTool(block.name, block.input as Record<string, unknown>),
        }));
        messages.push({ role: 'user', content: toolResults });
      }

      return { messages };
    },

    maxLoops: 5,
  });

  // NOTE: because the loop stops *before* updateContext runs on the final turn,
  // the last assistant answer is NOT in `finalContext.messages` — it lives on
  // `lastResponse`. See the README "final response" note for details.
  const finalText = result.lastResponse?.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );

  console.log(`Stopped because: ${result.reason} (after ${result.iterations} iterations)`);
  console.log(`Answer: ${finalText?.text ?? '(no text answer)'}`);
}

main().catch((err) => {
  console.error('Agent loop failed:', err);
});
