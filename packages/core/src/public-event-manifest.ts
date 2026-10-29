export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@pwnharness/schema/event"
import { EventManifest } from "@pwnharness/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
