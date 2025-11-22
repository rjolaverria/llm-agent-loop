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
   * A predicate function that determines whether to stop the loop.
   * It receives the response from the LLM and the current context.
   * If it returns true, the loop stops.
   */
  stopCondition: (response: TResponse, context: TContext) => boolean | Promise<boolean>;

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
   * Initial context to start the loop with.
   */
  initialContext: TContext;
}

/**
 * Result of the agent loop.
 */
export interface AgentLoopResult<TResponse, TContext> {
  /**
   * The final context after the loop finished.
   */
  finalContext: TContext;

  /**
   * The last response received from the LLM.
   * undefined if the loop didn't run (e.g. maxLoops=0).
   */
  lastResponse: TResponse | undefined;

  /**
   * The reason why the loop stopped.
   */
  reason: 'stop_condition' | 'max_loops';

  /**
   * The number of iterations performed.
   */
  iterations: number;
}

/**
 * Runs an agent loop.
 *
 * @param options Configuration options for the loop.
 * @returns A promise that resolves to the result of the loop.
 */
export async function agentLoop<TResponse, TContext>(
  options: AgentLoopOptions<TResponse, TContext>
): Promise<AgentLoopResult<TResponse, TContext>> {
  const { llmCaller, stopCondition, maxLoops = 10, updateContext, initialContext } = options;

  let currentContext = initialContext;
  let lastResponse: TResponse | undefined;
  let iterations = 0;

  while (iterations < maxLoops) {
    iterations++;

    const response = await llmCaller(currentContext);
    lastResponse = response;

    const shouldStop = await stopCondition(response, currentContext);
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
