export * as WorkspaceV2 from "./workspace"

import { Workspace } from "@pwnharness/schema/workspace"

export const ID = Workspace.ID
export type ID = typeof ID.Type
