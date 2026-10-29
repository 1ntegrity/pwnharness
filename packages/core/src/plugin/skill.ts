/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeHarnessContent from "./skill/customize-pwnharness.md" with { type: "text" }

export const CustomizeHarnessContent = customizeHarnessContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-pwnharness",
            description:
              "Use ONLY when the user is editing or creating pwnharness's own configuration: pwnharness.json, pwnharness.jsonc, files under .pwnharness/, or files under ~/.config/pwnharness/. Also use when creating or fixing pwnharness agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring pwnharness itself.",
            location: AbsolutePath.make("/builtin/customize-pwnharness.md"),
            content: CustomizeHarnessContent,
          }),
        }),
      )
    })
  }),
})
