export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@pwncode/schema/event"
import { EventManifest } from "@pwncode/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
