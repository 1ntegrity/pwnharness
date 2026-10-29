# omp integration

Turn [omp](https://github.com/can1357/oh-my-pi) into a thin front-end for this
harness: omp's model decides when to delegate; the harness executes with its own
tools, sessions, and engagement state. Same HTTP contract as the pi bridge —
only the extension API surface differs (omp injects a Zod-compatible builder as
`pi.zod`; omp's `pi.typebox` shim has no `Value`, so boundary validation uses
`safeParse` instead).

The pentest engine runs as a managed local service via `bin/pwnctl`, from an
installed flavor artifact. There is no server to start by hand and no git
worktree involved at runtime.

## One-time setup

Build and install the flavor:

```bash
pwnctl flavor build pentest                       # prints the build command; run it
pwnctl flavor install pentest --bin <built-binary-path>
pwnctl flavor status pentest                      # installed / stale
```

Configure a provider (`~/.config/pwnharness/pwnharness.json` + `auth.json` — see
the root README Quickstart), then verify everything in one shot:

```bash
pwnctl preflight [--flavor pentest]
```

`preflight` checks the flavor is installed and not stale, provider auth, a
configured model, and a writable data root. On failure it prints the command
that fixes it.

## Connect

```bash
pwnctl connect omp        # copies the bridges into ~/.omp/agent/extensions/
pwnctl disconnect omp     # removes them
```

omp auto-discovers the `harness` and `pentest` tools on startup. For a one-off
test without installing: `omp -e integrations/omp/harness-bridge.ts`.

## Use: engagements

Just delegate from omp — the `pentest` tool's first call for an engagement
auto-launches a detached engine via `pwnctl ensure-up`, with its own data
root, port (derived from the engagement slug), and `engagement.json`. The
engine survives omp restarts.

You can also drive the lifecycle directly:

```bash
pwnctl engage start acme-corp --flavor pentest
pwnctl engage status
pwnctl engage list
pwnctl engage stop acme-corp      # stops and archives
```

An idle watchdog stops abandoned engagements automatically after 4h
(override with `PWNCTL_IDLE_MS`). Run `pwnctl watchdog` once, or install the
optional systemd user timer in `integrations/systemd/` to run it
periodically.

## Environment

- `PWNCTL_HOME` — roots all service state (installed flavors, engagement data
  roots, PIDs); default `~/.local/share/pwnharness`.
- `HARNESS_URL` — base harness server URL, when connecting to a non-pentest
  server directly instead of through an engagement, default
  `http://127.0.0.1:4097`.

## Usage

The extensions register two tools, `harness` and `pentest`. Say it natively —
omp's model calls the tool itself:

> просканируй 127.0.0.1
> отрефактори этот модуль через harness

Or explicitly: `action=run`, `action=list`, optional `sessionID` to continue a
session with full context, optional `engagement` slug (the `pentest` tool) to
select or auto-start the right engine. One tool call → the bridge
creates/continues the session, waits server-side, and returns the final agent
text + sessionID.
