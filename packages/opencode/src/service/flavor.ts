import fs from "fs/promises"
import path from "path"
import { flavorDir } from "./paths"

export type FlavorInstall = { flavor: string; fingerprint: string; engine_bin: string; source_dir: string; installed_at: number }

export async function fingerprintSource(sourceDir: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  // ls-files -s captures tracked content via blob hashes; diff captures uncommitted edits to
  // tracked files; ls-files -o --exclude-standard captures new untracked (non-ignored) files,
  // so a source file added but not yet `git add`ed still marks the installed flavor stale.
  hasher.update(await Bun.$`git -C ${sourceDir} ls-files -s`.quiet().text())
  hasher.update(await Bun.$`git -C ${sourceDir} diff --no-color`.quiet().text())
  hasher.update(await Bun.$`git -C ${sourceDir} ls-files -o --exclude-standard`.quiet().text())
  return hasher.digest("hex")
}

export async function installFlavor(flavor: string, builtBinaryPath: string, sourceDir: string): Promise<FlavorInstall> {
  const dir = flavorDir(flavor)
  await fs.mkdir(dir, { recursive: true })
  const engine = path.join(dir, "engine")
  // Copy to a temp file then atomic-rename over the target. Copying straight onto `engine` fails
  // with ETXTBSY whenever an engagement engine is currently executing that binary — i.e. every
  // in-place upgrade. Rename swaps the inode: running engines keep the old one, new launches get
  // the new one, and the upgrade never errors out mid-use.
  const tmp = path.join(dir, `.engine.tmp-${process.pid}`)
  await fs.copyFile(builtBinaryPath, tmp)
  await fs.chmod(tmp, 0o755)
  await fs.rename(tmp, engine)
  const install = {
    flavor,
    fingerprint: await fingerprintSource(sourceDir),
    engine_bin: engine,
    source_dir: path.resolve(sourceDir),
    installed_at: Date.now(),
  }
  await Bun.write(path.join(dir, "install.json"), JSON.stringify(install, null, 2))
  return install
}

// Best-effort staleness check for the bare-delegate auto-launch path, which (unlike `start`)
// does not run preflight. Returns a warning when the recorded source tree is still present and
// has changed since install; null when fresh, not installed, or the source is gone (the normal
// "no source at runtime" case, where staleness cannot be judged).
export async function staleWarning(flavor: string): Promise<string | null> {
  const file = Bun.file(path.join(flavorDir(flavor), "install.json"))
  if (!(await file.exists())) return null
  const install: FlavorInstall = await file.json()
  if (!install.source_dir) return null
  const sourceExists = await fs.stat(install.source_dir).then(() => true).catch(() => false)
  if (!sourceExists) return null
  if (install.fingerprint === (await fingerprintSource(install.source_dir))) return null
  return `flavor "${flavor}" is stale: source ${install.source_dir} changed since install — run \`pwnctl flavor install ${flavor} --bin <rebuilt>\``
}

export async function uninstallFlavor(flavor: string): Promise<void> {
  await fs.rm(flavorDir(flavor), { recursive: true, force: true })
}

export async function flavorStatus(flavor: string, sourceDir: string): Promise<{ installed: boolean; stale: boolean; install?: FlavorInstall }> {
  const file = Bun.file(path.join(flavorDir(flavor), "install.json"))
  if (!(await file.exists())) return { installed: false, stale: false }
  const install: FlavorInstall = await file.json()
  // Judge staleness against the source tree RECORDED AT INSTALL, not the caller's cwd. A flavor
  // built from one worktree must not read as "stale" just because pwnctl runs from another (or
  // because an unrelated repo in cwd changed) — that false positive blocks `engage start`. Fall
  // back to the caller's dir only when no source was recorded, and treat a vanished source tree as
  // not-stale (staleness can't be judged — matches staleWarning).
  const compareDir = install.source_dir || sourceDir
  if (!(await fs.stat(compareDir).then(() => true).catch(() => false))) return { installed: true, stale: false, install }
  return { installed: true, stale: install.fingerprint !== (await fingerprintSource(compareDir)), install }
}
