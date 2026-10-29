import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { readEngagement } from "../../src/service/engagement"
import { installFlavor } from "../../src/service/flavor"
import { ensureUp, isLive, PreflightError, preflight, status, stop } from "../../src/service/manager"

const builtBin = path.resolve(import.meta.dir, "../../dist/pwnharness-linux-x64/bin/pwnharness")
const saved = process.env.PWNCTL_HOME
const savedXdg = process.env.XDG_CONFIG_HOME
const started: string[] = []
let tmp: string
let src: string

const portOf = (url: string) => Number(new URL(url).port)
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function waitUntilDead(pid: number) {
  for (let i = 0; i < 100 && alive(pid); i++) await Bun.sleep(50)
}
async function up(slug: string) {
  started.push(slug)
  return ensureUp(slug, "clean")
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "manager-"))
  process.env.PWNCTL_HOME = path.join(tmp, "home")
  src = path.join(tmp, "src")
  await fs.mkdir(src)
  await Bun.write(path.join(src, "a.txt"), "a")
  await Bun.$`git -C ${src} init -q`.quiet()
  await Bun.$`git -C ${src} add -A`.quiet()
  await Bun.$`git -C ${src} -c user.name=t -c user.email=t@t commit -q -m c`.quiet()
})

afterEach(async () => {
  await Promise.all(started.splice(0).map((slug) => stop(slug).catch(() => {})))
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
  if (saved === undefined) delete process.env.PWNCTL_HOME
  else process.env.PWNCTL_HOME = saved
  await fs.rm(tmp, { recursive: true, force: true })
})

test("preflight throws PreflightError with a fix when flavor missing", async () => {
  const e = await preflight("pentest", src).catch((x) => x)
  expect(e).toBeInstanceOf(PreflightError)
  expect(e.fix).toContain("pwnctl flavor build")
})

test("ensureUp spawns a live server and is reused on second call", async () => {
  await installFlavor("clean", builtBin, src)
  const url = await up("t1")
  expect(await isLive(portOf(url))).toBe(true)
  const pid1 = (await readEngagement("t1"))!.pid
  expect(await ensureUp("t1", "clean")).toBe(url)
  expect((await readEngagement("t1"))!.pid).toBe(pid1)
  await stop("t1")
})

test("concurrent ensureUp does not double-spawn", async () => {
  await installFlavor("clean", builtBin, src)
  started.push("t2")
  const [u1, u2] = await Promise.all([ensureUp("t2", "clean"), ensureUp("t2", "clean")])
  expect(u1).toBe(u2)
  const pid = (await readEngagement("t2"))!.pid!
  expect(alive(pid)).toBe(true)
  await stop("t2")
})

test("orphaned pid is detected and respawned", async () => {
  await installFlavor("clean", builtBin, src)
  await up("t3")
  const e = await readEngagement("t3")
  process.kill(e!.pid!, "SIGKILL")
  await waitUntilDead(e!.pid!)
  const url = await ensureUp("t3", "clean")
  expect(await isLive(portOf(url))).toBe(true)
  expect((await readEngagement("t3"))!.pid).not.toBe(e!.pid)
  await stop("t3")
})

test("stop terminates the process and records stopped", async () => {
  await installFlavor("clean", builtBin, src)
  await up("t4")
  const pid = (await readEngagement("t4"))!.pid!
  await stop("t4")
  expect((await readEngagement("t4"))!.status).not.toBe("running")
  expect(alive(pid)).toBe(false)
  expect((await status()).engagements.find((e) => e.slug === "t4")!.status).not.toBe("running")
})

test("preflight reads model from the XDG pwnharness config", async () => {
  process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg")
  await installFlavor("clean", builtBin, src)
  await Bun.write(path.join(tmp, "home", "auth.json"), JSON.stringify({ anthropic: { type: "api", key: "k" } }))
  const e = await preflight("clean", src).catch((x) => x)
  expect(e).toBeInstanceOf(PreflightError)
  expect(e.fix).toContain("pwnharness.json")
  await Bun.write(path.join(tmp, "xdg", "pwnharness", "pwnharness.json"), JSON.stringify({ model: "anthropic/claude" }))
  await preflight("clean", src)
})

test("engine that exits during boot fails fast and leaves no pid", async () => {
  const fake = path.join(tmp, "fake-engine")
  await Bun.write(fake, "#!/bin/sh\nexit 1\n")
  await fs.chmod(fake, 0o755)
  await installFlavor("clean", fake, src)
  const t0 = Date.now()
  const e = await ensureUp("t5", "clean").catch((x) => x)
  expect(e).toBeInstanceOf(Error)
  expect(Date.now() - t0).toBeLessThan(10_000)
  const rec = (await readEngagement("t5"))!
  expect(rec.pid).toBeNull()
  expect(rec.status).toBe("stopped")
})
