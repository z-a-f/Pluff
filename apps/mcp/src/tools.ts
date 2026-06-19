import {
  RelayClient,
  createPreKeyBundle,
  type LocalAccount,
} from "@pluff/client";
import {
  decryptAgentMessage,
  encryptAgentMessage,
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  publicIdentity,
  createAgentMessage,
  type AgentMessageKind,
  type JsonObject,
} from "@pluff/protocol";
import { McpStateStore } from "./state.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const toolDefinitions: McpToolDefinition[] = [
  {
    name: "create_identity",
    description: "Create a local Pluff person or agent identity.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["person", "agent", "service"] },
        label: { type: "string" },
        oneTimePreKeyCount: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["kind"],
    },
  },
  {
    name: "register_identity",
    description: "Publish a local identity public bundle to a relay.",
    inputSchema: {
      type: "object",
      properties: {
        relayUrl: { type: "string" },
        identityDid: { type: "string" },
      },
      required: ["relayUrl", "identityDid"],
    },
  },
  {
    name: "add_contact",
    description: "Resolve a DID through the relay and trust it as a local contact.",
    inputSchema: {
      type: "object",
      properties: {
        relayUrl: { type: "string" },
        ownerDid: { type: "string" },
        contactDid: { type: "string" },
      },
      required: ["relayUrl", "ownerDid", "contactDid"],
    },
  },
  {
    name: "send_agent_message",
    description: "Encrypt and send a structured agent JSON message.",
    inputSchema: {
      type: "object",
      properties: {
        relayUrl: { type: "string" },
        senderDid: { type: "string" },
        recipientDid: { type: "string" },
        kind: {
          type: "string",
          enum: ["task", "status", "tool_request", "tool_result", "note"],
        },
        body: { type: "object" },
      },
      required: ["relayUrl", "senderDid", "recipientDid", "kind", "body"],
    },
  },
  {
    name: "fetch_inbox",
    description: "Fetch and decrypt pending encrypted envelopes for a local identity.",
    inputSchema: {
      type: "object",
      properties: {
        relayUrl: { type: "string" },
        recipientDid: { type: "string" },
        ack: { type: "boolean" },
      },
      required: ["relayUrl", "recipientDid"],
    },
  },
  {
    name: "rotate_prekeys",
    description: "Replace a local signed prekey and replenish one-time prekeys.",
    inputSchema: {
      type: "object",
      properties: {
        identityDid: { type: "string" },
        oneTimePreKeyCount: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["identityDid"],
    },
  },
];

export class PluffTools {
  constructor(private readonly state = new McpStateStore()) {}

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "create_identity":
        return this.createIdentity(args);
      case "register_identity":
        return this.registerIdentity(args);
      case "add_contact":
        return this.addContact(args);
      case "send_agent_message":
        return this.sendAgentMessage(args);
      case "fetch_inbox":
        return this.fetchInbox(args);
      case "rotate_prekeys":
        return this.rotatePreKeys(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async createIdentity(args: Record<string, unknown>): Promise<unknown> {
    const kind = stringArg(args, "kind") as "person" | "agent" | "service";
    const label = optionalStringArg(args, "label");
    const oneTimePreKeyCount = numberArg(args, "oneTimePreKeyCount", 10);
    const identity = generateIdentity(kind, { label });
    const signedPreKey = generateSignedPreKey(identity);
    const oneTimePreKeys = Array.from({ length: oneTimePreKeyCount }, () =>
      generateOneTimePreKey(identity),
    );
    const account: LocalAccount = {
      identity,
      signedPreKey,
      oneTimePreKeys,
      contacts: {},
      processedEnvelopeIds: [],
    };
    await this.state.saveAccount(account);
    return {
      identity: publicIdentity(identity),
      signedPreKeyId: signedPreKey.publicKey.id,
      oneTimePreKeyCount,
    };
  }

  private async registerIdentity(args: Record<string, unknown>): Promise<unknown> {
    const relay = new RelayClient({ baseUrl: stringArg(args, "relayUrl") });
    const account = await this.state.getAccount(stringArg(args, "identityDid"));
    return relay.registerBundle(createPreKeyBundle(account));
  }

  private async addContact(args: Record<string, unknown>): Promise<unknown> {
    const relay = new RelayClient({ baseUrl: stringArg(args, "relayUrl") });
    const ownerDid = stringArg(args, "ownerDid");
    const contact = await relay.resolveIdentity(stringArg(args, "contactDid"));
    await this.state.addContact(ownerDid, contact);
    return { contact };
  }

  private async sendAgentMessage(args: Record<string, unknown>): Promise<unknown> {
    const relay = new RelayClient({ baseUrl: stringArg(args, "relayUrl") });
    const sender = await this.state.getAccount(stringArg(args, "senderDid"));
    const recipientDid = stringArg(args, "recipientDid");
    const claim = await relay.claimPreKey(recipientDid, sender.identity);
    const message = createAgentMessage(
      stringArg(args, "kind") as AgentMessageKind,
      objectArg(args, "body"),
    );
    const envelope = await encryptAgentMessage({
      sender: sender.identity,
      recipient: claim,
      message,
    });
    await relay.submitEnvelope(envelope, sender.identity);
    return {
      envelopeId: envelope.id,
      messageId: message.id,
      recipientDid,
      usedOneTimePreKey: Boolean(claim.oneTimePreKey),
    };
  }

  private async fetchInbox(args: Record<string, unknown>): Promise<unknown> {
    const relay = new RelayClient({ baseUrl: stringArg(args, "relayUrl") });
    const account = await this.state.getAccount(stringArg(args, "recipientDid"));
    const ack = booleanArg(args, "ack", true);
    const records = await relay.listEnvelopes(account.identity.did, account.identity);
    const processed = new Set(account.processedEnvelopeIds ?? []);
    const messages = [];

    for (const record of records) {
      // Skip an envelope we have already decrypted; a relay that ignores acks
      // could redeliver it. Re-ack so it stops coming back.
      if (processed.has(record.id)) {
        if (ack) {
          await relay.ackEnvelope(record.id, account.identity);
        }
        continue;
      }
      const senderIdentity =
        account.contacts[record.senderDid] ?? await relay.resolveIdentity(record.senderDid);
      const oneTimePreKey = account.oneTimePreKeys.find(
        (key) => key.publicKey.id === record.envelope.preKeyIds.oneTimePreKeyId,
      );
      const message = await decryptAgentMessage(record.envelope, {
        identity: account.identity,
        signedPreKey: account.signedPreKey,
        oneTimePreKey,
        senderIdentity,
      });
      processed.add(record.id);
      messages.push({
        envelopeId: record.id,
        senderDid: record.senderDid,
        receivedAt: record.createdAt,
        message,
      });
      if (ack) {
        await relay.ackEnvelope(record.id, account.identity);
      }
    }

    account.processedEnvelopeIds = [...processed];
    await this.state.saveAccount(account);

    return { messages };
  }

  private async rotatePreKeys(args: Record<string, unknown>): Promise<unknown> {
    const account = await this.state.getAccount(stringArg(args, "identityDid"));
    const oneTimePreKeyCount = numberArg(args, "oneTimePreKeyCount", 10);
    account.signedPreKey = generateSignedPreKey(account.identity);
    account.oneTimePreKeys = Array.from({ length: oneTimePreKeyCount }, () =>
      generateOneTimePreKey(account.identity),
    );
    await this.state.saveAccount(account);
    return {
      identityDid: account.identity.did,
      signedPreKeyId: account.signedPreKey.publicKey.id,
      oneTimePreKeyCount,
    };
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing string argument: ${key}`);
  }
  return value;
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected string argument: ${key}`);
  }
  return value;
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`Expected integer argument between 0 and 100: ${key}`);
  }
  return value;
}

function booleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key] ?? fallback;
  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean argument: ${key}`);
  }
  return value;
}

function objectArg(args: Record<string, unknown>, key: string): JsonObject {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object argument: ${key}`);
  }
  return value as JsonObject;
}

