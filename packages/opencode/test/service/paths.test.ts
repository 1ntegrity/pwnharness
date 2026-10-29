import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { canonicalAuthPath, derivePort, engagementDataRoot, engagementDir, flavorDir, serviceRoot, validateSlug } from "../../src/service/paths"

const saved = process.env.PWNCTL_HOME

beforeEach(() => {
  process.env.PWNCTL_HOME = "/tmp/x"
})

afterEach(() => {
  if (saved === undefined) delete process.env.PWNCTL_HOME
  else process.env.PWNCTL_HOME = saved
})

describe("service paths", () => {
  test("serviceRoot honors PWNCTL_HOME", () => {
    expect(serviceRoot()).toBe("/tmp/x")
  })
  test("paths nest under the root", () => {
    expect(flavorDir("pentest")).toBe("/tmp/x/flavors/pentest")
    expect(engagementDir("acme")).toBe("/tmp/x/engagements/acme")
    expect(engagementDataRoot("acme")).toBe("/tmp/x/engagements/acme/data")
    expect(canonicalAuthPath()).toBe("/tmp/x/auth.json")
  })
  test("validateSlug accepts kebab, rejects junk", () => {
    expect(() => validateSlug("acme-corp-1")).not.toThrow()
    for (const bad of ["", "A", "-x", "x-", "a/b", "a".repeat(41)]) expect(() => validateSlug(bad)).toThrow()
  })
  test("engagementDir/flavorDir validate the slug (defense-in-depth, no traversal)", () => {
    expect(() => engagementDir("../evil")).toThrow()
    expect(() => engagementDataRoot("a/b")).toThrow()
    expect(() => flavorDir("../evil")).toThrow()
    expect(() => engagementDir("acme")).not.toThrow()
    expect(() => flavorDir("pentest")).not.toThrow()
  })
  test("derivePort is stable, in range, differs by slug", () => {
    expect(derivePort("acme")).toBe(derivePort("acme"))
    expect(derivePort("acme")).toBeGreaterThanOrEqual(42000)
    expect(derivePort("acme")).toBeLessThan(43000)
    expect(derivePort("acme")).not.toBe(derivePort("globex"))
  })
})
