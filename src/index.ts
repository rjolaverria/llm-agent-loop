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
 * What the loop should do after `llmCaller` throws and `onError` has run.
 * - `'retry'`: call `llmCaller` again with the same context (same iteration).
 * - `'stop'`: stop the loop gracefully and resolve with `reason: 'error'`.
 * - `'throw'`: re-throw the original error, rejecting the loop's promise.
 */
export type AgentLoopErrorAction = 'retry' | 'stop' | 'throw';

/**
 * Details about a failed `llmCaller` call, passed to `onError`.
 */
export interface AgentLoopErrorInfo<TContext> {
  /**
   * The context passed to the `llmCaller` call that threw.
   */
  context: TContext;

  /**
   * The 1-based index of the iteration whose `llmCaller` threw.
   */
  iteration: number;

  /**
   * The 1-based attempt number within this iteration. Starts at 1 and
   * increments each time `onError` returns `'retry'`, so callers can bound
   * retries without tracking their own counter (e.g.
   * `(err, { attempt }) => (attempt < 3 ? 'retry' : 'throw')`).
   */
  attempt: number;
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
   * Optional handler for errors thrown by `llmCaller`. Without it, a single
   * rejected `llmCaller` call rejects the whole loop (the default behavior).
   * With it, you decide per-error whether to `'retry'` the call, `'stop'` the
   * loop gracefully (resolving with `reason: 'error'`), or `'throw'` (re-raise).
   *
   * Only `llmCaller` failures are routed here. Errors thrown by
   * `stopCondition`, `updateContext`, or `onStep` always propagate — they are
   * programming errors, not the transient network/provider failures this hook
   * is meant to absorb. Aborts (see `signal`) also take precedence and are
   * never surfaced as errors.
   *
   * `'retry'` re-invokes `llmCaller` within the same iteration (it does not
   * consume a `maxLoops` turn). Retries are caller-bounded: use
   * `info.attempt` to stop retrying, or you can loop forever.
   * If it returns a promise, the loop awaits it before acting.
   *
   * Returning anything other than `'retry'`, `'stop'`, or `'throw'` (e.g. from
   * a JavaScript or mis-typed consumer) throws a `TypeError` with the original
   * failure attached as its `cause`, rather than silently defaulting to
   * `'throw'`.
   *
   * Note: a handler that ignores its arguments and returns a bare constant
   * action (e.g. `() => 'stop'`) needs `as const` or a return annotation
   * (`(): AgentLoopErrorAction => 'stop'`) so TypeScript infers the literal
   * rather than widening it to `string`. Handlers that inspect the error or
   * `info` (the common case) don't need this.
   */
  onError?: (
    error: unknown,
    info: AgentLoopErrorInfo<TContext>
  ) => AgentLoopErrorAction | Promise<AgentLoopErrorAction>;

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
 * - `'error'`: `llmCaller` threw and `onError` returned `'stop'`. Only possible
 *   when an `onError` handler is passed.
 */
export type AgentLoopReason = 'stop_condition' | 'max_loops' | 'aborted' | 'error';

/**
 * Result of the agent loop.
 *
 * `TReason` narrows the possible `reason` values. Calls without a `signal` or
 * `onError` resolve with `'stop_condition' | 'max_loops'`; calls with a `signal`
 * may also resolve with `'aborted'`, and calls with an `onError` may also
 * resolve with `'error'`. See the `agentLoop` overloads.
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
// When neither `signal` nor `onError` is present in an inline options literal
// (so both are inferred as `undefined`), the first overload applies and `reason`
// stays the narrow `'stop_condition' | 'max_loops'` union, keeping existing
// exhaustive handling compiling. Passing a `signal` and/or an `onError` — or
// options pre-typed as `AgentLoopOptions` (whose fields are optional) — matches
// the second overload, whose `reason` also includes `'aborted'` and `'error'`.
//
// The wide overload's union is a safe superset: `'aborted'` only actually
// occurs with a `signal`, `'error'` only with an `onError`, and omitting
// `stopCondition` rules out `'stop_condition'`. Narrowing precisely would
// require multiplying overloads across each present/absent axis for little gain,
// and widening a result type never breaks an exhaustive consumer.
export function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext> & { signal?: undefined; onError?: undefined }
): Promise<AgentLoopResult<TResponse, TContext, 'stop_condition' | 'max_loops'>>;
export function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext>
): Promise<AgentLoopResult<TResponse, TContext, AgentLoopReason>>;
export async function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext>
): Promise<AgentLoopResult<TResponse, TContext, AgentLoopReason>> {
  const {
    llmCaller,
    stopCondition,
    maxLoops = 10,
    updateContext,
    onStep,
    onError,
    signal,
    initialContext,
  } = options;

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
    // Attempt loop: `onError` may request a retry, re-calling `llmCaller`
    // without consuming another `maxLoops` turn. `attempt` starts at 1 and
    // increments per retry so callers can bound retries via `info.attempt`.
    let attempt = 0;
    for (;;) {
      // Never (re)call llmCaller once the signal is aborted. On the first
      // attempt the outer while-loop already guarantees this; on a retry it
      // stops the loop from spinning after a mid-handler cancel.
      if (signal?.aborted) {
        return abortedResult();
      }

      attempt++;
      try {
        response = await llmCaller(currentContext);
        break;
      } catch (error) {
        // If the caller forwarded this signal into llmCaller/fetch, aborting an
        // in-flight request rejects with the signal's `reason` (an AbortError by
        // default, a TimeoutError for AbortSignal.timeout(), or a custom reason).
        // Normalize only that cancellation path into a clean 'aborted' result.
        // An abort is a cancellation, not a failure, so it takes precedence over
        // `onError` and is never handed to it. The `reason !== undefined` guard
        // avoids masking an error that rejects with `undefined` when a custom
        // signal is aborted without a reason.
        const matchesReason = signal?.reason !== undefined && error === signal.reason;
        if (signal?.aborted && (matchesReason || isAbortError(error))) {
          return abortedResult();
        }

        // No handler: preserve the default of rejecting the whole loop.
        if (!onError) {
          throw error;
        }

        // Remember whether the signal was already aborted so we can tell a
        // *transition* (the caller cancels while onError runs) from a genuine
        // error that merely raced with a prior abort.
        const abortedBeforeHandler = Boolean(signal?.aborted);
        let action: AgentLoopErrorAction;
        try {
          action = await onError(error, {
            context: currentContext,
            iteration: iterations,
            attempt,
          });
        } catch (handlerError) {
          // If the caller cancelled while onError was running, honor the abort
          // over the handler's own rejection — the same precedence applied to a
          // handler that aborts and then returns an action. Otherwise the
          // handler error, like any programming error, propagates.
          if (!abortedBeforeHandler && signal?.aborted) {
            return abortedResult();
          }
          throw handlerError;
        }

        // An abort that lands *during* the handler outranks the returned
        // action: the caller cancelled mid-decision, so resolve 'aborted'
        // whatever it says. A genuine error that only raced with an earlier
        // abort is still handled below (a 'retry' can't spin — see the
        // top-of-loop guard).
        if (!abortedBeforeHandler && signal?.aborted) {
          return abortedResult();
        }

        if (action === 'retry') {
          continue;
        }
        if (action === 'stop') {
          return {
            finalContext: currentContext,
            lastResponse,
            reason: 'error',
            iterations,
          };
        }
        if (action === 'throw') {
          // The default action: re-raise the original error unchanged.
          throw error;
        }

        // Any other value means a misconfigured handler (e.g. a typo'd action
        // from a JavaScript or mis-typed consumer). Surface it loudly rather
        // than silently behaving like 'throw', and keep the original failure
        // reachable as the TypeError's `cause`.
        const invalidActionError = new TypeError(
          `onError must return 'retry', 'stop', or 'throw'; received ${String(action)}`
        );
        (invalidActionError as Error & { cause?: unknown }).cause = error;
        throw invalidActionError;
      }
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
