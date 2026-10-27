import { expect, test } from "bun:test"
import { Schema } from "effect"
import { AgentV2 } from "@opencode-harness/core/agent"
import { Location as CoreLocation } from "@opencode-harness/core/location"
import { ModelV2 } from "@opencode-harness/core/model"
import { SessionV2 } from "@opencode-harness/core/session"
import { SessionInput as CoreSessionInput } from "@opencode-harness/core/session/input"
import { SessionMessage as CoreSessionMessage } from "@opencode-harness/core/session/message"
import { Prompt as CorePrompt } from "@opencode-harness/core/session/prompt"
import { Agent } from "@opencode-harness/schema/agent"
import { Location } from "@opencode-harness/schema/location"
import { Model } from "@opencode-harness/schema/model"
import { Project } from "@opencode-harness/schema/project"
import { Provider } from "@opencode-harness/schema/provider"
import { Prompt } from "@opencode-harness/schema/prompt"
import { Session } from "@opencode-harness/schema/session"
import { SessionInput } from "@opencode-harness/schema/session-input"
import { SessionMessage } from "@opencode-harness/schema/session-message"
import { Workspace } from "@opencode-harness/schema/workspace"
import { Api } from "@opencode-harness/server/api"
import { compile, emitPromise } from "@opencode-harness/httpapi-codegen"
import { ClientApi, endpointNames, groupNames, omitEndpoints } from "../src/contract"

test("Core and Server reuse the authoritative Schema and Protocol values", () => {
  expect(AgentV2.ID).toBe(Agent.ID)
  expect(CoreLocation.Ref).toBe(Location.Ref)
  expect(ModelV2.Ref).toBe(Model.Ref)
  expect(SessionV2.Info).toBe(Session.Info)
  expect(CoreSessionInput.Admitted).toBe(SessionInput.Admitted)
  expect(CoreSessionMessage.Message).toBe(SessionMessage.Message)
  expect(CorePrompt).toBe(Prompt)
  expect(Api.groups["server.session"].identifier).toBe("server.session")
  expect(Object.keys(ClientApi.groups)).toEqual(Object.keys(Api.groups))
  expect(Session.ID.create()).toStartWith("ses_")
  expect(Project.ID.global).toBe("global")
  expect(Provider.ID.anthropic).toBe("anthropic")
  expect(Workspace.ID.create()).toStartWith("wrk_")
})

test("client and Server contracts generate identically", () => {
  const server = compile(Api, { groupNames, endpointNames, omitEndpoints })
  const client = compile(ClientApi, { groupNames, endpointNames, omitEndpoints })

  expect(emitPromise(client)).toEqual(emitPromise(server))
})

test("shared DTO schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
  expect(CoreSessionMessage.AssistantText).toBe(SessionMessage.AssistantText)
})
