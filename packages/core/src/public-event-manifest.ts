export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@opencode-harness/schema/event"
import { EventManifest } from "@opencode-harness/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
