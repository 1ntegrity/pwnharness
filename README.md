# pwncode

Standalone agent harness: the OpenCode engine extracted from
[PentestCode](https://github.com/s0ld13rr/pentestcode) (`s0ld13rr/pentestcode` @ `63e379c`),
itself a hard fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT).

## What this is

The generic coding-agent runtime — sessions, agents, providers (20+ LLM backends), the
tool bus (read/edit/write/glob/grep/shell/task/plan/question/skill/webfetch/websearch/screenshot),
LSP, MCP, permissions, skill layering (bundled/user/pack/project), storage, and the
headless server + TUI — with the entire penetration-testing layer removed:

- 21 pentest tools (nmap/nuclei/gobuster/cme/bloodhound/sqlmap parsers, cred-spray,
  jwt-analyze, xss-detect, inject-probe, attack-path-suggest, scope-check, state-*, 
  task-graph, phase-control, report-gen, tunnel-manage, os-hook, ensure-tools, knowledge)
- pentest agents/prompts (recon/scanner/enumerator/exploiter/reporter/critic/webapp/...),
  engagement + knowledge stores, pentest events, scope gating, the anti-solo rail,
  the deterministic orchestrator, pentest slash-commands, skills/phases/playbooks, TUI
  engagement surfaces

- everything renamed `@pentestcode/*` → `@pwncode/*`; config/data dirs are
  `pwncode.json(c)` / `.pwncode/` / `~/.pwncode/` (legacy
  `opencode.*` names still accepted), so it does not touch an installed PentestCode

## Quickstart (2 minutes)

```bash
git clone <this-repo> && cd pwncode
bun install                                # needs bun >= 1.3
bun run dev serve --port 4097              # headless server on 127.0.0.1:4097
```

Point any OpenAI-compatible provider at it:

```bash
mkdir -p ~/.config/pwncode ~/.local/share/pwncode
cat > ~/.config/pwncode/pwncode.json <<'EOF'
{
  "model": "my-provider/my-model",
  "provider": {
    "my-provider": {
      "options": { "baseURL": "https://api.example.com/v1" },
      "models": { "my-model": { "name": "My Model" } }
    }
  }
}
EOF
echo '{"my-provider": {"type": "api", "key": "sk-..."}}' > ~/.local/share/pwncode/auth.json
chmod 600 ~/.local/share/pwncode/auth.json
```

Verify: `curl -X POST localhost:4097/session -d '{}' -H 'content-type: application/json'`
then `POST /session/<id>/prompt_async` with `{"parts":[{"type":"text","text":"hi"}]}`.
API docs: `GET /doc`.

Default agents: `build` (primary), `plan` (read-only planning), plus the internal
compaction/title/summary agents. Bundled-skill seeding is content-agnostic: the repo
ships zero skills; drop skill packs into `~/.pwncode/skills/` or wire
`skills.paths` in config.

## Run

Connect to [pi](integrations/pi/README.md) as a front-end: `pi install ./integrations/pi/harness-bridge.ts`.

```bash
bun install
bun run dev --help          # engine CLI (serve, run, skills, mcp, ...)
bun run dev serve           # headless HTTP server
```

Package layout and architecture docs: `specs/` (v2 design notes), engine source in
`packages/opencode/src/`, core primitives in `packages/core/src/`.

## Provenance & license

MIT. Baseline commit `d14826a` in this repo is the unmodified PentestCode source;
commits after it are the extraction. Upstream credit: OpenCode contributors
(anomalyco/opencode) and PentestCode contributors (s0ld13rr/pentestcode).
