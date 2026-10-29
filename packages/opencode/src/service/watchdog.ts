import { listEngagements } from "./engagement"
import { stop } from "./manager"

export function idleWindowMs(): number {
  return Number(process.env.PWNCTL_IDLE_MS) || 4 * 60 * 60 * 1000
}

export async function sweep(now = Date.now()): Promise<string[]> {
  const window = idleWindowMs()
  const idle = (await listEngagements()).filter((e) => e.status === "running" && now - e.last_activity > window)
  const stopped: string[] = []
  // Isolate each stop: one failure must not abort the sweep or (in --daemon mode) kill the loop.
  for (const e of idle) {
    const ok = await stop(e.slug)
      .then(() => true)
      .catch((err) => {
        console.error(`watchdog: failed to stop "${e.slug}": ${err instanceof Error ? err.message : String(err)}`)
        return false
      })
    if (ok) stopped.push(e.slug)
  }
  return stopped
}
