/**
 * PwnCode bridge for pi.
 *
 * Adds the `harness` tool: delegate work to a local pwncode server
 * (~/dev/pentestcode-harness, `pwncode serve --port 4097`). Each call
 * creates (or continues) a harness session, waits for the agent turn to finish,
 * and returns the final assistant text. Harness sessions keep their own tools
 * (read/edit/shell/grep/...), agents, and skills — pi stays the front end.
 *
 * Env: HARNESS_URL (default http://127.0.0.1:4097)
 */
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const BASE = process.env.HARNESS_URL || "http://127.0.0.1:4097";

// ---- harness HTTP API contracts (parsed once at the boundary) ----

const CreatedSessionSchema = Type.Object({ id: Type.String() });

const SessionSummariesSchema = Type.Array(
    Type.Object({
        id: Type.String(),
        title: Type.Optional(Type.String()),
        time: Type.Optional(Type.Object({ created: Type.Optional(Type.Number()) })),
    }),
);

const MessagesSchema = Type.Array(
    Type.Object({
        info: Type.Object({
            role: Type.Optional(Type.String()),
            time: Type.Optional(Type.Object({ completed: Type.Optional(Type.Number()) })),
        }),
        parts: Type.Array(
            Type.Object({
                type: Type.String(),
                text: Type.Optional(Type.String()),
                state: Type.Optional(Type.Object({ status: Type.Optional(Type.String()) })),
            }),
        ),
    }),
);

const StatusMapSchema = Type.Record(Type.String(), Type.Unknown());

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

interface ToolUpdateSink {
    (partial: { content: { type: "text"; text: string }[]; details: unknown }): Promise<void> | void;
}

interface RegisteredPi {
    registerTool(tool: {
        name: string;
        label: string;
        description: string;
        promptSnippet?: string;
        parameters: unknown;
        execute: (
            toolCallId: string,
            params: { action: "run" | "list"; prompt?: string; sessionID?: string; agent?: string; timeoutMs?: number },
            signal: AbortSignal | undefined,
            onUpdate: ToolUpdateSink | undefined,
        ) => Promise<{
            content: { type: "text"; text: string }[];
            details: unknown;
            structuredContent?: unknown;
            isError?: boolean;
        }>;
    }): void;
}

/** Decode a harness API payload against `schema`, falling back when the shape does not match. */
function parse<S extends TSchema>(schema: S, data: unknown, fallback: Static<S>): Static<S> {
    if (!Value.Check(schema, data)) return fallback;
    // Decode's return type cannot express Static<S> for a generic schema — the cast is sound after Check.
    return Value.Decode(schema, data) as Static<S>;
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(BASE + path, {
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
    const parsed = parse(StatusMapSchema, statusMap, {});
    const busy = new Set<string>();
    for (const [sid, status] of Object.entries(parsed)) {
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

export default function harnessBridge(pi: RegisteredPi) {
    pi.registerTool({
        name: "harness",
        label: "PwnCode",
        description:
            "Delegate a task to a local pwncode coding agent (own sessions, tools: read/edit/shell/grep/task, agents build/plan). " +
            "Returns the harness agent's final answer and the sessionID. Pass sessionID back to continue the same session with full context.",
        promptSnippet: "delegate coding tasks to the local pwncode agent",
        parameters: Type.Object({
            action: Type.Union([Type.Literal("run"), Type.Literal("list")], {
                description: "run: create/continue a harness session with a prompt; list: list harness sessions",
            }),
            prompt: Type.Optional(Type.String({ description: "Task for the harness agent (action=run)" })),
            sessionID: Type.Optional(
                Type.String({ description: "Existing harness session to continue (action=run). Omit to start a new one." }),
            ),
            agent: Type.Optional(Type.String({ description: "Harness agent id (default: build; plan for read-only planning)" })),
            timeoutMs: Type.Optional(Type.Number({ description: "Max wait in ms, default 600000 (10 min)" })),
        }),
        async execute(_toolCallId, params, signal, onUpdate) {
            try {
                if (params.action === "list") {
                    const sessions: SessionSummary[] = parse(SessionSummariesSchema, await call("/session"), []);
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
                    await call(`/session/${encodeURIComponent(sid)}`, { method: "GET" });
                } else {
                    const created: CreatedSession | null = parse(CreatedSessionSchema, await call("/session", { method: "POST", body: "{}" }), null);
                    if (!created) throw new Error("session create returned no id");
                    sid = created.id;
                }

                const body: Record<string, unknown> = { parts: [{ type: "text", text: prompt }] };
                if (params.agent) body.agent = params.agent;
                await call(`/session/${encodeURIComponent(sid)}/prompt_async`, { method: "POST", body: JSON.stringify(body) });

                const deadline = Date.now() + (params.timeoutMs ?? 600_000);
                let waited = 0;
                for (;;) {
                    if (Date.now() >= deadline) break;
                    if (signal?.aborted) {
                        await call(`/session/${encodeURIComponent(sid)}/abort`, { method: "POST" }).catch(() => {});
                        return { content: [{ type: "text", text: `aborted (session ${sid} kept)` }], details: { sessionID: sid } };
                    }
                    const { promise: tick, resolve: tickDone } = Promise.withResolvers<void>();
                    setTimeout(tickDone, 1500);
                    await tick;
                    waited += 1500;
                    const messages: HarnessMessage[] = parse(MessagesSchema, await call(`/session/${encodeURIComponent(sid)}/message`), []);
                    if (turnDone(messages, sid, busySessionIds(await call("/session/status")))) {
                        const answer = assistantText(messages);
                        return {
                            content: [{ type: "text", text: `harness session ${sid}\n\n${answer || "(no text output)"}` }],
                            details: { sessionID: sid },
                            structuredContent: { sessionID: sid, text: answer },
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
                const messages: HarnessMessage[] = parse(MessagesSchema, await call(`/session/${encodeURIComponent(sid)}/message`), []);
                return {
                    content: [
                        {
                            type: "text",
                            text: `TIMEOUT after ${params.timeoutMs ?? 600000}ms — partial transcript from harness session ${sid}:\n\n${assistantText(messages).slice(0, 4000)}`,
                        },
                    ],
                    details: { sessionID: sid, timeout: true },
                    isError: true,
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `harness bridge error: ${e instanceof Error ? e.message : String(e)}\n(is the server running? pwncode serve --port 4097)`,
                        },
                    ],
                    details: {},
                    isError: true,
                };
            }
        },
    });
}
