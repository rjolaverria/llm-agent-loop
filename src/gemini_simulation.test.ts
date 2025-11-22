import { describe, it, expect, vi } from 'vitest';
import { agentLoop } from './index.js';
import { Content, GenerateContentResult, GenerativeModel, Part } from '@google/generative-ai';

// Mock GenerativeModel
const mockGenerateContent = vi.fn();
const mockModel = {
  generateContent: mockGenerateContent,
} as unknown as GenerativeModel;

describe('Gemini Simulation', () => {
  it('should run a chat loop with Gemini', async () => {
    // Simulate:
    // 1. User: "Hello"
    // 2. Model: "Hi!"
    // 3. User: "Stop"
    // 4. Model: "Bye" -> Stop

    mockGenerateContent
      .mockResolvedValueOnce({
        response: {
          text: () => 'Hi!',
          functionCalls: () => [],
        },
      })
      .mockResolvedValueOnce({
        response: {
          text: () => 'Bye',
          functionCalls: () => [],
        },
      });

    interface GeminiContext {
      history: Content[];
    }

    const initialContext: GeminiContext = {
      history: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    };

    const result = await agentLoop<GenerateContentResult, GeminiContext>({
      initialContext,
      llmCaller: async (ctx) => {
        return await mockModel.generateContent({ contents: ctx.history });
      },
      stopCondition: (response) => {
        const text = response.response.text();
        return text === 'Bye';
      },
      updateContext: (response, ctx) => {
        const text = response.response.text();
        const newPart: Part = { text };
        const newContent: Content = { role: 'model', parts: [newPart] };
        
        // In a real app, we'd add the next user message here too.
        // For this test, we just append the model response.
        // If we wanted to simulate the user saying "Stop", we'd need to inject it.
        // Let's assume the "User" input is implicit or we just want to test the model's sequence.
        // Actually, for the second call to produce "Bye", the model usually needs input.
        // But since we are mocking the sequence, we don't strictly need to update the context with user input 
        // for the mock to work, unless the mock implementation depends on it.
        // Here mockGenerateContent just returns sequence.
        
        return {
          history: [...ctx.history, newContent],
        };
      },
      maxLoops: 5,
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(2);
    expect(result.lastResponse?.response.text()).toBe('Bye');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('should handle Gemini tool calls', async () => {
    // Simulate:
    // 1. User: "Weather in NY?"
    // 2. Model: FunctionCall(get_weather, {location: "NY"})
    // 3. System: FunctionResponse(get_weather, {weather: "Cloudy"})
    // 4. Model: "It is cloudy." -> Stop

    mockGenerateContent.mockReset();

    // Response 1: Function Call
    const functionCallPart = {
      functionCall: {
        name: 'get_weather',
        args: { location: 'NY' },
      },
    };
    
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => '',
        functionCalls: () => [functionCallPart.functionCall],
        candidates: [{ content: { role: 'model', parts: [functionCallPart] } }],
      },
    });

    // Response 2: Final Answer
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'It is cloudy.',
        functionCalls: () => [],
        candidates: [{ content: { role: 'model', parts: [{ text: 'It is cloudy.' }] } }],
      },
    });

    interface GeminiContext {
      history: Content[];
    }

    const initialContext: GeminiContext = {
      history: [{ role: 'user', parts: [{ text: 'Weather in NY?' }] }],
    };

    const result = await agentLoop<GenerateContentResult, GeminiContext>({
      initialContext,
      llmCaller: async (ctx) => {
        return await mockModel.generateContent({ contents: ctx.history });
      },
      stopCondition: (response) => {
        const calls = response.response.functionCalls();
        return !calls || calls.length === 0; // Stop if no function calls (meaning final text)
      },
      updateContext: async (response, ctx) => {
        // Gemini requires appending the model's function call AND the function response.
        // 1. Add model's response (with function call)
        // 2. Execute function
        // 3. Add function response
        
        // Note: In the real SDK, response.candidates[0].content is the content object.
        // We mocked it above.
        
        // We need to access the raw content to append it correctly.
        // In our mock, we put it in candidates[0].content.
        // Let's assume the caller can access it via response.response.candidates[0].content 
        // or we just reconstruct it from functionCalls().
        
        // For this test, let's rely on our mock structure.
        const modelContent = (response as any).response.candidates[0].content;
        const newHistory = [...ctx.history, modelContent];

        const calls = response.response.functionCalls();
        if (calls && calls.length > 0) {
          for (const call of calls) {
            if (call.name === 'get_weather') {
              // Simulate execution
              const functionResponsePart = {
                functionResponse: {
                  name: 'get_weather',
                  response: { name: 'get_weather', content: { weather: 'Cloudy' } },
                },
              };
              
              newHistory.push({
                role: 'function', // Gemini uses 'function' role for responses
                parts: [functionResponsePart],
              });
            }
          }
        }

        return { history: newHistory };
      },
      maxLoops: 5,
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(2);
    expect(result.lastResponse?.response.text()).toBe('It is cloudy.');
    expect(result.finalContext.history).toHaveLength(3);
    // 1. User
    // 2. Model (Function Call)
    // 3. Function (Response) - Wait, stopCondition returns true on final answer.
    // So updateContext is NOT called for the final answer.
    // Context should be: [User, Model(Call), Function(Resp)]
    // Length 3.
    
    // Let's re-verify stopCondition logic.
    // Iteration 1: Call -> returns FunctionCall. stopCondition checks if NO calls. 
    // It HAS calls, so stop=false.
    // updateContext runs. Adds Model(Call) and Function(Resp). History len = 3.
    
    // Iteration 2: Call -> returns "It is cloudy". stopCondition checks if NO calls.
    // It HAS NO calls, so stop=true.
    // Loop returns.
    
    // So final context length is 3.
    expect(result.finalContext.history).toHaveLength(3);
    expect(result.finalContext.history[2].role).toBe('function');
  });
});
