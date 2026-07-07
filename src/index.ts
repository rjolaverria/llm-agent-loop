/**
 * A single iteration of the agent loop, passed to the `onStep` callback.
 */
export interface AgentLoopStep<TResponse, TContext> {
  /**
   * The 1-based index of the current iteration.
   */
  iteration: number;

  /**
   * The response returned by `llmCaller` during this iteration.
   */
  response: TResponse;

  /**
   * The context that produced this response (before `updateContext` runs).
   *
   * This is the live context reference, not a snapshot. If your `updateContext`
   * mutates the context in place (rather than returning a new object), a
   * retained `context` may reflect later changes. Copy it inside `onStep` if you
   * need a stable snapshot.
   */
  context: TContext;

  /**
   * Whether the loop will stop after this iteration — because the stop
   * condition was met, `maxLoops` has been reached, or the `AbortSignal`
   * has been aborted.
   */
  willStop: boolean;
}

/**
 * Minimal structural subset of `AbortSignal` used by the loop.
 *
 * Declared structurally (rather than referencing the ambient DOM `AbortSignal`)
 * so the published type declarations don't require the DOM lib or `@types/node`.
 * A real `AbortSignal` from any runtime satisfies this interface.
 */
export interface AgentLoopAbortSignal {
  /** Whether the signal has been aborted. */
  readonly aborted: boolean;
  /** The abort reason, if any (used to recognize forwarded aborts). */
  readonly reason?: unknown;
}

/**
 * Options for the agent loop.
 */
export interface AgentLoopOptions<TResponse, TContext> {
  /**
   * The function that calls the LLM.
   * It receives the current context and returns a promise that resolves to the response.
   */
  llmCaller: (context: TContext) => Promise<TResponse>;

  /**
   * Optional predicate that determines whether to stop the loop early.
   * It receives the response from the LLM and the current context.
   * If it returns true, the loop stops with `reason: 'stop_condition'`.
   *
   * If omitted, the loop never stops early: it runs until `maxLoops` is
   * reached (or the `signal` aborts). This is convenient for "run exactly N
   * turns" loops without the `() => false` boilerplate.
   */
  stopCondition?: (response: TResponse, context: TContext) => boolean | Promise<boolean>;

  /**
   * The maximum number of loops to run.
   * Defaults to 10 if not specified.
   */
  maxLoops?: number;

  /**
   * Optional callback to update the context based on the response.
   * If not provided, the context is passed as-is to the next iteration.
   * This is useful if the context is mutable or if you want to append the response to a history.
   */
  updateContext?: (response: TResponse, context: TContext) => TContext | Promise<TContext>;

  /**
   * Optional callback invoked once per iteration, after the LLM responds and
   * the stop condition is evaluated, but before `updateContext` runs.
   * Useful for logging, tracing, progress UIs, and token accounting without
   * wrapping your `llmCaller`/`updateContext` in side effects.
   * If it returns a promise, the loop awaits it before continuing.
   */
  onStep?: (step: AgentLoopStep<TResponse, TContext>) => void | Promise<void>;

  /**
   * Optional `AbortSignal` used to cancel the loop (typed structurally as
   * {@link AgentLoopAbortSignal} so the published types stay DOM-free).
   * The signal is checked at the start of each iteration; if it is already
   * aborted the loop stops and resolves with `reason: 'aborted'` (it does not
   * throw). An in-flight `llmCaller` is not interrupted — forward this signal
   * into your `llmCaller` (e.g. to `fetch`) if you also need to abort the call
   * itself.
   */
  signal?: AgentLoopAbortSignal;

  /**
   * Initial context to start the loop with.
   */
  initialContext: TContext;
}

/**
 * The reason the loop stopped.
 * - `'stop_condition'`: the stop condition returned `true`.
 * - `'max_loops'`: the maximum number of iterations was reached.
 * - `'aborted'`: the provided `AbortSignal` was aborted. Only possible when a
 *   `signal` is passed.
 */
export type AgentLoopReason = 'stop_condition' | 'max_loops' | 'aborted';

/**
 * Result of the agent loop.
 *
 * `TReason` narrows the possible `reason` values. Calls without a `signal`
 * resolve with `'stop_condition' | 'max_loops'`; calls with a `signal` may also
 * resolve with `'aborted'`. See the `agentLoop` overloads.
 */
export interface AgentLoopResult<
  TResponse,
  TContext,
  TReason extends AgentLoopReason = 'stop_condition' | 'max_loops',
> {
  /**
   * The final context after the loop finished.
   *
   * Note: when the loop stops because `stopCondition` returned `true`,
   * `updateContext` is NOT called for that final iteration. This means the
   * response that triggered the stop is not folded into `finalContext` — use
   * `lastResponse` to access it. If you rely on `finalContext` as the complete
   * transcript, remember to append `lastResponse` yourself.
   */
  finalContext: TContext;

  /**
   * The last response received from the LLM.
   * undefined if the loop didn't run (e.g. maxLoops=0).
   *
   * When `reason` is `'stop_condition'`, this holds the response that triggered
   * the stop, which is intentionally not reflected in `finalContext`.
   */
  lastResponse: TResponse | undefined;

  /**
   * The reason why the loop stopped.
   */
  reason: TReason;

  /**
   * The number of iterations performed.
   */
  iterations: number;
}

/**
 * Whether an error is an abort-related rejection (e.g. from an aborted `fetch`).
 * Standard `AbortSignal`-aware APIs reject with a `DOMException` whose `name` is
 * `'AbortError'`. Timeout/custom-reason aborts are matched separately via
 * `error === signal.reason`, so `'TimeoutError'` is intentionally not treated as
 * an abort here — an unrelated provider `TimeoutError` must still propagate.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Runs an agent loop.
 *
 * @param options Configuration options for the loop.
 * @returns A promise that resolves to the result of the loop.
 */
// When `signal` is omitted from an inline options literal (so it's inferred as
// `{ signal?: undefined }`), the first overload applies and `reason` stays the
// narrow `'stop_condition' | 'max_loops'` union, keeping existing exhaustive
// handling compiling. Passing a `signal` — or options pre-typed as
// `AgentLoopOptions` (whose `signal` is optional) — matches the second overload,
// whose `reason` includes `'aborted'`.
//
// Omitting `stopCondition` means `reason` can never actually be
// `'stop_condition'`, but the union is left as-is (a safe superset). Narrowing
// it away would require multiplying the overloads across the stopCondition
// present/absent axis for little gain, and widening a result type never breaks
// an exhaustive consumer.
export function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext> & { signal?: undefined }
): Promise<AgentLoopResult<TResponse, TContext, 'stop_condition' | 'max_loops'>>;
export function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext>
): Promise<AgentLoopResult<TResponse, TContext, AgentLoopReason>>;
export async function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext>
): Promise<AgentLoopResult<TResponse, TContext, AgentLoopReason>> {
  const { llmCaller, stopCondition, maxLoops = 10, updateContext, onStep, signal, initialContext } =
    options;

  let currentContext = initialContext;
  let lastResponse: TResponse | undefined;
  let iterations = 0;

  const abortedResult = (): AgentLoopResult<TResponse, TContext, AgentLoopReason> => ({
    finalContext: currentContext,
    lastResponse,
    reason: 'aborted',
    iterations,
  });

  // Handle an already-aborted signal even when the loop body never runs
  // (e.g. maxLoops <= 0).
  if (signal?.aborted) {
    return abortedResult();
  }

  while (iterations < maxLoops) {
    if (signal?.aborted) {
      return abortedResult();
    }

    iterations++;

    let response: TResponse;
    try {
      response = await llmCaller(currentContext);
    } catch (error) {
      // If the caller forwarded this signal into llmCaller/fetch, aborting an
      // in-flight request rejects with the signal's `reason` (an AbortError by
      // default, a TimeoutError for AbortSignal.timeout(), or a custom reason).
      // Normalize only that cancellation path into a clean 'aborted' result.
      // Other failures (network/provider/application errors) still propagate,
      // even if they happen to race with an abort. The `reason !== undefined`
      // guard avoids masking an error that rejects with `undefined` when a
      // custom signal is aborted without a reason.
      const matchesReason = signal?.reason !== undefined && error === signal.reason;
      if (signal?.aborted && (matchesReason || isAbortError(error))) {
        return abortedResult();
      }
      throw error;
    }
    lastResponse = response;

    const shouldStop = stopCondition ? await stopCondition(response, currentContext) : false;

    if (onStep) {
      await onStep({
        iteration: iterations,
        response,
        context: currentContext,
        willStop: shouldStop || iterations >= maxLoops || Boolean(signal?.aborted),
      });
    }

    if (shouldStop) {
      return {
        finalContext: currentContext,
        lastResponse,
        reason: 'stop_condition',
        iterations,
      };
    }

    if (updateContext) {
      currentContext = await updateContext(response, currentContext);
    }
  }

  return {
    finalContext: currentContext,
    lastResponse,
    reason: 'max_loops',
    iterations,
  };
}
