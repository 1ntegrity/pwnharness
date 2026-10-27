import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@pwncode/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~pwncode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~pwncode/WorkspaceRef", {
  defaultValue: () => undefined,
})
