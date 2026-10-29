import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { flavorStatus, installFlavor, staleWarning, uninstallFlavor } from "../../src/service/flavor"
import { flavorDir } from "../../src/service/paths"

const saved = process.env.PWNCTL_HOME
let tmp: string
let src: string
let fakeBin: string

async function gitAddCommit(dir: string) {
  await Bun.$`git -C ${dir} add -A`.quiet()
  await Bun.$`git -C ${dir} -c user.name=t -c user.email=t@t commit -q -m c`.quiet()
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "flavor-"))
  process.env.PWNCTL_HOME = path.join(tmp, "home")
  src = path.join(tmp, "src")
  fakeBin = path.join(tmp, "fake-engine")
  await fs.mkdir(src)
  await Bun.write(path.join(src, "a.txt"), "a")
  await Bun.write(fakeBin, "#!/bin/sh\n")
  await Bun.$`git -C ${src} init -q`.quiet()
  await gitAddCommit(src)
})

afterEach(async () => {
  if (saved === undefined) delete process.env.PWNCTL_HOME
  else process.env.PWNCTL_HOME = saved
  await fs.rm(tmp, { recursive: true, force: true })
})

test("install copies binary, records fingerprint, is idempotent", async () => {
  const i1 = await installFlavor("pentest", fakeBin, src)
  expect(await Bun.file(path.join(flavorDir("pentest"), "install.json")).exists()).toBe(true)
  expect(await Bun.file(i1.engine_bin).exists()).toBe(true)
  const i2 = await installFlavor("pentest", fakeBin, src)
  expect(i2.fingerprint).toBe(i1.fingerprint)
})

test("uninstall removes the flavor and is idempotent", async () => {
  await installFlavor("pentest", fakeBin, src)
  await uninstallFlavor("pentest")
  await uninstallFlavor("pentest")
  expect((await flavorStatus("pentest", src)).installed).toBe(false)
})

test("status reports stale when source changes after install", async () => {
  await installFlavor("pentest", fakeBin, src)
  expect((await flavorStatus("pentest", src)).stale).toBe(false)
  await Bun.write(path.join(src, "new.txt"), "x")
  await gitAddCommit(src)
  expect((await flavorStatus("pentest", src)).stale).toBe(true)
})

test("status reports stale on uncommitted edits", async () => {
  await installFlavor("pentest", fakeBin, src)
  await Bun.write(path.join(src, "a.txt"), "changed")
  expect((await flavorStatus("pentest", src)).stale).toBe(true)
})

test("fingerprint catches a brand-new untracked source file", async () => {
  await installFlavor("pentest", fakeBin, src)
  expect((await flavorStatus("pentest", src)).stale).toBe(false)
  await Bun.write(path.join(src, "new.ts"), "x") // untracked, not git-added
  expect((await flavorStatus("pentest", src)).stale).toBe(true)
})

test("staleWarning: null when fresh, message when source changed, null when source is gone", async () => {
  await installFlavor("pentest", fakeBin, src)
  expect(await staleWarning("pentest")).toBeNull()
  await Bun.write(path.join(src, "b.txt"), "b")
  await gitAddCommit(src)
  expect(await staleWarning("pentest")).toContain("stale")
  await fs.rm(src, { recursive: true, force: true })
  expect(await staleWarning("pentest")).toBeNull()
})
