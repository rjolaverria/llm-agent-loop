# Contributing to llm-agent-loop

Thank you for your interest in contributing!

## Core Philosophy

This project has a unique requirement for all contributions:

**All features and code changes must be built completely by LLMs (Large Language Models).**

We believe in the future of AI-assisted coding and want this project to be a testament to what is possible when humans and AI collaborate effectively.

### Guidelines

1.  **No Manual Coding**: Avoid writing code manually. Instead, use an AI coding assistant (like [Antigravity](https://antigravity.google/), [GitHub Copilot](https://github.com/features/copilot), [Cursor](https://cursor.sh/), [Windsurf](https://windsurf.com/editor), [Goose](https://block.github.io/goose/) or similar agentic tools) to generate the code.
2.  **Not "YOLO" Mode**: This does **not** mean you should blindly accept whatever the LLM outputs.
    - **Guidance is Key**: You are the architect. Provide clear instructions, constraints, and context to the LLM.
    - **Iterative Feedback**: If the LLM produces incorrect or suboptimal code, provide feedback and ask it to iterate. Don't fix it yourself; tell the LLM how to fix it.
    - **Review**: You are responsible for the quality of the code. Review all generated code thoroughly for correctness, security, and performance.

## How to Contribute

1.  Fork the repository.
2.  Create a new branch for your feature or fix.
3.  Prompt your LLM to implement the changes.
4.  Verify the changes (ask the LLM to write tests!).
5.  Submit a Pull Request.

## Development scripts

Before opening a PR, make sure these pass (the PR workflow runs the same checks):

- `npm run lint` — ESLint (typescript-eslint) over the project.
- `npm run format:check` — Prettier formatting check (`npm run format` to auto-fix).
- `npm run typecheck` — `tsc --noEmit` type check.
- `npm run build` — emit `dist/`.
- `npm test` — run the Vitest suite once (`npm run test:watch` for watch mode).

Happy prompting!
