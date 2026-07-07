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

  it('should not run at all when the signal is already aborted', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn().mockReturnValue(false);
    const controller = new AbortController();
    controller.abort();

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      signal: controller.signal,
      initialContext: { count: 0 },
    });

    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(0);
    expect(result.finalContext).toEqual({ count: 0 });
    expect(result.lastResponse).toBeUndefined();
    expect(llmCaller).not.toHaveBeenCalled();
  });

  it('should stop with reason "aborted" when the signal aborts mid-loop', async () => {
    const controller = new AbortController();
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn().mockReturnValue(false);
    // Abort during the second iteration's onStep; the loop should detect it at
    // the top of the third iteration.
    const onStep = vi.fn((step) => {
      if (step.iteration === 2) {
        controller.abort();
      }
    });

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      onStep,
      signal: controller.signal,
      maxLoops: 10,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(2);
    expect(llmCaller).toHaveBeenCalledTimes(2);
  });

  it('should reflect signal abort in onStep willStop within the same iteration', async () => {
    const controller = new AbortController();
    // Abort during stopCondition of the first iteration, before onStep runs.
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn(() => {
      controller.abort();
      return false;
    });
    const onStep = vi.fn();

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      onStep,
      signal: controller.signal,
      maxLoops: 10,
      initialContext: {},
    });

    // willStop should be true even though the stop condition returned false,
    // because the signal is now aborted and the loop will stop next iteration.
    expect(onStep.mock.calls[0][0].willStop).toBe(true);
    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(1);
  });

  it('should report "aborted" for an already-aborted signal even when maxLoops is 0', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn().mockReturnValue(false);
    const controller = new AbortController();
    controller.abort();

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      signal: controller.signal,
      maxLoops: 0,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(0);
    expect(llmCaller).not.toHaveBeenCalled();
  });

  it('should resolve "aborted" when an in-flight llmCaller rejects after abort', async () => {
    const controller = new AbortController();
    // Simulate a caller who forwarded the signal into fetch: the in-flight call
    // rejects with an AbortError once the signal aborts.
    const llmCaller = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    const stopCondition = vi.fn().mockReturnValue(false);

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      signal: controller.signal,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(1);
  });

  it('should rethrow llmCaller errors when the signal is not aborted', async () => {
    const controller = new AbortController();
    const llmCaller = vi.fn().mockRejectedValue(new Error('network down'));
    const stopCondition = vi.fn().mockReturnValue(false);

    await expect(
      agentLoop({ llmCaller, stopCondition, signal: controller.signal, initialContext: {} })
    ).rejects.toThrow('network down');
  });

  it('should resolve "aborted" when a forwarded signal rejects with its reason (timeout)', async () => {
    const controller = new AbortController();
    const timeoutReason = new DOMException('The operation timed out', 'TimeoutError');
    // Simulate a forwarded signal: fetch/an SDK rejects with `signal.reason`,
    // which for a timeout/custom abort is not a plain AbortError.
    const llmCaller = vi.fn(async () => {
      controller.abort(timeoutReason);
      throw controller.signal.reason;
    });
    const stopCondition = vi.fn().mockReturnValue(false);

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      signal: controller.signal,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(1);
  });

  it('should rethrow an unrelated TimeoutError that races with an abort', async () => {
    const controller = new AbortController();
    // The signal aborts with its default reason, but the thrown error is an
    // unrelated provider request timeout (not signal.reason) — it must propagate.
    const llmCaller = vi.fn(async () => {
      controller.abort();
      throw new DOMException('request timed out', 'TimeoutError');
    });
    const stopCondition = vi.fn().mockReturnValue(false);

    await expect(
      agentLoop({ llmCaller, stopCondition, signal: controller.signal, initialContext: {} })
    ).rejects.toThrow('request timed out');
  });

  it('should not mask an undefined rejection when a custom signal has no reason', async () => {
    // A custom (structural) signal aborted without a reason. A real failure that
    // rejects with `undefined` must not be masked by `error === signal.reason`.
    const signal: { aborted: boolean; reason?: unknown } = { aborted: false, reason: undefined };
    const llmCaller = vi.fn(async () => {
      signal.aborted = true;
      throw undefined;
    });
    const stopCondition = vi.fn().mockReturnValue(false);

    await expect(
      agentLoop({ llmCaller, stopCondition, signal, initialContext: {} })
    ).rejects.toBeUndefined();
  });

  it('should rethrow a non-abort error even when the signal is aborted', async () => {
    const controller = new AbortController();
    // A real failure that races with an abort must not be masked as 'aborted'.
    const llmCaller = vi.fn(async () => {
      controller.abort();
      throw new Error('provider 500');
    });
    const stopCondition = vi.fn().mockReturnValue(false);

    await expect(
      agentLoop({ llmCaller, stopCondition, signal: controller.signal, initialContext: {} })
    ).rejects.toThrow('provider 500');
  });

  it('should complete normally when a signal is provided but never aborted', async () => {
    const controller = new AbortController();
    const llmCaller = vi.fn()
      .mockResolvedValueOnce('response1')
      .mockResolvedValueOnce('stop');
    const stopCondition = vi.fn((response) => response === 'stop');

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      signal: controller.signal,
      initialContext: {},
    });

    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(2);
  });

  it('should run exactly maxLoops times when stopCondition is omitted', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');

    const result = await agentLoop({
      llmCaller,
      maxLoops: 3,
      initialContext: {},
    });

    expect(result.reason).toBe('max_loops');
    expect(result.iterations).toBe(3);
    expect(llmCaller).toHaveBeenCalledTimes(3);
  });

  it('should default to maxLoops=10 when stopCondition is omitted', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');

    const result = await agentLoop({
      llmCaller,
      initialContext: {},
    });

    expect(result.reason).toBe('max_loops');
    expect(result.iterations).toBe(10);
    expect(llmCaller).toHaveBeenCalledTimes(10);
  });

  it('should set willStop only on the final iteration when stopCondition is omitted', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const onStep = vi.fn();

    await agentLoop({
      llmCaller,
      onStep,
      maxLoops: 3,
      initialContext: {},
    });

    expect(onStep).toHaveBeenCalledTimes(3);
    expect(onStep.mock.calls[0][0].willStop).toBe(false);
    expect(onStep.mock.calls[1][0].willStop).toBe(false);
    expect(onStep.mock.calls[2][0].willStop).toBe(true);
  });

  it('should still honor an abort signal when stopCondition is omitted', async () => {
    const controller = new AbortController();
    const llmCaller = vi.fn().mockResolvedValue('response');
    const onStep = vi.fn((step) => {
      if (step.iteration === 2) {
        controller.abort();
      }
    });

    const result = await agentLoop({
      llmCaller,
      onStep,
      signal: controller.signal,
      maxLoops: 10,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(2);
  });

  it('should still update context between iterations when stopCondition is omitted', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const updateContext = vi.fn((_, ctx: { count: number }) => ({ count: ctx.count + 1 }));

    const result = await agentLoop({
      llmCaller,
      updateContext,
      maxLoops: 3,
      initialContext: { count: 0 },
    });

    expect(result.reason).toBe('max_loops');
    expect(result.finalContext).toEqual({ count: 3 });
  });

  it('should reject the loop when llmCaller throws and no onError is provided', async () => {
    const llmCaller = vi.fn().mockRejectedValue(new Error('rate limited'));
    const stopCondition = vi.fn().mockReturnValue(false);

    await expect(
      agentLoop({ llmCaller, stopCondition, initialContext: {} })
    ).rejects.toThrow('rate limited');
  });

  it('should re-throw the original error when onError returns "throw"', async () => {
    const error = new Error('provider 500');
    const llmCaller = vi.fn().mockRejectedValue(error);
    const onError = vi.fn().mockReturnValue('throw');

    await expect(
      agentLoop({ llmCaller, onError, maxLoops: 3, initialContext: {} })
    ).rejects.toBe(error);
    // onError is consulted once, and the loop does not continue past the failure.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(llmCaller).toHaveBeenCalledTimes(1);
  });

  it('should stop with reason "error" when onError returns "stop"', async () => {
    const llmCaller = vi.fn()
      .mockResolvedValueOnce('response1')
      .mockRejectedValueOnce(new Error('network down'));
    const stopCondition = vi.fn().mockReturnValue(false);
    const updateContext = vi.fn((_, ctx: { count: number }) => ({ count: ctx.count + 1 }));
    const onError = vi.fn().mockReturnValue('stop');

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      updateContext,
      onError,
      maxLoops: 5,
      initialContext: { count: 0 },
    });

    expect(result.reason).toBe('error');
    // The first iteration succeeded (context advanced to 1); the second failed.
    expect(result.iterations).toBe(2);
    expect(result.lastResponse).toBe('response1');
    expect(result.finalContext).toEqual({ count: 1 });
  });

  it('should retry llmCaller within the same iteration when onError returns "retry"', async () => {
    const llmCaller = vi.fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce('stop');
    const stopCondition = vi.fn((response) => response === 'stop');
    const onError = vi.fn().mockReturnValue('retry');

    const result = await agentLoop({
      llmCaller,
      stopCondition,
      onError,
      maxLoops: 5,
      initialContext: {},
    });

    // Two failures were retried, the third call succeeded and stopped the loop —
    // all within a single iteration (retries don't consume maxLoops turns).
    expect(result.reason).toBe('stop_condition');
    expect(result.iterations).toBe(1);
    expect(llmCaller).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('should pass error, context, iteration, and attempt to onError', async () => {
    const error = new Error('boom');
    const llmCaller = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok');
    const stopCondition = vi.fn().mockReturnValue(true);
    // Retry once, then let it succeed.
    const onError = vi.fn().mockReturnValue('retry');

    await agentLoop({
      llmCaller,
      stopCondition,
      onError,
      initialContext: { label: 'ctx' },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      context: { label: 'ctx' },
      iteration: 1,
      attempt: 1,
    });
  });

  it('should let callers bound retries via info.attempt', async () => {
    const llmCaller = vi.fn().mockRejectedValue(new Error('always fails'));
    // Retry up to 3 attempts, then give up by throwing.
    const onError = vi.fn((_error, { attempt }: { attempt: number }) =>
      attempt < 3 ? 'retry' : 'throw'
    );

    await expect(
      agentLoop({ llmCaller, onError, initialContext: {} })
    ).rejects.toThrow('always fails');
    // Attempts 1 and 2 retried; attempt 3 threw.
    expect(llmCaller).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('should await an async onError before acting', async () => {
    const order: string[] = [];
    const llmCaller = vi.fn(async () => {
      order.push('call');
      throw new Error('fail');
    });
    const onError = vi.fn(async () => {
      await Promise.resolve();
      order.push('onError');
      return 'stop' as const;
    });

    const result = await agentLoop({ llmCaller, onError, initialContext: {} });

    expect(result.reason).toBe('error');
    expect(order).toEqual(['call', 'onError']);
  });

  it('should let an abort take precedence over onError', async () => {
    const controller = new AbortController();
    // The signal aborts and the in-flight call rejects with an AbortError.
    // This must resolve as 'aborted' without consulting onError.
    const llmCaller = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    const onError = vi.fn().mockReturnValue('stop');

    const result = await agentLoop({
      llmCaller,
      onError,
      signal: controller.signal,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
    expect(onError).not.toHaveBeenCalled();
  });

  it('should honor an abort that lands while an async onError is awaited', async () => {
    // A genuine (non-abort) llmCaller failure routes to onError. While the
    // async handler is deciding, the signal aborts. The abort must take
    // precedence over the returned action ('stop' here), resolving 'aborted'
    // rather than reason 'error'.
    const controller = new AbortController();
    const llmCaller = vi.fn().mockRejectedValue(new Error('network down'));
    const onError = vi.fn(async () => {
      controller.abort();
      await Promise.resolve();
      return 'stop' as const;
    });

    const result = await agentLoop({
      llmCaller,
      onError,
      signal: controller.signal,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
  });

  it('should honor an abort during async onError even when it returns "throw"', async () => {
    const controller = new AbortController();
    const error = new Error('provider 500');
    const llmCaller = vi.fn().mockRejectedValue(error);
    const onError = vi.fn(async () => {
      controller.abort();
      await Promise.resolve();
      return 'throw' as const;
    });

    // The abort outranks 'throw': the loop resolves 'aborted' instead of
    // rejecting with the original error.
    const result = await agentLoop({
      llmCaller,
      onError,
      signal: controller.signal,
      initialContext: {},
    });

    expect(result.reason).toBe('aborted');
  });

  it('should still validate the onError action when the signal was already aborted', async () => {
    // The signal aborts during llmCaller, but the provider throws its own
    // (non-abort) error. A mis-typed action must still surface as a TypeError,
    // not be masked as 'aborted' by the already-aborted signal.
    const controller = new AbortController();
    const original = new Error('provider 500');
    const llmCaller = vi.fn(async () => {
      controller.abort();
      throw original;
    });
    const onError = vi.fn(() => 'stpo' as unknown as 'throw');

    await expect(
      agentLoop({ llmCaller, onError, signal: controller.signal, initialContext: {} })
    ).rejects.toThrow(TypeError);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('should still propagate a genuine error on "throw" when the signal was already aborted', async () => {
    // A genuine error that merely raced with an earlier abort is routed to
    // onError; returning 'throw' propagates the original error rather than
    // masking it as 'aborted' (consistent with the no-onError behavior).
    const controller = new AbortController();
    const original = new Error('provider 500');
    const llmCaller = vi.fn(async () => {
      controller.abort();
      throw original;
    });
    const onError = vi.fn().mockReturnValue('throw');

    await expect(
      agentLoop({ llmCaller, onError, signal: controller.signal, initialContext: {} })
    ).rejects.toBe(original);
  });

  it('should throw a clear TypeError when onError returns an invalid action', async () => {
    const original = new Error('provider 500');
    const llmCaller = vi.fn().mockRejectedValue(original);
    // A misconfigured/mis-typed handler returns an unrecognized action.
    const onError = vi.fn(() => 'stpo' as unknown as 'throw');

    await expect(
      agentLoop({ llmCaller, onError, initialContext: {} })
    ).rejects.toThrow(TypeError);

    // The original failure is preserved as the TypeError's `cause`.
    await agentLoop({ llmCaller, onError, initialContext: {} }).catch((err: unknown) => {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as { cause?: unknown }).cause).toBe(original);
    });
  });

  it('should not route stopCondition errors through onError', async () => {
    const llmCaller = vi.fn().mockResolvedValue('response');
    const stopCondition = vi.fn(() => {
      throw new Error('bad predicate');
    });
    const onError = vi.fn().mockReturnValue('stop');

    await expect(
      agentLoop({ llmCaller, stopCondition, onError, initialContext: {} })
    ).rejects.toThrow('bad predicate');
    // onError only absorbs llmCaller failures, not programming errors elsewhere.
    expect(onError).not.toHaveBeenCalled();
  });
});
