import fs from "fs/promises"
import path from "path"
import {
  canonicalAuthPath,
  currentEngagementPath,
  derivePort,
  engagementDataRoot,
  engagementDir,
  serviceRoot,
  validateSlug,
} from "./paths"

export type Engagement = {
  slug: string
  flavor: string
  port: number
  created: number
  last_activity: number
  pid: number | null
  status: "running" | "stopped" | "archived"
}

function recordPath(slug: string) {
  validateSlug(slug)
  return path.join(engagementDir(slug), "engagement.json")
}

export async function readEngagement(slug: string): Promise<Engagement | null> {
  const file = Bun.file(recordPath(slug))
  if (!(await file.exists())) return null
  return file.json()
}

export async function writeEngagement(e: Engagement): Promise<void> {
  await Bun.write(recordPath(e.slug), JSON.stringify(e, null, 2))
}

export async function createOrResume(slug: string, flavor: string): Promise<Engagement> {
  validateSlug(slug)
  await fs.mkdir(path.join(engagementDataRoot(slug), "pwnharness"), { recursive: true })
  const existing = await readEngagement(slug)
  const now = Date.now()
  const record: Engagement = existing
    ? { ...existing, flavor }
    : { slug, flavor, port: derivePort(slug), created: now, last_activity: now, pid: null, status: "stopped" }
  await writeEngagement(record)
  return record
}

export async function touchActivity(slug: string): Promise<void> {
  const e = await readEngagement(slug)
  if (!e) throw new Error(`unknown engagement "${slug}"`)
  await writeEngagement({ ...e, last_activity: Date.now() })
}

// A flavor binary reads auth from `$XDG_DATA_HOME/<app>/auth.json`, where <app> is the engine's
// own application name. In this repo that is "pwnharness"; "opencode" is kept as a fallback for a
// flavor built from the upstream base. Seeding under each is harmless (duplicate links to the same
// canonical auth) and the engine finds whichever it wants — without it a freshly started
// engagement 401s on its very first model call.
const AUTH_APP_DIRS = ["pwnharness", "opencode"]

export async function seedAuthSymlink(slug: string): Promise<void> {
  validateSlug(slug)
  for (const app of AUTH_APP_DIRS) {
    const target = path.join(engagementDataRoot(slug), app, "auth.json")
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.rm(target, { force: true })
    await fs.symlink(canonicalAuthPath(), target)
  }
}

export async function archiveEngagement(slug: string): Promise<void> {
  const e = await readEngagement(slug)
  if (!e) throw new Error(`unknown engagement "${slug}"`)
  const archived: Engagement = { ...e, status: "archived" }
  await writeEngagement(archived)
  await Bun.write(path.join(engagementDir(slug), "archive", `${Date.now()}.json`), JSON.stringify(archived, null, 2))
}

export async function listEngagements(): Promise<Engagement[]> {
  const slugs = await fs.readdir(path.join(serviceRoot(), "engagements")).catch(() => [])
  const all = await Promise.all(slugs.map((slug) => readEngagement(slug)))
  return all.filter((e) => e !== null)
}

export async function setCurrent(slug: string): Promise<void> {
  await Bun.write(currentEngagementPath(), slug)
}

export async function getCurrent(): Promise<string | null> {
  const file = Bun.file(currentEngagementPath())
  if (!(await file.exists())) return null
  return (await file.text()).trim()
}
