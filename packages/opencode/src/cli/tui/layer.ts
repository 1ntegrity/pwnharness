import { run as runTui, type TuiInput } from "@opencode-harness/tui"
import { Global } from "@opencode-harness/core/global"
import { AppNodeBuilder } from "@opencode-harness/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
