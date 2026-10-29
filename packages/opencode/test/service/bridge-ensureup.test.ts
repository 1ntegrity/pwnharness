import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { resolveBase } from "../../../../integrations/omp/harness-bridge.ts"

const savedPath = process.env.PATH
const savedHarnessUrl = process.env.HARNESS_URL
let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-ensureup-"))
})

afterEach(async () => {
  process.env.PATH = savedPath
  if (savedHarnessUrl === undefined) delete process.env.HARNESS_URL
  else process.env.HARNESS_URL = savedHarnessUrl
  await fs.rm(tmp, { recursive: true, force: true })
})

test("resolveBase returns the URL printed by pwnctl ensure-up on PATH", async () => {
  const stub = path.join(tmp, "pwnctl")
  await Bun.write(stub, "#!/bin/sh\necho http://127.0.0.1:42999\n")
  await fs.chmod(stub, 0o755)
  process.env.PATH = `${tmp}:${savedPath}`

  expect(resolveBase("acme")).toBe("http://127.0.0.1:42999")
})

test("resolveBase falls back to HARNESS_URL when pwnctl is missing", async () => {
  process.env.PATH = tmp
  process.env.HARNESS_URL = "http://127.0.0.1:5555"

  expect(resolveBase()).toBe("http://127.0.0.1:5555")
})

test("resolveBase falls back to HARNESS_URL when pwnctl exits non-zero", async () => {
  const stub = path.join(tmp, "pwnctl")
  await Bun.write(stub, "#!/bin/sh\nexit 1\n")
  await fs.chmod(stub, 0o755)
  process.env.PATH = tmp
  process.env.HARNESS_URL = "http://127.0.0.1:6666"

  expect(resolveBase()).toBe("http://127.0.0.1:6666")
})
