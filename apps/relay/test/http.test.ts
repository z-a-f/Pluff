import { afterEach, describe, expect, it } from "vitest";
import { type AddressInfo } from "node:net";
import { createPreKeyBundle, RelayClient } from "@pluff/client";
import {
  createAgentMessage,
  decryptAgentMessage,
  encryptAgentMessage,
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  publicIdentity,
} from "@pluff/protocol";
import { createRelayServer } from "../src/server.js";
import { MemoryRelayStore } from "../src/store.js";

describe("relay HTTP API", () => {
  const servers: ReturnType<typeof createRelayServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it("relays an encrypted direct agent message through signed requests", async () => {
    const server = createRelayServer(new MemoryRelayStore());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const relay = new RelayClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const alice = generateIdentity("agent", { label: "alice" });
    const aliceSignedPreKey = generateSignedPreKey(alice);
    const bob = generateIdentity("agent", { label: "bob" });
    const bobSignedPreKey = generateSignedPreKey(bob);
    const bobOneTimePreKey = generateOneTimePreKey(bob);

    await relay.registerBundle(
      createPreKeyBundle({
        identity: alice,
        signedPreKey: aliceSignedPreKey,
        oneTimePreKeys: [],
      }),
    );
    await relay.registerBundle(
      createPreKeyBundle({
        identity: bob,
        signedPreKey: bobSignedPreKey,
        oneTimePreKeys: [bobOneTimePreKey],
      }),
    );

    const claim = await relay.claimPreKey(bob.did, alice);
    const message = createAgentMessage("task", {
      goal: "verify signed relay transport",
    });
    const envelope = await encryptAgentMessage({
      sender: alice,
      recipient: claim,
      message,
    });
    await relay.submitEnvelope(envelope, alice);

    const pending = await relay.listEnvelopes(bob.did, bob);
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending)).not.toContain("verify signed relay transport");

    const decrypted = await decryptAgentMessage(pending[0].envelope, {
      identity: bob,
      signedPreKey: bobSignedPreKey,
      oneTimePreKey: bobOneTimePreKey,
      senderIdentity: publicIdentity(alice),
    });
    expect(decrypted).toEqual(message);

    const ack = await relay.ackEnvelope(pending[0].id, bob);
    expect(ack.id).toBe(pending[0].id);
    await expect(relay.listEnvelopes(bob.did, bob)).resolves.toHaveLength(0);
  });
});

