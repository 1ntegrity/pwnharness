/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeHarnessContent from "./skill/customize-opencode-harness.md" with { type: "text" }

export const CustomizeHarnessContent = customizeHarnessContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-opencode-harness",
            description:
              "Use ONLY when the user is editing or creating opencode-harness's own configuration: opencode-harness.json, opencode-harness.jsonc, files under .opencode-harness/, or files under ~/.config/opencode-harness/. Also use when creating or fixing opencode-harness agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode-harness itself.",
            location: AbsolutePath.make("/builtin/customize-opencode-harness.md"),
            content: CustomizeHarnessContent,
          }),
        }),
      )
    })
  }),
})
