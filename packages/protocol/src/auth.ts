import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalJson,
  randomBytes,
  utf8ToBytes,
} from "./encoding.js";
import type { JsonValue, LocalIdentity, PublicIdentity } from "./types.js";

export interface RelayAuthHeaders {
  "x-pluff-did": string;
  "x-pluff-timestamp": string;
  "x-pluff-nonce": string;
  "x-pluff-signature": string;
}

export interface RelayAuthVerification {
  did: string;
  timestamp: string;
  nonce: string;
}

export function bodyToAuthString(body: JsonValue | string | undefined): string {
  if (body === undefined) {
    return "";
  }
  return typeof body === "string" ? body : canonicalJson(body);
}

export function relayAuthPayload(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}): Uint8Array {
  const bodyHash = bytesToBase64Url(sha256(utf8ToBytes(input.body)));
  return utf8ToBytes(
    [
      "pluff.relay-request.v1",
      input.method.toUpperCase(),
      input.path,
      input.timestamp,
      input.nonce,
      bodyHash,
    ].join("\n"),
  );
}

export function signRelayRequest(input: {
  identity: LocalIdentity;
  method: string;
  path: string;
  body?: JsonValue | string;
  timestamp?: string;
  nonce?: string;
}): RelayAuthHeaders {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const nonce = input.nonce ?? bytesToBase64Url(randomBytes(16));
  const body = bodyToAuthString(input.body);
  const payload = relayAuthPayload({
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    body,
  });
  return {
    "x-pluff-did": input.identity.did,
    "x-pluff-timestamp": timestamp,
    "x-pluff-nonce": nonce,
    "x-pluff-signature": bytesToBase64Url(
      ed25519.sign(payload, base64UrlToBytes(input.identity.private.signingSecretKey)),
    ),
  };
}

export function verifyRelayRequest(input: {
  identity: PublicIdentity;
  method: string;
  path: string;
  body?: JsonValue | string;
  headers: Record<string, string | string[] | undefined>;
  maxClockSkewMs?: number;
  now?: Date;
}): RelayAuthVerification {
  const didHeader = singleHeader(input.headers["x-pluff-did"]);
  const timestamp = singleHeader(input.headers["x-pluff-timestamp"]);
  const nonce = singleHeader(input.headers["x-pluff-nonce"]);
  const signature = singleHeader(input.headers["x-pluff-signature"]);

  if (!didHeader || !timestamp || !nonce || !signature) {
    throw new Error("Missing relay auth headers");
  }
  if (didHeader !== input.identity.did) {
    throw new Error("Relay auth DID does not match identity");
  }

  const signedAt = new Date(timestamp);
  if (Number.isNaN(signedAt.getTime())) {
    throw new Error("Invalid relay auth timestamp");
  }

  const skewMs = Math.abs((input.now ?? new Date()).getTime() - signedAt.getTime());
  const maxClockSkewMs = input.maxClockSkewMs ?? 5 * 60 * 1000;
  if (skewMs > maxClockSkewMs) {
    throw new Error("Relay auth timestamp is outside the allowed skew");
  }

  const body = bodyToAuthString(input.body);
  const payload = relayAuthPayload({
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    body,
  });
  const valid = ed25519.verify(
    base64UrlToBytes(signature),
    payload,
    base64UrlToBytes(input.identity.signingPublicKey),
  );
  if (!valid) {
    throw new Error("Invalid relay auth signature");
  }

  return { did: didHeader, timestamp, nonce };
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

