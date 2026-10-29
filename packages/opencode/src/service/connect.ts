import fs from "fs/promises"
import os from "os"
import { existsSync } from "fs"
import path from "path"

export type Front = "omp"

// integrations/ lives at the repo root; walk up from this module to find it.
const repoRoot = (() => {
  const find = (dir: string): string => {
    if (existsSync(path.join(dir, "integrations"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("repo root with integrations/ not found")
    return find(parent)
  }
  return find(import.meta.dir)
})()

// Resolved lazily; Bun's os.homedir() ignores HOME changes after startup, so read the env first.
function front(name: Front) {
  const home = process.env.HOME ?? os.homedir()
  const sources = ["integrations/omp/harness-bridge.ts", "integrations/omp/pentest-bridge.ts"]
  const extDir = path.join(home, ".omp/agent/extensions")
  return {
    home,
    extDir,
    pairs: sources.map((s) => ({ src: path.join(repoRoot, s), dest: path.join(extDir, path.basename(s)) })),
    // The bridge spawns `pwnctl ensure-up` to resolve (and auto-launch) the right engagement
    // engine. If pwnctl is not on PATH the spawn fails and the bridge silently falls back to the
    // default port — bypassing `engage start` entirely and often hitting a stale server. Linking
    // pwnctl next to omp (~/.local/bin, where omp installs) keeps the two discoverable together.
    pwnctl: { src: path.join(repoRoot, "bin/pwnctl"), dest: path.join(home, ".local/bin/pwnctl") },
  }
}

export async function connectFront(name: Front): Promise<string[]> {
  const f = front(name)
  await fs.mkdir(f.extDir, { recursive: true })
  await Promise.all(f.pairs.map((p) => fs.copyFile(p.src, p.dest)))
  await fs.mkdir(path.dirname(f.pwnctl.dest), { recursive: true })
  await fs.rm(f.pwnctl.dest, { force: true })
  await fs.symlink(f.pwnctl.src, f.pwnctl.dest)
  const onPath = (process.env.PATH ?? "").split(path.delimiter).includes(path.dirname(f.pwnctl.dest))
  if (!onPath) {
    console.error(`pwnctl: linked ${f.pwnctl.dest}, but ${path.dirname(f.pwnctl.dest)} is not on PATH — add it so the bridge can find pwnctl`)
  }
  return [...f.pairs.map((p) => p.dest), f.pwnctl.dest]
}

export async function disconnectFront(name: Front): Promise<string[]> {
  const f = front(name)
  await Promise.all(f.pairs.map((p) => fs.rm(p.dest, { force: true })))
  // Only remove the pwnctl link if it is ours (points back into this repo), never a real binary.
  const link = await fs.readlink(f.pwnctl.dest).catch(() => null)
  if (link === f.pwnctl.src) await fs.rm(f.pwnctl.dest, { force: true })
  return [...f.pairs.map((p) => p.dest), f.pwnctl.dest]
}
