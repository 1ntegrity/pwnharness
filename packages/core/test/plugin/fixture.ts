import { AgentV2 } from "@opencode-harness/core/agent"
import { AISDK } from "@opencode-harness/core/aisdk"
import { Catalog } from "@opencode-harness/core/catalog"
import { CommandV2 } from "@opencode-harness/core/command"
import { Credential } from "@opencode-harness/core/credential"
import { AppNodeBuilder } from "@opencode-harness/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-harness/core/effect/app-node-platform"
import { LayerNode } from "@opencode-harness/core/effect/layer-node"
import { EventV2 } from "@opencode-harness/core/event"
import { FileSystem } from "@opencode-harness/core/filesystem"
import { FSUtil } from "@opencode-harness/core/fs-util"
import { Integration } from "@opencode-harness/core/integration"
import { Location } from "@opencode-harness/core/location"
import { Npm } from "@opencode-harness/core/npm"
import { PluginV2 } from "@opencode-harness/core/plugin"
import { Reference } from "@opencode-harness/core/reference"
import { SkillV2 } from "@opencode-harness/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
