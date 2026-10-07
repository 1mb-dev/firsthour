# Agents

Rules for AI coding agents working in this repository.

## General

- Follow existing code conventions and patterns
- Do not modify files outside the scope of the current task
- Do not add dependencies without explicit approval
- Keep changes atomic -- one concern per commit
- Ask for clarification when requirements are ambiguous

## Setup

```bash
make install     # Install dev dependencies (npm)
make setup       # Activate tracked git hooks
make check       # Lint + test (run before submitting)
make dev         # Worker on localhost via wrangler dev
make fixtures    # Re-record sanitized fixtures from live sources (manual only)
```

## Rules that hold the design together

- Every title and body is attacker-controlled. Render with `textContent` only; build links from validated ids (`src/boards/ats.ts`, `src/sources/hn.ts`), never from content.
- Bodies are for classification only. Nothing outside `select()` sees them; they never reach the browser or KV.
- Selection is deterministic and takes `now` as a parameter. Tests use the fixture clock, never wall time.
- CI never calls live sources. `scripts/probe.mjs` is manual.
- Fixtures are public: strip authors, usernames and emails before committing.

## Commits

`<type>(<scope>): <subject>`, present tense, one concern per commit.
