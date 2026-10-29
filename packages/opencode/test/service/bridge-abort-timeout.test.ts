import { afterEach, beforeEach, expect, test } from "bun:test"
import harnessBridge from "../../../../integrations/omp/harness-bridge.ts"
import pentestBridge from "../../../../integrations/omp/pentest-bridge.ts"

// Minimal pi.zod stub: every builder returns the same chainable node, and safeParse
// passes data through untouched so parseBoundary decodes whatever the fake server sends.
function fakeZodNode(): any {
  const node: any = {
    describe: () => node,
    optional: () => node,
    safeParse: (data: unknown) => ({ success: true, data }),
  }
  return node
}
const fakeZod: any = {
  object: () => fakeZodNode(),
  string: () => fakeZodNode(),
  number: () => fakeZodNode(),
  literal: () => fakeZodNode(),
  union: () => fakeZodNode(),
  array: () => fakeZodNode(),
  record: () => fakeZodNode(),
  unknown: () => fakeZodNode(),
}

function captureTool(bridge: (pi: any) => void) {
  let tool: any
  bridge({ zod: fakeZod, registerTool: (t: any) => (tool = t) })
  if (!tool) throw new Error("bridge did not register a tool")
  return tool
}

// A harness that never finishes a turn: messages stay empty and status stays busy,
// so the bridge's wait loop can only exit via the timeout path.
function fakeHarness() {
  let abortHits = 0
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === "POST" && url.pathname === "/session") return Response.json({ id: "ses_test" })
      if (url.pathname.endsWith("/prompt_async")) return new Response("")
      if (url.pathname.endsWith("/abort")) {
        abortHits += 1
        return new Response("")
      }
      if (url.pathname.endsWith("/message")) return Response.json([])
      if (url.pathname === "/session/status") return Response.json({ ses_test: { type: "busy" } })
      return new Response("", { status: 404 })
    },
  })
  return { server, base: `http://127.0.0.1:${server.port}`, abortHits: () => abortHits }
}

const saved = {
  PATH: process.env.PATH,
  HARNESS_URL: process.env.HARNESS_URL,
  PENTEST_URL: process.env.PENTEST_URL,
}

beforeEach(() => {
  // No pwnctl on PATH -> resolveBase() falls back to the *_URL env var. Both bridges'
  // defaults (4097/4098) point at real engine ports, so the fake URL must be set for
  // whichever var the bridge reads (harness -> HARNESS_URL, pentest -> PENTEST_URL).
  process.env.PATH = ""
})

afterEach(() => {
  for (const key of ["PATH", "HARNESS_URL", "PENTEST_URL"] as const) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

for (const [name, bridge] of [
  ["harness", harnessBridge],
  ["pentest", pentestBridge],
] as const) {
  test(`${name} bridge aborts the harness run when the wait times out`, async () => {
    const h = fakeHarness()
    process.env.HARNESS_URL = h.base
    process.env.PENTEST_URL = h.base
    try {
      const tool = captureTool(bridge)
      const res = await tool.execute("call-1", { action: "run", prompt: "do the thing", timeoutMs: 0 }, undefined, undefined)

      expect(h.abortHits()).toBe(1)
      expect(res.isError).toBe(true)
      expect(res.details.timeout).toBe(true)
      expect(res.details.aborted).toBe(true)
      expect(res.details.sessionID).toBe("ses_test")
      expect(res.content[0].text).toContain("TIMEOUT")
      expect(res.content[0].text).toContain("aborted the harness run")
    } finally {
      h.server.stop(true)
    }
  })
}
