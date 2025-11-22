import { describe, it, expect, vi } from 'vitest';
import { agentLoop } from './index.js';
import OpenAI from 'openai';

// Mock OpenAI
const mockCreate = vi.fn();
const mockOpenAI = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
} as unknown as OpenAI;

describe('OpenAI Simulation', () => {
  it('should run a chat loop with OpenAI', async () => {
    // Simulate a conversation:
    // 1. User: "Hello"
    // 2. Model: "Hi there! How can I help?"
    // 3. User: "Count to 3"
    // 4. Model: "1, 2, 3"
    // 5. User: "Stop"
    // 6. Model: "Goodbye" -> Stop condition met

    // We'll mock the model's responses.
    // The loop will call the LLM with the current history.
    // We'll update the history with the model's response.
    
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Hi there! How can I help?' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: '1, 2, 3' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Goodbye' } }],
      });

    interface ChatContext {
      messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    }

    const initialContext: ChatContext = {
      messages: [{ role: 'user', content: 'Start' }],
    };

    const result = await agentLoop<OpenAI.Chat.Completions.ChatCompletion, ChatContext>({
      initialContext,
      llmCaller: async (ctx) => {
        return await mockOpenAI.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: ctx.messages,
        });
      },
      stopCondition: (response) => {
        const content = response.choices[0].message.content;
        return content === 'Goodbye';
      },
      updateContext: (response, ctx) => {
        const newMsg = response.choices[0].message;
        // In a real app, we'd also append the user's next message here if it was interactive,
        // or maybe the "user" is simulated by the environment.
        // For this test, let's just append the assistant's response.
        return {
          messages: [...ctx.messages, newMsg],
        };
      },
      maxLoops: 5,
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(3);
    expect(result.finalContext.messages).toHaveLength(3); // 1 user + 2 assistant (last one not added to context)
    // The last response is available in result.lastResponse
    expect(result.lastResponse?.choices[0].message.content).toBe('Goodbye');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('should handle tool calls', async () => {
    // Simulate:
    // 1. User: "What's the weather in SF?"
    // 2. Model: Tool Call (get_weather, location="SF")
    // 3. System (updateContext): Execute tool -> "Sunny"
    // 4. Model: "It is sunny in SF" -> Stop

    mockCreate.mockReset();
    
    // Response 1: Tool Call
    const toolCallMsg = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_123',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"location": "SF"}' },
        },
      ],
    };
    
    // Response 2: Final Answer
    const finalMsg = {
      role: 'assistant',
      content: 'It is sunny in SF',
    };

    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: toolCallMsg }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: finalMsg }],
      });

    interface ChatContext {
      messages: any[]; // Using any for simplicity in test, but ideally OpenAI types
    }

    const initialContext: ChatContext = {
      messages: [{ role: 'user', content: "What's the weather in SF?" }],
    };

    const result = await agentLoop<any, ChatContext>({
      initialContext,
      llmCaller: async (ctx) => {
        return await mockOpenAI.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: ctx.messages,
        });
      },
      stopCondition: (response) => {
        return !!response.choices[0].message.content; // Stop if we have content (final answer)
      },
      updateContext: async (response, ctx) => {
        const msg = response.choices[0].message;
        const newMessages = [...ctx.messages, msg];

        if (msg.tool_calls) {
          for (const toolCall of msg.tool_calls) {
            if (toolCall.function.name === 'get_weather') {
              // Simulate tool execution
              newMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'Sunny',
              });
            }
          }
        }
        
        return { messages: newMessages };
      },
      maxLoops: 5,
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(2); // 1. Tool Call, 2. Final Answer
    expect(result.lastResponse.choices[0].message.content).toBe('It is sunny in SF');
    expect(result.finalContext.messages).toHaveLength(3); 
    // 1. User
    // 2. Assistant (Tool Call)
    // 3. Tool Result
    // 4. Assistant (Final) - Wait, stopCondition returns true on final answer, so loop stops.
    // Does updateContext run after the last iteration?
    // The loop logic:
    //   response = call()
    //   if stop(response) return
    //   update()
    // So if stop returns true, update is NOT called for that response.
    // Thus, the final answer is NOT in finalContext.messages.
    
    // Let's verify context content:
    // [User, Assistant(ToolCall), Tool(Result)]
    expect(result.finalContext.messages).toHaveLength(3);
    expect(result.finalContext.messages[2].role).toBe('tool');
  });
});
