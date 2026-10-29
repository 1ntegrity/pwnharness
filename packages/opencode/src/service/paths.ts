import os from "os"
import path from "path"

const SLUG = /^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/

export function serviceRoot(): string {
  return process.env.PWNCTL_HOME ?? path.join(os.homedir(), ".local/share/pwnharness")
}

export function flavorDir(flavor: string): string {
  validateSlug(flavor)
  return path.join(serviceRoot(), "flavors", flavor)
}

export function engagementDir(slug: string): string {
  validateSlug(slug)
  return path.join(serviceRoot(), "engagements", slug)
}

export function engagementDataRoot(slug: string): string {
  return path.join(engagementDir(slug), "data")
}

export function canonicalAuthPath(): string {
  return path.join(serviceRoot(), "auth.json")
}

export function currentEngagementPath(): string {
  return path.join(serviceRoot(), "current-engagement")
}

export function validateSlug(slug: string): void {
  if (SLUG.test(slug)) return
  throw new Error(`invalid engagement slug "${slug}": use 2-39 chars of lowercase letters, digits and hyphens, not starting or ending with a hyphen`)
}

export function derivePort(slug: string): number {
  let h = 5381
  for (const ch of slug) h = (h * 33 + ch.charCodeAt(0)) >>> 0
  return 42000 + (h % 1000)
}
