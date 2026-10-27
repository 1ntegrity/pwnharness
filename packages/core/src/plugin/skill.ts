/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeHarnessContent from "./skill/customize-pwncode.md" with { type: "text" }

export const CustomizeHarnessContent = customizeHarnessContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-pwncode",
            description:
              "Use ONLY when the user is editing or creating pwncode's own configuration: pwncode.json, pwncode.jsonc, files under .pwncode/, or files under ~/.config/pwncode/. Also use when creating or fixing pwncode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring pwncode itself.",
            location: AbsolutePath.make("/builtin/customize-pwncode.md"),
            content: CustomizeHarnessContent,
          }),
        }),
      )
    })
  }),
})
