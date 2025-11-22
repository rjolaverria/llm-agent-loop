import { describe, it, expect, vi } from 'vitest';
import { agentLoop } from './index.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic
const mockCreate = vi.fn();
const mockAnthropic = {
  messages: {
    create: mockCreate,
  },
} as unknown as Anthropic;

describe('Claude Simulation', () => {
  it('should run a chat loop with Claude', async () => {
    // Simulate:
    // 1. User: "Hello"
    // 2. Model: "Hi there!"
    // 3. User: "Stop"
    // 4. Model: "Goodbye" -> Stop

    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hi there!' }],
        role: 'assistant',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Goodbye' }],
        role: 'assistant',
      });

    interface ClaudeContext {
      messages: Anthropic.MessageParam[];
    }

    const initialContext: ClaudeContext = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await agentLoop<Anthropic.Message, ClaudeContext>({
      initialContext,
      llmCaller: async (ctx) => {
        return await mockAnthropic.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: ctx.messages,
        });
      },
      stopCondition: (response) => {
        const textBlock = response.content.find(b => b.type === 'text') as Anthropic.TextBlock;
        return textBlock?.text === 'Goodbye';
      },
      updateContext: (response, ctx) => {
        // Append assistant response
        const newMsg: Anthropic.MessageParam = {
          role: 'assistant',
          content: response.content as any, // Simplified for test
        };
        return {
          messages: [...ctx.messages, newMsg],
        };
      },
      maxLoops: 5,
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(2);
    const lastBlock = result.lastResponse?.content[0] as Anthropic.TextBlock;
    expect(lastBlock.text).toBe('Goodbye');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('should handle Claude tool calls', async () => {
    // Simulate:
    // 1. User: "Weather in SF?"
    // 2. Model: ToolUse(get_weather, {location: "SF"})
    // 3. System: ToolResult(Sunny)
    // 4. Model: "It is sunny." -> Stop

    mockCreate.mockReset();

    // Response 1: Tool Use
    const toolUseBlock: Anthropic.ToolUseBlock = {
      type: 'tool_use',
      id: 'tool_1',
      name: 'get_weather',
      input: { location: 'SF' },
    };

    mockCreate.mockResolvedValueOnce({
      content: [toolUseBlock],
      role: 'assistant',
      stop_reason: 'tool_use',
    });

    // Response 2: Final Answer
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'It is sunny.' }],
      role: 'assistant',
      stop_reason: 'end_turn',
    });

    interface ClaudeContext {
      messages: Anthropic.MessageParam[];
    }

    const initialContext: ClaudeContext = {
      messages: [{ role: 'user', content: 'Weather in SF?' }],
    };

    const result = await agentLoop<Anthropic.Message, ClaudeContext>({
      initialContext,
      llmCaller: async (ctx) => {
        return await mockAnthropic.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: ctx.messages,
        });
      },
      stopCondition: (response) => {
        return response.stop_reason === 'end_turn';
      },
      updateContext: async (response, ctx) => {
        const newMessages = [...ctx.messages];
        
        // 1. Add assistant's tool use message
        newMessages.push({
          role: 'assistant',
          content: response.content as any,
        });

        // 2. Process tool uses
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
        
        if (toolUseBlocks.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          
          for (const block of toolUseBlocks) {
            if (block.name === 'get_weather') {
              // Simulate execution
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: 'Sunny',
              });
            }
          }

          // 3. Add tool results as a user message
          if (toolResults.length > 0) {
            newMessages.push({
              role: 'user',
              content: toolResults,
            });
          }
        }

        return { messages: newMessages };
      },
      maxLoops: 5,
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(2);
    const lastBlock = result.lastResponse?.content[0] as Anthropic.TextBlock;
    expect(lastBlock.text).toBe('It is sunny.');
    
    // Verify context
    // 1. User
    // 2. Assistant (Tool Use)
    // 3. User (Tool Result)
    // Final answer loop stops, so not in context.
    expect(result.finalContext.messages).toHaveLength(3);
    
    const lastMsg = result.finalContext.messages[2];
    expect(lastMsg.role).toBe('user');
    const lastContent = lastMsg.content as Anthropic.ToolResultBlockParam[];
    expect(lastContent[0].type).toBe('tool_result');
    expect(lastContent[0].content).toBe('Sunny');
  });
});
