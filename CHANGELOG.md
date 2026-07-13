# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-07-13

### Added

- `onStep` callback for per-iteration observability (logging, tracing, progress, token accounting). ([#12](https://github.com/rjolaverria/llm-agent-loop/pull/12))
- `signal` option for cancellation via `AbortSignal`; the loop resolves with `reason: 'aborted'` instead of throwing. ([#13](https://github.com/rjolaverria/llm-agent-loop/pull/13))
- `onError` handler for `llmCaller` failures, returning `'retry'` / `'stop'` (resolves with `reason: 'error'`) / `'throw'`, with caller-bounded retries via `info.attempt`. ([#15](https://github.com/rjolaverria/llm-agent-loop/pull/15))
- `durationMs` in every result, and an opt-in `history` transcript via `collectHistory`. ([#16](https://github.com/rjolaverria/llm-agent-loop/pull/16))
- `agentLoopStream`, an async-iterator variant that yields each step and returns the final result; `agentLoop` is implemented by draining it. ([#17](https://github.com/rjolaverria/llm-agent-loop/pull/17))
- Runnable real-provider example (`examples/anthropic-tool-call.ts`). ([#11](https://github.com/rjolaverria/llm-agent-loop/pull/11))

### Changed

- `stopCondition` is now optional; omit it to run until `maxLoops` (or an abort). ([#14](https://github.com/rjolaverria/llm-agent-loop/pull/14))
- Migrated TypeScript to `NodeNext` module resolution and now ship declaration/source maps plus `src/index.ts` for go-to-definition into sources. ([#18](https://github.com/rjolaverria/llm-agent-loop/pull/18))
- **BREAKING:** raised the supported runtime to Node 22 (`engines.node: ">=22.13.0"`), dropping Node 18/20 — this is what makes the release a major version. Ships alongside the ESLint/Prettier toolchain, a Husky pre-commit hook, and lint/format/typecheck gates in CI and the publish workflow. ([#19](https://github.com/rjolaverria/llm-agent-loop/pull/19), [#20](https://github.com/rjolaverria/llm-agent-loop/pull/20))

### Fixed

- `npm test` now runs once (`vitest run`) instead of hanging in watch mode. ([#6](https://github.com/rjolaverria/llm-agent-loop/pull/6))

### Documentation

- Documented that the response which stops the loop is not folded into `finalContext` (use `lastResponse`). ([#10](https://github.com/rjolaverria/llm-agent-loop/pull/10))

## [1.0.2]

Initial published baseline: the core `agentLoop(options)` primitive (`llmCaller`, `stopCondition`, `updateContext`, `maxLoops`) returning a typed `AgentLoopResult` (`finalContext`, `lastResponse`, `reason`, `iterations`).

[unreleased]: https://github.com/rjolaverria/llm-agent-loop/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/rjolaverria/llm-agent-loop/compare/v1.0.2...v2.0.0
[1.0.2]: https://github.com/rjolaverria/llm-agent-loop/releases/tag/v1.0.2
