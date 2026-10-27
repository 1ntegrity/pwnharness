import { AgentV2 } from "@pwncode/core/agent"
import { AISDK } from "@pwncode/core/aisdk"
import { Catalog } from "@pwncode/core/catalog"
import { CommandV2 } from "@pwncode/core/command"
import { Credential } from "@pwncode/core/credential"
import { AppNodeBuilder } from "@pwncode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@pwncode/core/effect/app-node-platform"
import { LayerNode } from "@pwncode/core/effect/layer-node"
import { EventV2 } from "@pwncode/core/event"
import { FileSystem } from "@pwncode/core/filesystem"
import { FSUtil } from "@pwncode/core/fs-util"
import { Integration } from "@pwncode/core/integration"
import { Location } from "@pwncode/core/location"
import { Npm } from "@pwncode/core/npm"
import { PluginV2 } from "@pwncode/core/plugin"
import { Reference } from "@pwncode/core/reference"
import { SkillV2 } from "@pwncode/core/skill"
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
