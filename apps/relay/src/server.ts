import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  assertEncryptedEnvelope,
  assertPreKeyBundle,
  verifyRelayRequest,
  type EncryptedEnvelope,
  type PreKeyBundle,
} from "@nonomessage/protocol";
import type { RelayStore } from "./store.js";

const MAX_BODY_BYTES = 1024 * 1024;

export function createRelayServer(store: RelayStore) {
  return createServer(async (request, response) => {
    try {
      await handleRequest(store, request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown relay error";
      sendJson(response, 500, { error: message });
    }
  });
}

async function handleRequest(
  store: RelayStore,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://relay.local");
  const bodyText = await readBody(request);
  const body = bodyText ? JSON.parse(bodyText) : undefined;
  const path = `${url.pathname}${url.search}`;
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/identities") {
    const bundle = body as PreKeyBundle;
    assertPreKeyBundle(bundle);
    await store.upsertBundle(bundle);
    sendJson(response, 201, {
      identity: bundle.identity,
      oneTimePreKeyCount: bundle.oneTimePreKeys.length,
    });
    return;
  }

  if (method === "GET" && parts[0] === "v1" && parts[1] === "identities" && parts[2]) {
    const did = decodeURIComponent(parts[2]);
    const bundle = await store.getBundle(did);
    if (!bundle) {
      sendJson(response, 404, { error: "Identity not found" });
      return;
    }
    if (parts[3] === "bundle") {
      sendJson(response, 200, bundle);
      return;
    }
    sendJson(response, 200, bundle.identity);
    return;
  }

  if (method === "POST" && parts[0] === "v1" && parts[1] === "prekeys" && parts[2] && parts[3] === "claim") {
    const requesterDid = String(body?.requesterDid ?? "");
    await requireAuth(store, request, method, path, bodyText, requesterDid);
    const claim = await store.claimPreKey(decodeURIComponent(parts[2]));
    if (!claim) {
      sendJson(response, 404, { error: "Recipient identity not found" });
      return;
    }
    sendJson(response, 200, claim);
    return;
  }

  if (method === "POST" && url.pathname === "/v1/envelopes") {
    const envelope = body as EncryptedEnvelope;
    assertEncryptedEnvelope(envelope);
    await requireAuth(store, request, method, path, bodyText, envelope.senderDid);
    await store.insertEnvelope(envelope);
    sendJson(response, 201, { id: envelope.id });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/envelopes") {
    const recipientDid = url.searchParams.get("recipientDid") ?? "";
    await requireAuth(store, request, method, path, bodyText, recipientDid);
    sendJson(response, 200, await store.listEnvelopes(recipientDid));
    return;
  }

  if (method === "POST" && parts[0] === "v1" && parts[1] === "envelopes" && parts[2] && parts[3] === "ack") {
    const recipientDid = String(body?.recipientDid ?? "");
    await requireAuth(store, request, method, path, bodyText, recipientDid);
    const record = await store.ackEnvelope(decodeURIComponent(parts[2]), recipientDid);
    if (!record) {
      sendJson(response, 404, { error: "Envelope not found" });
      return;
    }
    sendJson(response, 200, { id: record.id, ackedAt: record.ackedAt });
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
}

async function requireAuth(
  store: RelayStore,
  request: IncomingMessage,
  method: string,
  path: string,
  body: string,
  expectedDid: string,
): Promise<void> {
  if (!expectedDid) {
    throw new Error("Missing expected auth DID");
  }
  const bundle = await store.getBundle(expectedDid);
  if (!bundle) {
    throw new Error("Authenticated DID is not registered");
  }
  verifyRelayRequest({
    identity: bundle.identity,
    method,
    path,
    body,
    headers: request.headers,
  });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

