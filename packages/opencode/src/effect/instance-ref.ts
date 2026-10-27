import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@opencode-harness/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~opencode-harness/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~opencode-harness/WorkspaceRef", {
  defaultValue: () => undefined,
})
