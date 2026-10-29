import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
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
} from "../../src/service/engagement"
import { canonicalAuthPath, derivePort, engagementDataRoot, engagementDir } from "../../src/service/paths"

const saved = process.env.PWNCTL_HOME
let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engagement-"))
  process.env.PWNCTL_HOME = path.join(tmp, "home")
  await Bun.write(canonicalAuthPath(), "{}")
})

afterEach(async () => {
  if (saved === undefined) delete process.env.PWNCTL_HOME
  else process.env.PWNCTL_HOME = saved
  await fs.rm(tmp, { recursive: true, force: true })
})

test("createOrResume makes dirs, derives port, persists; resume keeps created", async () => {
  const a = await createOrResume("acme", "pentest")
  expect(a.port).toBe(derivePort("acme"))
  expect(a.status).toBe("stopped")
  const b = await createOrResume("acme", "pentest")
  expect(b.created).toBe(a.created)
})

test("seedAuthSymlink points engagement data auth at canonical", async () => {
  await createOrResume("acme", "pentest")
  await seedAuthSymlink("acme")
  await seedAuthSymlink("acme")
  const link = path.join(engagementDataRoot("acme"), "pwnharness", "auth.json")
  expect(await fs.realpath(link)).toBe(await fs.realpath(canonicalAuthPath()))
})

test("touchActivity advances last_activity", async () => {
  const a = await createOrResume("acme", "pentest")
  await Bun.sleep(5)
  await touchActivity("acme")
  expect((await readEngagement("acme"))!.last_activity).toBeGreaterThan(a.last_activity)
})

test("archive marks archived and keeps data for resume", async () => {
  await createOrResume("acme", "pentest")
  await archiveEngagement("acme")
  expect((await readEngagement("acme"))!.status).toBe("archived")
  expect(await Bun.file(path.join(engagementDir("acme"), "engagement.json")).exists()).toBe(true)
  expect((await fs.readdir(path.join(engagementDir("acme"), "archive"))).length).toBe(1)
  expect((await fs.stat(path.join(engagementDataRoot("acme"), "pwnharness"))).isDirectory()).toBe(true)
})

test("listEngagements returns all", async () => {
  expect(await listEngagements()).toEqual([])
  await createOrResume("acme", "pentest")
  await createOrResume("beta-co", "pentest")
  expect((await listEngagements()).map((e) => e.slug).sort()).toEqual(["acme", "beta-co"])
})

test("current pointer round-trips", async () => {
  expect(await getCurrent()).toBeNull()
  await setCurrent("acme")
  expect(await getCurrent()).toBe("acme")
})

test("traversal slugs are rejected by every entry point", async () => {
  await expect(readEngagement("../evil")).rejects.toThrow()
  await expect(touchActivity("../evil")).rejects.toThrow()
  await expect(archiveEngagement("../evil")).rejects.toThrow()
  await expect(seedAuthSymlink("../evil")).rejects.toThrow()
  await expect(createOrResume("../evil", "pentest")).rejects.toThrow()
})
