# pi integration

Turn [pi](https://github.com/badlogic/pi-mono) into a thin front-end for this
harness: pi's model decides when to delegate; the harness executes with its own
tools, sessions, and engagement state.

## Connect (one command)

```bash
pi install ./integrations/pi/harness-bridge.ts
```

The extension registers one tool, `harness`. Prerequisites:

- the harness server is running: `bun run dev serve --port 4097` (or the
  provided systemd unit)
- a provider is configured (`~/.config/opencode-harness/opencode-harness.json`
  + `auth.json` — see the root README Quickstart)

## Environment

- `HARNESS_URL` — server base URL, default `http://127.0.0.1:4097`

## Usage

Say it natively — pi calls the tool itself:

> просканируй 127.0.0.1
> отрефактори этот модуль через harness

Or explicitly: `action=run`, `action=list`, optional `sessionID` to continue a
session with full context. One tool call → the bridge creates/continues the
session, waits server-side, and returns the final agent text + sessionID.

## Pentest flavor

The `pentest` branch ships `pentest-bridge.ts` (port 4098, 13 pentest agents,
engagement state, nmap/nuclei/cred-spray tooling) with the same connect
procedure.
