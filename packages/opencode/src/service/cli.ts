import path from "path"
import { connectFront, disconnectFront } from "./connect"
import type { Front } from "./connect"
import { getCurrent, listEngagements } from "./engagement"
import { flavorStatus, installFlavor, uninstallFlavor } from "./flavor"
import { sweep } from "./watchdog"
import { PreflightError, ensureUp, preflight, start, status, stop } from "./manager"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const args = process.argv.slice(2)

function flag(name: string) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

function positional(n: number) {
  return args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))[n]
}

function need(value: string | undefined, what: string): string {
  if (value) return value
  throw new Error(`missing ${what}`)
}

async function run() {
  const verb = args[0]
  const sub = positional(1)
  const flavor = flag("flavor") ?? positional(2) ?? "pentest"

  if (verb === "flavor") {
    if (sub === "build") {
      console.log(`run: bun run --cwd ${repoRoot}/packages/opencode script/build.ts --single --skip-embed-web-ui`)
      return
    }
    const name = positional(2) ?? "pentest"
    if (sub === "install") {
      const bin = path.resolve(need(flag("bin"), "--bin <built binary path>"))
      // Record the source tree the BINARY was built from (its own git worktree), not pwnctl's
      // own repo: the pentest flavor is built from a separate worktree/branch, so using pwnctl's
      // cwd would record the wrong tree and make the flavor read as perpetually "stale".
      const src = await Bun.$`git -C ${path.dirname(bin)} rev-parse --show-toplevel`
        .quiet()
        .text()
        .then((s) => s.trim())
        .catch(() => "")
      console.log(JSON.stringify(await installFlavor(name, bin, src || repoRoot), null, 2))
      return
    }
    if (sub === "uninstall") return uninstallFlavor(name)
    if (sub === "status") return console.log(JSON.stringify(await flavorStatus(name, repoRoot), null, 2))
    throw new Error("usage: pwnctl flavor build|install|uninstall|status [flavor]")
  }

  if (verb === "engage") {
    if (sub === "start") {
      const e = await start(need(flag("engagement") ?? positional(2), "engagement slug"), flavor, repoRoot)
      console.log(`started ${e.slug} (port ${e.port})`)
      return
    }
    if (sub === "stop") return stop(need(flag("engagement") ?? positional(2), "engagement slug"))
    if (sub === "status") return console.log(JSON.stringify(await status(), null, 2))
    if (sub === "list") {
      for (const e of await listEngagements()) console.log(`${e.slug}\t${e.status}\t${e.flavor}`)
      return
    }
    throw new Error("usage: pwnctl engage start|stop|status|list")
  }

  if (verb === "preflight") {
    await preflight(flavor, repoRoot)
    console.log("ok")
    return
  }

  if (verb === "ensure-up") {
    // A bare delegate (no --engagement) targets whatever `engage start` last set as current,
    // falling back to "default" only when nothing is current.
    const slug = flag("engagement") ?? (await getCurrent()) ?? "default"
    // stdout carries ONLY the base URL; the bridge captures it.
    console.log(await ensureUp(slug, flavor))
    return
  }

  if (verb === "connect" || verb === "disconnect") {
    if (sub !== "omp") throw new Error(`unknown front "${sub}" (supported: omp)`)
    const paths = await (verb === "connect" ? connectFront(sub as Front) : disconnectFront(sub as Front))
    for (const p of paths) console.log(`${verb === "connect" ? "installed" : "removed"} ${p}`)
    return
  }

  if (verb === "watchdog") {
    // --once is the systemd unit's explicit single-sweep request; any non---daemon invocation
    // (including no flag at all) behaves the same, but --once is named so it isn't fragile.
    if (args.includes("--once") || !args.includes("--daemon")) {
      const stopped = await sweep()
      console.log(stopped.length ? `stopped: ${stopped.join(", ")}` : "no idle engagements")
      return
    }
    while (true) {
      const stopped = await sweep()
      if (stopped.length) console.log(`stopped: ${stopped.join(", ")}`)
      await Bun.sleep(60_000)
    }
  }

  throw new Error(
    "usage: pwnctl flavor|engage|preflight|ensure-up|connect|disconnect|watchdog (see docs for arguments)",
  )
}

// Small try/catch: PreflightError carries an operator-facing fix line.
try {
  await run()
} catch (err) {
  if (err instanceof PreflightError) {
    console.error(`error: ${err.message}`)
    console.error(`fix: ${err.fix}`)
    process.exit(1)
  }
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
