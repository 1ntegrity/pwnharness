import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@pwnharness/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~pwnharness/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~pwnharness/WorkspaceRef", {
  defaultValue: () => undefined,
})
