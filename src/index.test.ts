import { describe, it, expect, vi } from 'vitest';
import { agentLoop } from './index.js';

describe('agentLoop', () => {
  it('should run until stop condition is met', async () => {
    const llmCaller = vi.fn()
      .mockResolvedValueOnce('response1')
      .mockResolvedValueOnce('response2')
      .mockResolvedValueOnce('stop');

    const stopCondition = vi.fn((response) => response === 'stop');

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      initialContext: {},
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(3);
    expect(result.lastResponse).toBe('stop');
    expect(llmCaller).toHaveBeenCalledTimes(3);
  });

  it('should stop when max loops is reached', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn().mockReturnValue(false);

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      maxLoops: 5,
      initialContext: {},
    });

    expect(result.reason).toBe('max_loops');
    expect(result.iterations).toBe(5);
    expect(llmCaller).toHaveBeenCalledTimes(5);
  });

  it('should update context between iterations', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn((_, ctx: { count: number }) => ctx.count >= 3);
    const updateContext = vi.fn((_, ctx: { count: number }) => ({ count: ctx.count + 1 }));

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      updateContext,
      initialContext: { count: 0 },
    });

    expect(result.reason).toBe('stop_condition');
    // Iteration 1: ctx=0 -> response -> stop(0)? No -> update(0) -> ctx=1
    // Iteration 2: ctx=1 -> response -> stop(1)? No -> update(1) -> ctx=2
    // Iteration 3: ctx=2 -> response -> stop(2)? No -> update(2) -> ctx=3
    // Iteration 4: ctx=3 -> response -> stop(3)? Yes -> break
    // Wait, let's trace carefully.
    // 1. call(0), stop(0)? false. update(0) -> 1.
    // 2. call(1), stop(1)? false. update(1) -> 2.
    // 3. call(2), stop(2)? false. update(2) -> 3.
    // 4. call(3), stop(3)? true. return.
    // So 4 iterations.
    expect(result.iterations).toBe(4);
    expect(result.finalContext).toEqual({ count: 3 });
  });

  it('should handle async stop condition and update context', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn().mockResolvedValue(true);
    const updateContext = vi.fn().mockResolvedValue({});

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      updateContext,
      initialContext: {},
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(1);
  });

  it('should invoke onStep once per iteration with structured data', async () => {
    const llmCaller = vi.fn()
      .mockResolvedValueOnce('response1')
      .mockResolvedValueOnce('stop');
    const stopCondition = vi.fn((response) => response === 'stop');
    const updateContext = vi.fn((_, ctx: { count: number }) => ({ count: ctx.count + 1 }));
    const onStep = vi.fn();

    await agentLoop({
      llmCaller,
      stopCondition,
      updateContext,
      onStep,
      initialContext: { count: 0 },
    });

    expect(onStep).toHaveBeenCalledTimes(2);
    // First iteration: does not stop, context is the initial (pre-update) context.
    expect(onStep).toHaveBeenNthCalledWith(1, {
      iteration: 1,
      response: 'response1',
      context: { count: 0 },
      willStop: false,
    });
    // Second iteration: stop condition met, context reflects the one update.
    expect(onStep).toHaveBeenNthCalledWith(2, {
      iteration: 2,
      response: 'stop',
      context: { count: 1 },
      willStop: true,
    });
  });

  it('should set willStop when max loops is reached', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn().mockReturnValue(false);
    const onStep = vi.fn();

    await agentLoop({
      llmCaller,
      stopCondition,
      onStep,
      maxLoops: 2,
      initialContext: {},
    });

    expect(onStep).toHaveBeenCalledTimes(2);
    expect(onStep.mock.calls[0][0].willStop).toBe(false);
    expect(onStep.mock.calls[1][0].willStop).toBe(true);
  });

  it('should await an async onStep before continuing', async () => {
    const order: string[] = [];
    const llmCaller = vi.fn(async () => {
      order.push('call');
      return 'stop';
    });
    const stopCondition = vi.fn((response) => response === 'stop');
    const onStep = vi.fn(async () => {
      await Promise.resolve();
      order.push('step');
    });

    await agentLoop({ llmCaller, stopCondition, onStep, initialContext: {} });

    expect(order).toEqual(['call', 'step']);
  });
});
