# Contributing

pwncode is a standalone extraction of the OpenCode engine (via the
PentestCode fork). Development is plain bun + turbo:

```bash
bun install
bun run dev --help        # engine CLI from source
bun turbo typecheck       # all 19 packages must stay green
```

## Rules

- **Typecheck stays green.** `bun turbo typecheck` must pass on every PR — CI enforces it.
- **No pentest features.** This is the generic agent harness. Security-tooling
  additions belong in downstream forks, not here (see README for what was removed).
- **Boring, faithful engine.** Prefer minimal diffs over refactors; the value of
  this repo is a stable, embeddable engine, not novelty.
- Keep MIT headers and the provenance note in LICENSE/README intact.

## Layout

- `packages/opencode` — the engine (session, agent, tools, server, CLI)
- `packages/core` — core primitives (config, storage, skills, agents)
- `packages/llm` — LLM client layer (providers/protocols)
- `specs/` — architecture notes (v2 design docs)
- `packages/*/test` — per-package bun tests

## Tests

`bun test` runs per package (`cd packages/core && bun test`). Three
session-runner tests were failing in the upstream fork at extraction time and
are still red (marked known-fail); new work must not add more.
