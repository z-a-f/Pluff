import { describe, expect, it } from "vitest";
import {
  createAgentMessage,
  encryptAgentMessage,
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  publicIdentity,
  type PreKeyClaim,
} from "@pluff/protocol";
import { MemoryRelayStore } from "../src/store.js";

describe("relay privacy boundary", () => {
  it("stores encrypted envelopes without plaintext agent payloads", async () => {
    const store = new MemoryRelayStore();
    const alice = generateIdentity("agent");
    const bob = generateIdentity("agent");
    const bobSignedPreKey = generateSignedPreKey(bob);
    const bobOneTimePreKey = generateOneTimePreKey(bob);
    await store.upsertBundle({
      identity: publicIdentity(bob),
      signedPreKey: bobSignedPreKey.publicKey,
      oneTimePreKeys: [bobOneTimePreKey.publicKey],
    });

    const claim = await store.claimPreKey(bob.did);
    if (!claim) {
      throw new Error("Expected prekey claim");
    }
    const envelope = await encryptAgentMessage({
      sender: alice,
      recipient: claim,
      message: createAgentMessage("task", {
        goal: "rotate the audit token",
        secretMarker: "relay-must-not-store-this",
      }),
    });

    await store.insertEnvelope(envelope);

    const snapshot = JSON.stringify(store.snapshot().envelopes);
    expect(snapshot).not.toContain("rotate the audit token");
    expect(snapshot).not.toContain("relay-must-not-store-this");
    expect(snapshot).toContain(envelope.ciphertext);
  });

  it("claims a one-time prekey only once", async () => {
    const store = new MemoryRelayStore();
    const bob = generateIdentity("agent");
    const bobSignedPreKey = generateSignedPreKey(bob);
    const bobOneTimePreKey = generateOneTimePreKey(bob);
    await store.upsertBundle({
      identity: publicIdentity(bob),
      signedPreKey: bobSignedPreKey.publicKey,
      oneTimePreKeys: [bobOneTimePreKey.publicKey],
    });

    const first = await store.claimPreKey(bob.did) as PreKeyClaim;
    const second = await store.claimPreKey(bob.did) as PreKeyClaim;

    expect(first.oneTimePreKey?.id).toBe(bobOneTimePreKey.publicKey.id);
    expect(second.oneTimePreKey).toBeUndefined();
    expect(second.signedPreKey.id).toBe(bobSignedPreKey.publicKey.id);
  });
});

