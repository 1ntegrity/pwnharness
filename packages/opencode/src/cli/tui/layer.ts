import { run as runTui, type TuiInput } from "@pwncode/tui"
import { Global } from "@pwncode/core/global"
import { AppNodeBuilder } from "@pwncode/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
