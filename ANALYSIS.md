# UX & DevX Analysis — `llm-agent-loop`

_Analysis date: 2026-06-28 · Commit base: `f1d8b11` · Branch: `claude/ux-devx-analysis-ugboia`_

This is a focused review of the **user experience (UX)** — meaning the API surface that
consumers of the published npm package interact with — and the **developer experience
(DevX)** — meaning what it's like to clone, build, test, and contribute to this repo.

The package is intentionally tiny and well-scoped: a single generic `agentLoop` function
(`src/index.ts`, ~100 lines) plus unit tests and mocked OpenAI / Gemini / Claude simulation
tests. The build is clean and all 10 tests pass. The findings below are about closing the
gap between "a correct loop primitive" and "a primitive that's pleasant to adopt and
maintain."

No code changes were made — this is a report only.

---

## TL;DR — Top priorities

| # | Area | Finding | Severity |
|---|------|---------|----------|
| 1 | DevX | `npm test` runs Vitest in **watch mode** — hangs locally and is fragile in CI | **P0** |
| 2 | UX | **No observability hook** (`onStep`/`onIteration`) — the loop is a black box | **P0** |
| 3 | UX | **No error handling strategy** — one thrown `llmCaller` rejects the entire loop; no retry, no `onError` | **P0** |
| 4 | UX | **No cancellation** — long-running loops can't be aborted (`AbortSignal`) | **P1** |
| 5 | UX | Final response is **silently dropped from `finalContext`** on stop — a real footgun, currently undocumented | **P1** |
| 6 | DevX | No `LICENSE` file despite `"license": "ISC"`; missing `lint`/`typecheck`/`coverage` scripts and tooling | **P1** |
| 7 | DevX | Publish workflow also calls watch-mode `npm test`; relies on Vitest's CI auto-detection | **P1** |

---

## 1. Consumer UX — the public API

### 1.1 The loop is unobservable (P0)
`agentLoop` exposes no way to watch what happens between iterations. For an *agent* loop —
where each turn may be a tool call, a model response, or a context mutation — this is the
single biggest gap. Today the only way to log/trace/measure a turn is to wrap your own
`llmCaller` and `updateContext` with side effects.

**Recommendation:** add an optional `onStep` callback invoked once per iteration with
structured data:

```ts
onStep?: (step: {
  iteration: number;
  response: TResponse;
  context: TContext;
  willStop: boolean;
}) => void | Promise<void>;
```

This unlocks logging, progress UIs, token accounting, and tracing without forcing callers to
contort their `llmCaller`.

### 1.2 No error-handling strategy (P0)
`src/index.ts:81` calls `await llmCaller(currentContext)` with no surrounding handling. A
single transient failure (rate limit, network blip) rejects the whole loop and discards all
accumulated context. Real agent loops are long-lived and *expect* intermittent failures.

**Recommendation (incremental):**
- Add an optional `onError?: (error, ctx, iteration) => 'retry' | 'throw' | 'stop'` hook, or
- A simpler `retries?: number` + backoff option for the common case.

At minimum, document that callers must implement their own retry inside `llmCaller`.

### 1.3 No cancellation (P1)
There's no `AbortSignal` support. A consumer who starts a 20-iteration loop behind a UI
"Stop" button or a request timeout has no clean way to cancel it.

**Recommendation:** accept `signal?: AbortSignal`; check `signal.aborted` at the top of each
iteration and reject/resolve with a `reason: 'aborted'`.

### 1.4 Final response is dropped from `finalContext` on stop (P1)
The control flow is: call → `stopCondition` → (if not stopping) `updateContext`
(`src/index.ts:81-96`). When `stopCondition` returns `true`, the loop returns **before**
`updateContext` runs, so the *last* assistant turn is never folded into `finalContext`.

This is subtle enough that the project's own Claude simulation test calls it out in a comment
(`src/claude_simulation.test.ts:168-172`: "Final answer loop stops, so not in context").
The last response *is* available via `result.lastResponse`, but a caller who relies on
`finalContext.messages` as the complete transcript will silently lose the final turn.

**Recommendation:** at minimum document this ordering explicitly in the README and the
`AgentLoopResult` JSDoc. Optionally offer an `applyUpdateOnStop?: boolean` flag so callers can
opt into folding the terminal response into context.

### 1.5 `stopCondition` is mandatory (P2)
It's a required field, yet a `maxLoops`-only loop (run exactly N turns) is a legitimate use
case. Requiring `stopCondition: () => false` is boilerplate.

**Recommendation:** make `stopCondition` optional; default to "never stop early," letting
`maxLoops` terminate.

### 1.6 No per-iteration history or timing in the result (P2)
`AgentLoopResult` returns only `lastResponse` and `iterations`. There's no transcript of
intermediate responses or timing. Many agent use cases want the full chain for debugging or
replay.

**Recommendation:** consider an optional `history: TResponse[]` (opt-in to avoid memory cost)
and/or `durationMs`.

### 1.7 No streaming / async-iterator variant (P2, nice-to-have)
For UIs that render progress as it happens, an `async function*` variant that `yield`s each
step would be idiomatic and composable. This pairs naturally with 1.1.

### 1.8 Documentation only shows mocked usage (P1 for docs)
The README's `llmCaller` literally returns `"Response from LLM"`. There is no end-to-end
example against a real provider, even though the repo already contains realistic
OpenAI/Gemini/Claude wiring in the test files. New adopters have to reverse-engineer the
provider glue from tests.

**Recommendation:** add a runnable `examples/` directory (or README sections) showing one real
provider call — the tool-call loop from `src/claude_simulation.test.ts` is an ideal template.
Also document the stop/context ordering from 1.4.

---

## 2. Contributor DevX — repo, tooling, CI

### 2.1 `npm test` runs in watch mode (P0)
`package.json:19` defines `"test": "vitest"`. Bare `vitest` starts the **interactive watch
runner**, which never exits. Consequences:
- A contributor running `npm test` locally gets a hung process, not a pass/fail result.
- CI (`.github/workflows/test.yml:22` and `.github/workflows/publish.yml:26`) only works
  because Vitest auto-detects `CI=true` and switches to run-once mode. That's an implicit
  dependency on an environment variable — brittle and surprising.

**Recommendation:** split the scripts:
```jsonc
"test":       "vitest run",
"test:watch": "vitest",
"coverage":   "vitest run --coverage"
```
This is the highest-leverage, lowest-risk DevX fix in the repo.

### 2.2 Missing standard scripts and tooling (P1)
There is no `lint`, `format`, or `typecheck` script, and no ESLint/Prettier config. For a
TypeScript library that explicitly invites *LLM-generated* contributions (`CONTRIBUTING.md`),
automated linting/formatting is the main guardrail keeping machine-written PRs consistent.

**Recommendation:** add ESLint (typescript-eslint) + Prettier, plus:
```jsonc
"typecheck": "tsc --noEmit",
"lint":      "eslint src",
"format":    "prettier --write ."
```
and run `lint` + `typecheck` in the PR workflow.

### 2.3 No `LICENSE` file (P1)
`package.json:24` declares `"license": "ISC"`, but there is no `LICENSE` file in the repo. npm
and GitHub both surface this; some downstream consumers' license scanners will flag a missing
license text.

**Recommendation:** add an `ISC` (or chosen) `LICENSE` file, and fill in the empty
`"author"` field.

### 2.4 Publish workflow robustness (P1)
`.github/workflows/publish.yml:26` runs `npm test` (watch mode, see 2.1) and there's no
`typecheck`/`lint` gate before `npm publish`. The provenance setup and OIDC permissions are
good; the test invocation is the weak link.

**Recommendation:** switch to `vitest run`, and add `tsc --noEmit` before publish.

### 2.5 npm discoverability (P2)
`"keywords": []` and empty `"author"` (`package.json:22-23`) hurt search ranking on the npm
registry for a package whose entire value proposition is being found by people building
agents.

**Recommendation:** populate keywords (e.g. `llm`, `agent`, `agent-loop`, `openai`,
`anthropic`, `gemini`, `tool-use`, `typescript`).

### 2.6 No `engines` field (P2)
Nothing declares a supported Node version, while CI pins `20.x`. Consumers on older Node get
no guardrail.

**Recommendation:** add `"engines": { "node": ">=18" }` (or match your support policy).

### 2.7 `tsconfig` module resolution mismatch (P2)
The package ships ESM (`"type": "module"`) and uses explicit `.js` import specifiers
(`src/index.test.ts:2`), but `tsconfig.json:5` uses `"moduleResolution": "node"`. For an
ESM-first package, `"NodeNext"` (or `"Bundler"`) is the more correct and future-proof choice.
Also consider `"declarationMap": true` and `"sourceMap": true` so consumers get
go-to-definition into the original sources.

### 2.8 Missing project hygiene files (P3)
- No `CHANGELOG.md` (the README mentions versions; releases drive npm publish).
- No `.nvmrc` to pin the local Node version.
- No GitHub issue/PR templates.
- No status badges (npm version, CI, license) in the README.

These are low-effort polish items that improve first-contact impressions.

### 2.9 `CONTRIBUTING.md` "LLM-only" policy is unenforceable as written (P3)
The policy is a nice statement of intent but has no mechanism (CI check, PR template
checkbox, DCO) behind it. That's fine as philosophy — just be aware it's aspirational, not
enforced.

---

## 3. Suggested sequencing

**Quick wins (hours, no API change):** 2.1 test scripts, 2.3 LICENSE, 2.5 keywords/author,
2.6 engines, 1.4 documentation note, 1.8 a real example. These alone materially improve both
DevX and first-adopter UX.

**Next (small, additive API):** 1.1 `onStep`, 1.3 `AbortSignal`, 1.5 optional
`stopCondition`. All backward-compatible.

**Later (design decisions):** 1.2 retry/error policy, 1.6 history, 1.7 streaming variant, 2.7
module-resolution migration.

None of the UX additions require breaking changes — every proposed option is additive and
optional, preserving the current minimal, zero-dependency design.
