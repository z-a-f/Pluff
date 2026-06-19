import { idWithPrefix } from "./encoding.js";
import type { AgentMessage, AgentMessageKind, JsonObject } from "./types.js";

export function createAgentMessage(
  kind: AgentMessageKind,
  body: JsonObject,
  options: { id?: string; createdAt?: string; replyTo?: string; threadId?: string } = {},
): AgentMessage {
  return {
    id: options.id ?? idWithPrefix("msg"),
    kind,
    createdAt: options.createdAt ?? new Date().toISOString(),
    body,
    replyTo: options.replyTo,
    threadId: options.threadId,
  };
}

const ALLOWED_KINDS = new Set<AgentMessageKind>([
  "task",
  "status",
  "tool_request",
  "tool_result",
  "note",
]);

export function assertAgentMessage(value: AgentMessage): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid agent message");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Invalid agent message: id");
  }
  if (!ALLOWED_KINDS.has(value.kind)) {
    throw new Error("Invalid agent message: kind");
  }
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) {
    throw new Error("Invalid agent message: createdAt");
  }
  if (!value.body || typeof value.body !== "object" || Array.isArray(value.body)) {
    throw new Error("Invalid agent message: body");
  }
  if (value.replyTo !== undefined && typeof value.replyTo !== "string") {
    throw new Error("Invalid agent message: replyTo");
  }
  if (value.threadId !== undefined && typeof value.threadId !== "string") {
    throw new Error("Invalid agent message: threadId");
  }
}

