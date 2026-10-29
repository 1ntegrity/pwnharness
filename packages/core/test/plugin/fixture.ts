import { AgentV2 } from "@pwnharness/core/agent"
import { AISDK } from "@pwnharness/core/aisdk"
import { Catalog } from "@pwnharness/core/catalog"
import { CommandV2 } from "@pwnharness/core/command"
import { Credential } from "@pwnharness/core/credential"
import { AppNodeBuilder } from "@pwnharness/core/effect/app-node-builder"
import { LayerNodePlatform } from "@pwnharness/core/effect/app-node-platform"
import { LayerNode } from "@pwnharness/core/effect/layer-node"
import { EventV2 } from "@pwnharness/core/event"
import { FileSystem } from "@pwnharness/core/filesystem"
import { FSUtil } from "@pwnharness/core/fs-util"
import { Integration } from "@pwnharness/core/integration"
import { Location } from "@pwnharness/core/location"
import { Npm } from "@pwnharness/core/npm"
import { PluginV2 } from "@pwnharness/core/plugin"
import { Reference } from "@pwnharness/core/reference"
import { SkillV2 } from "@pwnharness/core/skill"
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
