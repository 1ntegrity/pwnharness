/**
 * PwnHarness bridge for omp (oh-my-pi).
 *
 * NOTE: this file is near-identical to pentest-bridge.ts by design. omp loads each
 * bridge standalone, so neither may import from the other (or from @pwnharness/*);
 * do not "DRY" this duplication into a shared import or loading will break.
 *
 * Turns omp into a front-end for a local pwnharness harness server: the omp model
 * calls the `harness` tool; the pwnharness engine executes with its own sessions,
 * tools, and agents. HTTP contract is identical to the pi bridge
 * (integrations/pi/harness-bridge.ts) — only the extension API differs.
 *
 * Requires the harness server: `bun run dev serve --port 4097` or the provided
 * systemd unit. Base URL override: HARNESS_URL env var.
 */

// ---- omp extension surface used by this bridge (self-contained: the repo does
// ---- not depend on @oh-my-pi/pi-coding-agent, and jiti erases types anyway) ----

/** Chainable zod node from pi.zod (omptype-backed Zod shim); builders return Z. */
interface Z {
    describe: (d: string) => Z;
    optional: () => Z;
    safeParse: (data: unknown) => unknown;
}
interface ZodLike {
    object: (shape: Record<string, Z>) => Z;
    string: () => Z;
    number: () => Z;
    literal: (v: string) => Z;
    union: (parts: Z[]) => Z;
    array: (el: Z) => Z;
    record: (v: Z) => Z;
    unknown: () => Z;
}

interface ToolUpdateSink {
    (partial: { content: { type: "text"; text: string }[]; details: unknown }): Promise<void> | void;
}

interface RegisteredOmp {
    zod: ZodLike;
    registerTool(tool: {
        name: string;
        label: string;
        description: string;
        parameters: Z;
        execute: (
            toolCallId: string,
            params: {
                action: "run" | "list";
                prompt?: string;
                sessionID?: string;
                agent?: string;
                timeoutMs?: number;
                engagement?: string;
            },
            signal: AbortSignal | undefined,
            onUpdate: ToolUpdateSink | undefined,
        ) => Promise<{
            content: { type: "text"; text: string }[];
            details: unknown;
            isError?: boolean;
        }>;
    }): void;
}

/** Resolve the harness base URL, auto-launching the engine via `pwnctl ensure-up` when available. */
export function resolveBase(engagement?: string): string {
    try {
        // Omit --engagement entirely when unset so the CLI resolves the current engagement
        // (set by `engage start`) instead of defaulting to a separate "default" engagement.
        const cmd = ["pwnctl", "ensure-up", ...(engagement ? ["--engagement", engagement] : [])];
        const result = Bun.spawnSync(cmd, {
            env: process.env,
        });
        const stdout = result.stdout.toString().trim();
        if (result.success && stdout) return stdout;
    } catch {
        // pwnctl not on PATH (or failed to spawn) — fall back to the configured/default base below.
    }
    return process.env.HARNESS_URL || "http://127.0.0.1:4097";
}

// ---- harness HTTP API contracts (typed at the boundary) ----

interface CreatedSession {
    id: string;
}

interface SessionSummary {
    id: string;
    title?: string;
    time?: { created?: number };
}

interface HarnessMessage {
    info: { role?: string; time?: { completed?: number } };
    parts: { type: string; text?: string; state?: { status?: string } }[];
}

/** Decode a harness API payload against `schema`, falling back when the shape does not match. */
function parseBoundary<T>(schema: Z, data: unknown, fallback: T): T {
    const res = schema.safeParse(data);
    if (res && typeof res === "object" && "success" in res && res.success === true && "data" in res) {
        // The schema is built from T's shape at the call site; omptype's data cannot be
        // tied to T statically through the local Z interface — single boundary cast.
        const decoded = res.data as T;
        return decoded;
    }
    return fallback;
}

async function call(base: string, path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(base + path, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
        throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = await res.text();
    return body ? JSON.parse(body) : null;
}

function assistantText(messages: HarnessMessage[]): string {
    const out: string[] = [];
    for (const m of messages) {
        if (m.info.role !== "assistant") continue;
        for (const p of m.parts) {
            if (p.type === "text" && p.text !== undefined) out.push(p.text);
        }
    }
    return out.join("\n").trim();
}

/** Session ids whose status entry is anything other than "idle" (or has no type). */
function busySessionIds(statusMap: unknown): Set<string> {
    const busy = new Set<string>();
    if (statusMap === null || typeof statusMap !== "object" || Array.isArray(statusMap)) return busy;
    for (const [sid, status] of Object.entries(statusMap)) {
        let idle = false;
        if (status === "idle") idle = true;
        else if (typeof status === "object" && status !== null && "type" in status && status.type === "idle") idle = true;
        if (!idle) busy.add(sid);
    }
    return busy;
}

function turnDone(messages: HarnessMessage[], sid: string, busy: Set<string>): boolean {
    const last = messages[messages.length - 1];
    if (!last || last.info.role !== "assistant") return false;
    if (last.info.time?.completed === undefined) return false;
    for (const p of last.parts) {
        if (p.type === "tool" && p.state?.status === "running") return false;
    }
    return !busy.has(sid);
}

export default function harnessBridge(pi: RegisteredOmp) {
    const z = pi.zod;

    const CreatedSessionSchema = z.object({ id: z.string() });

    const SessionSummariesSchema = z.array(
        z.object({
            id: z.string(),
            title: z.string().optional(),
            time: z.object({ created: z.number().optional() }).optional(),
        }),
    );

    const MessagesSchema = z.array(
        z.object({
            info: z.object({
                role: z.string().optional(),
                time: z.object({ completed: z.number().optional() }).optional(),
            }),
            parts: z.array(
                z.object({
                    type: z.string(),
                    text: z.string().optional(),
                    state: z.object({ status: z.string().optional() }).optional(),
                }),
            ),
        }),
    );

    pi.registerTool({
        name: "harness",
        label: "PwnHarness Harness",
        description:
            "Delegate a task to a local pwnharness coding agent (own sessions, tools: read/edit/shell/grep/task, agents build/plan). " +
            "Returns the harness agent's final answer and the sessionID. Pass sessionID back to continue the same session with full context.",
        parameters: z.object({
            action: z.union([z.literal("run"), z.literal("list")]).describe(
                "run: create/continue a harness session with a prompt; list: list harness sessions",
            ),
            prompt: z.string().describe("Task for the harness agent (action=run)").optional(),
            sessionID: z
                .string()
                .describe("Existing harness session to continue (action=run). Omit to start a new one.")
                .optional(),
            agent: z.string().describe("Harness agent id (default: build; plan for read-only planning)").optional(),
            timeoutMs: z.number().describe("Max wait in ms, default 600000 (10 min)").optional(),
            engagement: z.string().describe("Engagement slug used to auto-launch the right engine (default: the current engagement set by `engage start`, or \"default\")").optional(),
        }),
        async execute(_toolCallId, params, signal, onUpdate) {
            const base = resolveBase(params.engagement);
            try {
                if (params.action === "list") {
                    const sessions: SessionSummary[] = parseBoundary(SessionSummariesSchema, await call(base, "/session"), []);
                    const lines = sessions.slice(0, 30).map((s) => `${s.id}  ${s.title ?? ""}  (${s.time?.created ?? ""})`);
                    return {
                        content: [{ type: "text", text: lines.length ? lines.join("\n") : "(no harness sessions)" }],
                        details: { count: lines.length },
                    };
                }

                const prompt = (params.prompt ?? "").trim();
                if (!prompt) {
                    return { content: [{ type: "text", text: "error: `prompt` is required for action=run" }], details: {}, isError: true };
                }

                let sid = params.sessionID;
                if (sid) {
                    await call(base, `/session/${encodeURIComponent(sid)}`, { method: "GET" });
                } else {
                    const created = parseBoundary<CreatedSession | null>(
                        CreatedSessionSchema,
                        await call(base, "/session", { method: "POST", body: "{}" }),
                        null,
                    );
                    if (!created) throw new Error("session create returned no id");
                    sid = created.id;
                }

                const body: Record<string, unknown> = { parts: [{ type: "text", text: prompt }] };
                if (params.agent) body.agent = params.agent;
                await call(base, `/session/${encodeURIComponent(sid)}/prompt_async`, { method: "POST", body: JSON.stringify(body) });

                const deadline = Date.now() + (params.timeoutMs ?? 600_000);
                let waited = 0;
                for (;;) {
                    if (Date.now() >= deadline) break;
                    if (signal?.aborted) {
                        await call(base, `/session/${encodeURIComponent(sid)}/abort`, { method: "POST" }).catch(() => {});
                        return { content: [{ type: "text", text: `aborted (session ${sid} kept)` }], details: { sessionID: sid } };
                    }
                    const { promise: tick, resolve: tickDone } = Promise.withResolvers<void>();
                    setTimeout(tickDone, 1500);
                    await tick;
                    waited += 1500;
                    const messages: HarnessMessage[] = parseBoundary(
                        MessagesSchema,
                        await call(base, `/session/${encodeURIComponent(sid)}/message`),
                        [],
                    );
                    if (turnDone(messages, sid, busySessionIds(await call(base, "/session/status")))) {
                        const answer = assistantText(messages);
                        return {
                            content: [{ type: "text", text: `harness session ${sid}\n\n${answer || "(no text output)"}` }],
                            details: { sessionID: sid },
                        };
                    }
                    if (onUpdate && waited % 15000 === 0) {
                        const last = messages[messages.length - 1];
                        const preview =
                            last?.parts
                                ?.filter((p) => p.text !== undefined)
                                .map((p) => p.text)
                                .join(" ")
                                .slice(0, 120) ?? last?.info.role ?? "...";
                        await onUpdate({ content: [{ type: "text", text: `waiting for harness (${Math.round(waited / 1000)}s): ${preview}` }], details: {} });
                    }
                }
                // timeoutMs is only the front-end's patience, not a server-side stop. Without this
                // abort the engine keeps running the turn invisibly after we give up — burning the
                // engagement budget and racing whatever the caller does next. Abort the active turn
                // so the run actually stops; the session is kept so the caller can resume it.
                const aborted = await call(base, `/session/${encodeURIComponent(sid)}/abort`, { method: "POST" })
                    .then(() => true)
                    .catch(() => false);
                const messages: HarnessMessage[] = parseBoundary(
                    MessagesSchema,
                    await call(base, `/session/${encodeURIComponent(sid)}/message`),
                    [],
                );
                return {
                    content: [
                        {
                            type: "text",
                            text: `TIMEOUT after ${params.timeoutMs ?? 600000}ms — ${aborted ? "aborted the harness run" : "abort request failed, the run may still be active"}; session ${sid} kept (resume by passing sessionID). Partial transcript:\n\n${assistantText(messages).slice(0, 4000)}`,
                        },
                    ],
                    details: { sessionID: sid, timeout: true, aborted },
                    isError: true,
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `harness bridge error: ${e instanceof Error ? e.message : String(e)}\n(is the server running? pwnharness serve --port 4097)`,
                        },
                    ],
                    details: {},
                    isError: true,
                };
            }
        },
    });
}
