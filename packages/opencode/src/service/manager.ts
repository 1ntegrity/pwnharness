import fs from "fs/promises"
import { openSync, readFileSync } from "fs"
import os from "os"
import path from "path"
import {
  archiveEngagement,
  createOrResume,
  getCurrent,
  listEngagements,
  readEngagement,
  seedAuthSymlink,
  setCurrent,
  touchActivity,
  writeEngagement,
} from "./engagement"
import type { Engagement } from "./engagement"
import { flavorStatus, staleWarning } from "./flavor"
import { canonicalAuthPath, engagementDataRoot, engagementDir, flavorDir, serviceRoot } from "./paths"

const BOOT_TIMEOUT_MS = 30_000
const STALE_LOCK_MS = 60_000

export class PreflightError extends Error {
  fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.name = "PreflightError"
    this.fix = fix
  }
}

export async function preflight(flavor: string, sourceDir: string): Promise<void> {
  const rebuild = `pwnctl flavor build ${flavor} && pwnctl flavor install ${flavor}`
  const flavorState = await flavorStatus(flavor, sourceDir)
  if (!flavorState.installed) throw new PreflightError(`flavor "${flavor}" is not installed`, rebuild)
  if (flavorState.stale) throw new PreflightError(`flavor "${flavor}" is stale: source changed since install`, rebuild)

  const auth = Bun.file(canonicalAuthPath())
  const providers = (await auth.exists()) ? await auth.json().catch(() => null) : null
  if (!providers || typeof providers !== "object" || Object.keys(providers).length === 0)
    throw new PreflightError(
      `no provider credentials in ${canonicalAuthPath()}`,
      `add a provider to ${canonicalAuthPath()} (e.g. copy ~/.local/share/opencode/auth.json)`,
    )

  // The engine reads its config from XDG config, not from the service root.
  const configPath = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "pwnharness", "pwnharness.json")
  const config = (await Bun.file(configPath).json().catch(() => null)) as { model?: unknown } | null
  if (!config || typeof config.model !== "string" || !config.model)
    throw new PreflightError(`no model configured in ${configPath}`, `set a "model" (provider/model) in ${configPath}`)

  const probe = path.join(serviceRoot(), `.write-probe-${process.pid}`)
  const writable = await fs
    .mkdir(serviceRoot(), { recursive: true })
    .then(() => Bun.write(probe, ""))
    .then(() => fs.rm(probe, { force: true }))
    .then(() => true)
    .catch(() => false)
  if (!writable) throw new PreflightError(`data root ${serviceRoot()} is not writable`, `chmod u+w ${serviceRoot()}`)
}

export async function isLive(port: number): Promise<boolean> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 1000)
  return fetch(`http://127.0.0.1:${port}/session`, { signal: ctl.signal })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timer))
}

export async function ensureUp(slug: string, flavor: string): Promise<string> {
  const initial = await createOrResume(slug, flavor)
  if (await isRunning(initial)) {
    // Warm path: the bridge's only activity signal is calling ensure-up, so touch it here too.
    await touchActivity(slug)
    return urlOf(initial.port)
  }

  const lock = path.join(engagementDir(slug), ".lock")
  const held = await acquireLock(lock)
  if (!held) {
    // Another caller is spawning: wait for it, re-reading the record since it may change the port.
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const e = (await readEngagement(slug)) ?? initial
      if (await isLive(e.port)) return urlOf(e.port)
      await Bun.sleep(200)
    }
    throw new Error(`timed out waiting for engagement "${slug}" to come up`)
  }

  // try/finally is deliberate here: a leaked lock would wedge the engagement.
  try {
    // Double-check under the lock: a previous holder may have finished while we waited to acquire.
    const current = (await readEngagement(slug)) ?? initial
    if (await isRunning(current)) return urlOf(current.port)

    // Recorded pid is dead/absent, so anything answering on the port is a foreign process.
    const port = (await portFree(current.port)) ? current.port : await nextFreePort(current.port + 1)
    const record = { ...current, port }
    await writeEngagement(record)

    // Idempotent: must happen before spawn so an auto-launched engine (bridge -> ensure-up,
    // no prior `engage start`) still gets provider credentials.
    await seedAuthSymlink(slug)
    // Auto-launch skips preflight, so warn (best-effort) if the installed flavor is stale.
    const warn = await staleWarning(flavor).catch(() => null)
    if (warn) console.error(`pwnctl: ${warn}`)
    const proc = spawnEngine(record, flavor)
    // Persist the pid right away so stop/status can always reach the engine during boot.
    const reset = () => writeEngagement({ ...record, pid: null, status: "stopped" })
    await writeEngagement({ ...record, pid: proc.pid, status: "running" })
      .then(async () => {
        const deadline = Date.now() + BOOT_TIMEOUT_MS
        while (Date.now() < deadline) {
          if (await isLive(port)) return
          if (!pidAlive(proc.pid)) throw new Error(`engine for "${slug}" exited before becoming live (see engine.log)`)
          await Bun.sleep(200)
        }
        throw new Error(`engine for "${slug}" did not become live on port ${port} within ${BOOT_TIMEOUT_MS / 1000}s`)
      })
      .catch(async (err) => {
        if (pidAlive(proc.pid)) proc.kill("SIGKILL")
        await reset()
        throw err
      })
    await touchActivity(slug)
    return urlOf(port)
  } finally {
    await fs.rm(lock, { force: true })
  }
}

export async function start(slug: string, flavor: string, sourceDir: string): Promise<Engagement> {
  await preflight(flavor, sourceDir)
  await createOrResume(slug, flavor)
  await seedAuthSymlink(slug)
  await ensureUp(slug, flavor)
  await setCurrent(slug)
  return (await readEngagement(slug))!
}

export async function stop(slug: string): Promise<void> {
  const e = await readEngagement(slug)
  if (!e) throw new Error(`unknown engagement "${slug}"`)
  if (e.pid && pidAlive(e.pid)) {
    // The engine is spawned detached (process-group leader), so its tool subprocesses
    // (nmap/nuclei/long scans) share the group. Signal the whole group, not just the pid,
    // or those scans get reparented to init and keep running after "stop".
    killGroup(e.pid, "SIGTERM")
    if (!(await waitDead(e.pid, 5000))) {
      killGroup(e.pid, "SIGKILL")
      await waitDead(e.pid, 2000)
    }
  }
  await archiveEngagement(slug)
  await writeEngagement({ ...e, status: "stopped", pid: null })
}

export async function status(): Promise<{ current: string | null; engagements: Engagement[] }> {
  const engagements = await Promise.all(
    (await listEngagements()).map(async (e) => {
      if (e.status !== "running" || (e.pid && pidAlive(e.pid))) return e
      const reconciled: Engagement = { ...e, status: "stopped", pid: null }
      await writeEngagement(reconciled)
      return reconciled
    }),
  )
  return { current: await getCurrent(), engagements }
}

function urlOf(port: number) {
  return `http://127.0.0.1:${port}`
}

function killGroup(pid: number, signal: "SIGTERM" | "SIGKILL") {
  try {
    process.kill(-pid, signal)
  } catch (err) {
    // ESRCH means the group is already gone.
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err
  }
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
  } catch (err) {
    // EPERM means the pid exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
  // kill(pid, 0) also succeeds for a zombie (defunct) process; on Linux, read the process state
  // and treat a zombie as dead so a not-yet-reaped engine isn't mistaken for live.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    return stat.slice(stat.lastIndexOf(")") + 2).trimStart()[0] !== "Z"
  } catch {
    // No procfs (non-Linux) or a read race: fall back to "alive".
    return true
  }
}

async function waitDead(pid: number, ms: number) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true
    await Bun.sleep(50)
  }
  return !pidAlive(pid)
}

async function isRunning(e: Engagement) {
  return !!e.pid && pidAlive(e.pid) && (await isLive(e.port))
}

async function acquireLock(lock: string): Promise<boolean> {
  const take = () =>
    fs
      .open(lock, "wx")
      .then((h) => h.close())
      .then(() => true)
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code === "EEXIST") return false
        throw err
      })
  if (await take()) return true
  // A crashed holder never releases; reclaim locks older than any legitimate boot.
  const age = await fs.stat(lock).then((s) => Date.now() - s.mtimeMs).catch(() => 0)
  if (age < STALE_LOCK_MS) return false
  await fs.rm(lock, { force: true })
  return take()
}

// Bind-probe: listen fails with EADDRINUSE when anything (HTTP or not) holds the port.
function portFree(port: number) {
  try {
    Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }).stop(true)
    return true
  } catch {
    return false
  }
}

async function nextFreePort(from: number): Promise<number> {
  for (let p = from; p < 65535; p++) if (portFree(p)) return p
  throw new Error("no free port available")
}

function spawnEngine(e: Engagement, flavor: string) {
  const log = openSync(path.join(engagementDir(e.slug), "engine.log"), "a")
  const proc = Bun.spawn([path.join(flavorDir(flavor), "engine"), "serve", "--port", String(e.port), "--hostname", "127.0.0.1"], {
    env: {
      ...process.env,
      XDG_DATA_HOME: engagementDataRoot(e.slug),
      // A detached engagement engine is a headless server with no interactive client on its
      // permission channel: any tool that calls ctx.ask (glob/grep on an external dir, bash,
      // external_directory, …) would block FOREVER waiting for an approval nobody can give —
      // the real cause of the "agent silently hangs for minutes" failures. These engines are
      // operator-launched and driven by a trusted front that already auto-approves, so grant
      // the engine blanket allow. `serve` has no --yolo flag; OPENCODE_PERMISSION is the knob
      // (merged into config.permission; "*" is the catch-all the bare "allow" string normalizes to).
      OPENCODE_PERMISSION: process.env.OPENCODE_PERMISSION ?? '{"*":"allow"}',
    },
    stdin: "ignore",
    detached: true,
    stdout: log,
    stderr: log,
  })
  proc.unref()
  return proc
}
