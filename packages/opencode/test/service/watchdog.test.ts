import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { createOrResume, readEngagement, writeEngagement } from "../../src/service/engagement"
import { idleWindowMs, sweep } from "../../src/service/watchdog"

const savedHome = process.env.PWNCTL_HOME
const savedIdle = process.env.PWNCTL_IDLE_MS
let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "watchdog-"))
  process.env.PWNCTL_HOME = path.join(tmp, "home")
  process.env.PWNCTL_IDLE_MS = "1000"
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env.PWNCTL_HOME
  else process.env.PWNCTL_HOME = savedHome
  if (savedIdle === undefined) delete process.env.PWNCTL_IDLE_MS
  else process.env.PWNCTL_IDLE_MS = savedIdle
  await fs.rm(tmp, { recursive: true, force: true })
})

async function running(slug: string, last_activity: number) {
  const e = await createOrResume(slug, "clean")
  await writeEngagement({ ...e, status: "running", pid: null, last_activity })
}

test("sweep stops idle running engagements and leaves fresh ones", async () => {
  await running("old", Date.now() - 10 * 3600 * 1000)
  await running("fresh", Date.now())
  process.env.PWNCTL_IDLE_MS = "60000"
  expect(await sweep()).toEqual(["old"])
  expect((await readEngagement("old"))?.status).toBe("stopped")
  expect((await readEngagement("fresh"))?.status).toBe("running")
})

test("idleWindowMs defaults to 4h on missing or invalid env", () => {
  delete process.env.PWNCTL_IDLE_MS
  expect(idleWindowMs()).toBe(4 * 60 * 60 * 1000)
  process.env.PWNCTL_IDLE_MS = "abc"
  expect(idleWindowMs()).toBe(4 * 60 * 60 * 1000)
  process.env.PWNCTL_IDLE_MS = "0"
  expect(idleWindowMs()).toBe(4 * 60 * 60 * 1000)
})

test("sweep stops every idle engagement and returns them all", async () => {
  await running("aa", Date.now() - 10 * 3600 * 1000)
  await running("bb", Date.now() - 10 * 3600 * 1000)
  process.env.PWNCTL_IDLE_MS = "60000"
  expect((await sweep()).sort()).toEqual(["aa", "bb"])
  expect((await readEngagement("aa"))?.status).toBe("stopped")
  expect((await readEngagement("bb"))?.status).toBe("stopped")
})
