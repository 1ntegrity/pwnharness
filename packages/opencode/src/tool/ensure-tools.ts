import { Effect, Schema } from "effect"
import DESCRIPTION from "./ensure-tools.txt"
import * as Tool from "./tool"

// Bun.spawn().exited never rejects and carries no timeout, so a tool check that blocks (DNS, a
// hung package mirror) or an install that builds from source (`go install …@latest`, SecLists
// clone) would hang this tool indefinitely with zero output — a silent multi-minute wedge of the
// whole agent. Bound every spawn: on timeout kill the process and report failure so the caller
// moves on instead of stalling.
async function spawnOk(cmd: string[], timeoutMs: number): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
  try {
    return (await proc.exited) === 0
  } finally {
    clearTimeout(timer)
  }
}

const TOOLS: Record<string, { check: string; install: Record<string, string>; category: string }> = {
  nmap: {
    check: "nmap",
    install: { apt: "apt install -y nmap", brew: "brew install nmap", pacman: "pacman -S --noconfirm nmap" },
    category: "scanning",
  },
  nuclei: {
    check: "nuclei",
    install: { go: "go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest", brew: "brew install nuclei" },
    category: "scanning",
  },
  ffuf: {
    check: "ffuf",
    install: { go: "go install github.com/ffuf/ffuf/v2@latest", apt: "apt install -y ffuf", brew: "brew install ffuf" },
    category: "web",
  },
  gobuster: {
    check: "gobuster",
    install: { go: "go install github.com/OJ/gobuster/v3@latest", apt: "apt install -y gobuster" },
    category: "web",
  },
  httpx: {
    check: "httpx",
    install: { go: "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest" },
    category: "web",
  },
  subfinder: {
    check: "subfinder",
    install: { go: "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest" },
    category: "recon",
  },
  sqlmap: {
    check: "sqlmap",
    install: { pip: "pip install sqlmap", apt: "apt install -y sqlmap" },
    category: "web",
  },
  netexec: {
    check: "netexec",
    install: { pip: "pip install netexec", pipx: "pipx install netexec" },
    category: "ad",
  },
  hydra: {
    check: "hydra",
    install: { apt: "apt install -y hydra", brew: "brew install hydra" },
    category: "brute",
  },
  hashcat: {
    check: "hashcat",
    install: { apt: "apt install -y hashcat", brew: "brew install hashcat" },
    category: "brute",
  },
  john: {
    check: "john",
    install: { apt: "apt install -y john", brew: "brew install john" },
    category: "brute",
  },
  chisel: {
    check: "chisel",
    install: { go: "go install github.com/jpillora/chisel@latest" },
    category: "pivot",
  },
  certipy: {
    check: "certipy",
    install: { pip: "pip install certipy-ad", pipx: "pipx install certipy-ad" },
    category: "ad",
  },
  "bloodhound-python": {
    check: "bloodhound-python",
    install: { pip: "pip install bloodhound", pipx: "pipx install bloodhound" },
    category: "ad",
  },
  feroxbuster: {
    check: "feroxbuster",
    install: { apt: "apt install -y feroxbuster", brew: "brew install feroxbuster" },
    category: "web",
  },
  whatweb: {
    check: "whatweb",
    install: { apt: "apt install -y whatweb", brew: "brew install whatweb" },
    category: "web",
  },
  nikto: {
    check: "nikto",
    install: { apt: "apt install -y nikto" },
    category: "web",
  },
  seclists: {
    check: "ls /usr/share/seclists 2>/dev/null || ls /opt/seclists 2>/dev/null || ls ~/seclists 2>/dev/null",
    install: { apt: "apt install -y seclists", git: "git clone --depth 1 https://github.com/danielmiessler/SecLists.git ~/seclists" },
    category: "wordlists",
  },
  impacket: {
    check: "impacket-smbclient",
    install: { pip: "pip install impacket", pipx: "pipx install impacket" },
    category: "ad",
  },
  "ligolo-ng": {
    check: "ligolo-proxy",
    install: { go: "go install github.com/nicocha30/ligolo-ng/cmd/proxy@latest && go install github.com/nicocha30/ligolo-ng/cmd/agent@latest" },
    category: "pivot",
  },
  wfuzz: {
    check: "wfuzz",
    install: { pip: "pip install wfuzz" },
    category: "web",
  },
}

const CATEGORIES = ["scanning", "web", "recon", "ad", "brute", "pivot", "wordlists"] as const

export const Parameters = Schema.Struct({
  action: Schema.Literals(["check", "install"]).annotate({
    description: "check = report status only; install = attempt to install missing tools",
  }),
  tools: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description: "Specific tools to check/install. Omit for all known tools.",
    }),
  ),
  category: Schema.optional(
    Schema.String.annotate({
      description: "Filter by category: scanning, web, recon, ad, brute, pivot, wordlists",
    }),
  ),
})

export const EnsureToolsTool = Tool.define(
  "ensure_tools",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { action: "check" | "install"; tools?: string[]; category?: string },
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const toolNames = params.tools ?? Object.keys(TOOLS)
          const filtered = params.category
            ? toolNames.filter((t) => TOOLS[t]?.category === params.category)
            : toolNames

          const results: Array<{ name: string; status: string; category: string; install_cmd?: string }> = []
          let platform = "unknown"

          const platCheck = yield* Effect.tryPromise(() =>
            Bun.spawn(["uname", "-s"], { stdout: "pipe" }).exited.then(async () => {
              const proc = Bun.spawn(["uname", "-s"], { stdout: "pipe" })
              return (await new Response(proc.stdout).text()).trim().toLowerCase()
            }),
          ).pipe(Effect.orElseSucceed(() => "linux"))

          if (platCheck.includes("darwin")) platform = "macos"
          else if (platCheck.includes("linux")) platform = "linux"

          const hasApt =
            platform === "linux"
              ? yield* Effect.tryPromise(() =>
                  Bun.spawn(["which", "apt"], { stdout: "pipe" }).exited.then((code) => code === 0),
                ).pipe(Effect.orElseSucceed(() => false))
              : false

          const hasGo = yield* Effect.tryPromise(() =>
            Bun.spawn(["which", "go"], { stdout: "pipe" }).exited.then((code) => code === 0),
          ).pipe(Effect.orElseSucceed(() => false))

          const hasPip = yield* Effect.tryPromise(() =>
            Bun.spawn(["which", "pip3"], { stdout: "pipe" }).exited.then((code) => code === 0),
          ).pipe(Effect.orElseSucceed(() => false))

          const hasPipx = yield* Effect.tryPromise(() =>
            Bun.spawn(["which", "pipx"], { stdout: "pipe" }).exited.then((code) => code === 0),
          ).pipe(Effect.orElseSucceed(() => false))

          const hasBrew = yield* Effect.tryPromise(() =>
            Bun.spawn(["which", "brew"], { stdout: "pipe" }).exited.then((code) => code === 0),
          ).pipe(Effect.orElseSucceed(() => false))

          // Ordered installer candidates: rootless first (go/pipx/pip/git), sudo-requiring last.
          const installerOrder: Array<[key: string, available: boolean]> = [
            ["go", hasGo],
            ["pipx", hasPipx],
            ["pip", hasPip],
            ["git", true],
            ["brew", hasBrew],
            ["apt", hasApt],
          ]
          function installerCandidates(install: Record<string, string>): string[] {
            const ordered = installerOrder.filter(([key, available]) => available && install[key]).map(([key]) => install[key])
            return ordered.length ? ordered : Object.values(install)
          }
          function pickInstaller(install: Record<string, string>): string | undefined {
            return installerCandidates(install)[0]
          }

          for (const name of filtered) {
            const info = TOOLS[name]
            if (!info) {
              results.push({ name, status: "unknown", category: "unknown" })
              continue
            }

            const checkCmd = info.check.includes(" ") ? ["bash", "-c", info.check] : ["which", info.check]
            const installed = yield* Effect.tryPromise(() => spawnOk(checkCmd, 10_000)).pipe(
              Effect.orElseSucceed(() => false),
            )

            if (installed) {
              results.push({ name, status: "installed", category: info.category })
            } else if (params.action === "install") {
              // Try rootless installers first; fall back to apt/sudo only if they fail.
              const candidates = installerCandidates(info.install)
              let ok = false
              let usedCmd: string | undefined
              for (const cmd of candidates) {
                // Source builds / large clones are slow but must still be bounded.
                ok = yield* Effect.tryPromise(() => spawnOk(["bash", "-c", cmd], 240_000)).pipe(
                  Effect.orElseSucceed(() => false),
                )
                if (ok) {
                  usedCmd = cmd
                  break
                }
              }
              results.push({
                name,
                status: ok ? "installed_now" : "install_failed",
                category: info.category,
                install_cmd: usedCmd ?? candidates[0],
              })
            } else {
              const cmd = pickInstaller(info.install)
              results.push({ name, status: "missing", category: info.category, install_cmd: cmd })
            }
          }

          const installed = results.filter((r) => r.status === "installed")
          const missing = results.filter((r) => r.status === "missing")
          const justInstalled = results.filter((r) => r.status === "installed_now")
          const failed = results.filter((r) => r.status === "install_failed")

          const lines: string[] = []
          lines.push(`Platform: ${platform}`)
          lines.push(`Package managers: ${[hasApt && "apt", hasBrew && "brew", hasGo && "go", hasPip && "pip", hasPipx && "pipx"].filter(Boolean).join(", ") || "none detected"}`)
          lines.push("")

          if (installed.length) {
            lines.push(`[+] Installed (${installed.length}): ${installed.map((r) => r.name).join(", ")}`)
          }
          if (justInstalled.length) {
            lines.push(
              `[+] Just installed (${justInstalled.length}): ${justInstalled.map((r) => `${r.name} (${r.install_cmd})`).join(", ")}`,
            )
          }
          if (missing.length) {
            lines.push(`[-] Missing (${missing.length}):`)
            for (const r of missing) {
              lines.push(`  ${r.name}: ${r.install_cmd ?? "no installer available"}`)
            }
          }
          if (failed.length) {
            lines.push(`[!] Install failed (${failed.length}): ${failed.map((r) => r.name).join(", ")}`)
          }

          return {
            title: `${params.action}: ${results.length} tools`,
            metadata: {
              installed: installed.length + justInstalled.length,
              missing: missing.length,
              failed: failed.length,
              platform,
            },
            output: lines.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
