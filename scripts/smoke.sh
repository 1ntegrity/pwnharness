#!/usr/bin/env bash
# PwnCode smoke test — "did my install actually work?"
#
# Verifies: server boots, a provider is configured, and a full model turn
# completes with an assistant reply. Exits 0 on success.
#
# Usage:
#   scripts/smoke.sh                # start an ephemeral server on a free port, test, stop it
#   scripts/smoke.sh http://127.0.0.1:4097   # test an already-running server
#
# Env:
#   PWNCODE_URL            same as passing URL as $1
#   PWNCODE_SMOKE_TIMEOUT  max wait for the model turn, seconds (default 180)
#   XDG_CONFIG_HOME / XDG_DATA_HOME  respected when checking provider config
#
# Dependencies: bash, curl, bun (the harness itself needs both anyway).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:$PATH"

URL="${1:-${PWNCODE_URL:-}}"
TIMEOUT_S="${PWNCODE_SMOKE_TIMEOUT:-180}"
CANARY="PWNCODE-OK"
LOG=/tmp/pwncode-smoke.log
SRV_PID=""

step()  { printf '  %s\n' "$*"; }
fail()  { printf '\nSMOKE FAIL: %s\n' "$*" >&2; cleanup; exit 1; }
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; }

trap cleanup EXIT

command -v curl >/dev/null || fail "curl not found"
command -v bun  >/dev/null || fail "bun not found (https://bun.sh)"
[ -d node_modules ]        || fail "dependencies not installed — run: bun install"

# ---- provider config precheck (friendly error instead of a 2-minute hang) ----
CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pwncode"
AUTH="${XDG_DATA_HOME:-$HOME/.local/share}/pwncode/auth.json"
[ -f "$CFG_DIR/pwncode.json" ] || fail "no provider config at $CFG_DIR/pwncode.json — see README → Quickstart"
[ -f "$AUTH" ]                 || fail "no credentials at $AUTH — see README → Quickstart"

# ---- server: reuse or spawn ----
if [ -n "$URL" ]; then
  step "using running server at $URL"
else
  PORT=4097
  for _ in 1 2 3 4 5; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
      exec 3>&- 3<&-
      PORT=$((PORT + 1))
    else
      break
    fi
  done
  URL="http://127.0.0.1:$PORT"
  step "starting ephemeral server on port $PORT"
  bun run --cwd packages/opencode --conditions=browser src/index.ts serve \
    --port "$PORT" --hostname 127.0.0.1 >"$LOG" 2>&1 &
  SRV_PID=$!
fi

# ---- readiness ----
ready=""
for _ in $(seq 1 90); do
  code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' "$URL/doc" || true)
  if [ "$code" = "200" ]; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || fail "server did not become ready in 90s ${SRV_PID:+(log: $LOG)}"

# ---- session + one model turn ----
SID=$(curl -s -X POST "$URL/session" -H 'content-type: application/json' -d '{}' |
  bun -e 'const d = await Bun.stdin.json(); console.log(d.id ?? "")')
[ -n "$SID" ] || fail "session create returned no id"

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$URL/session/$SID/prompt_async" \
  -H 'content-type: application/json' \
  -d "{\"parts\":[{\"type\":\"text\",\"text\":\"Reply with exactly one word: $CANARY\"}]}")
[ "$code" = "204" ] || fail "prompt_async returned $code"

step "model turn sent, waiting for the answer (timeout ${TIMEOUT_S}s)..."
answer=""
deadline=$((SECONDS + TIMEOUT_S))
while [ $SECONDS -lt "$deadline" ]; do
  sleep 2
  answer=$(curl -s "$URL/session/$SID/message" | SID="$SID" bun -e '
    const msgs = await Bun.stdin.json();
    const last = msgs[msgs.length - 1];
    if (!last || last.info.role !== "assistant" || !last.info.time?.completed) process.exit(0);
    const t = last.parts.filter(p => p.type === "text").map(p => p.text).join(" ");
    console.log(t);')
  [ -n "$answer" ] && break
done
[ -n "$answer" ] || fail "no completed assistant reply in ${TIMEOUT_S}s — provider/model probably misconfigured"

# ---- verdict ----
curl -s -X DELETE "$URL/session/$SID" -o /dev/null
elapsed=$SECONDS
if printf '%s' "$answer" | grep -q "$CANARY"; then
  printf '\nSMOKE PASS — server, provider and model turn all work (%ss)\n  session %s (deleted), answer: %s\n' \
    "$elapsed" "$SID" "$(printf '%s' "$answer" | tr -d '\n' | cut -c1-80)"
  cleanup
  exit 0
else
  fail "model replied but without the canary. Answer was: $(printf '%s' "$answer" | tr -d '\n' | cut -c1-200)"
fi
