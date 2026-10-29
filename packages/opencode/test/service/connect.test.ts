import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { connectFront, disconnectFront } from "../../src/service/connect"

const savedHome = process.env.HOME
let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "connect-"))
  process.env.HOME = tmp
})

afterEach(async () => {
  process.env.HOME = savedHome
  await fs.rm(tmp, { recursive: true, force: true })
})

test("connect copies omp bridges, disconnect removes them, both idempotent", async () => {
  const added = await connectFront("omp")
  expect(added.length).toBe(2)
  for (const p of added) {
    expect(p.startsWith(tmp)).toBe(true)
    expect(await Bun.file(p).exists()).toBe(true)
  }
  await connectFront("omp")
  const removed = await disconnectFront("omp")
  expect(removed.sort()).toEqual(added.sort())
  for (const p of removed) expect(await Bun.file(p).exists()).toBe(false)
  await disconnectFront("omp")
})
