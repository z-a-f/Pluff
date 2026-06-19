import {
  assertPreKeyBundle,
  type EncryptedEnvelope,
  type PreKeyBundle,
  type PreKeyClaim,
} from "@nonomessage/protocol";

export interface StoredEnvelope {
  id: string;
  senderDid: string;
  recipientDid: string;
  createdAt: string;
  ackedAt?: string;
  envelope: EncryptedEnvelope;
}

export interface RelayStore {
  upsertBundle(bundle: PreKeyBundle): Promise<void>;
  getBundle(did: string): Promise<PreKeyBundle | undefined>;
  claimPreKey(did: string): Promise<PreKeyClaim | undefined>;
  insertEnvelope(envelope: EncryptedEnvelope): Promise<void>;
  listEnvelopes(recipientDid: string): Promise<StoredEnvelope[]>;
  ackEnvelope(id: string, recipientDid: string): Promise<StoredEnvelope | undefined>;
}

export class MemoryRelayStore implements RelayStore {
  private bundles = new Map<string, PreKeyBundle>();
  private claimedOneTimeKeys = new Map<string, Set<string>>();
  private envelopes = new Map<string, StoredEnvelope>();

  async upsertBundle(bundle: PreKeyBundle): Promise<void> {
    assertPreKeyBundle(bundle);
    this.bundles.set(bundle.identity.did, structuredClone(bundle));
    const claimed = this.claimedOneTimeKeys.get(bundle.identity.did) ?? new Set<string>();
    this.claimedOneTimeKeys.set(bundle.identity.did, claimed);
  }

  async getBundle(did: string): Promise<PreKeyBundle | undefined> {
    const bundle = this.bundles.get(did);
    if (!bundle) {
      return undefined;
    }
    const claimed = this.claimedOneTimeKeys.get(did) ?? new Set<string>();
    return {
      ...structuredClone(bundle),
      oneTimePreKeys: bundle.oneTimePreKeys.filter((key) => !claimed.has(key.id)),
    };
  }

  async claimPreKey(did: string): Promise<PreKeyClaim | undefined> {
    const bundle = this.bundles.get(did);
    if (!bundle) {
      return undefined;
    }
    const claimed = this.claimedOneTimeKeys.get(did) ?? new Set<string>();
    this.claimedOneTimeKeys.set(did, claimed);
    const oneTimePreKey = bundle.oneTimePreKeys.find((key) => !claimed.has(key.id));
    if (oneTimePreKey) {
      claimed.add(oneTimePreKey.id);
    }
    return {
      identity: structuredClone(bundle.identity),
      signedPreKey: structuredClone(bundle.signedPreKey),
      oneTimePreKey: oneTimePreKey ? structuredClone(oneTimePreKey) : undefined,
      claimedAt: new Date().toISOString(),
    };
  }

  async insertEnvelope(envelope: EncryptedEnvelope): Promise<void> {
    if (!this.bundles.has(envelope.recipientDid)) {
      throw new Error("Recipient identity is unknown");
    }
    // Idempotent insert: never overwrite an existing id, so a re-submitted
    // envelope cannot resurrect an already-acked record and be redelivered.
    // Matches the Postgres store's `on conflict (id) do nothing`.
    if (this.envelopes.has(envelope.id)) {
      return;
    }
    this.envelopes.set(envelope.id, {
      id: envelope.id,
      senderDid: envelope.senderDid,
      recipientDid: envelope.recipientDid,
      createdAt: envelope.createdAt,
      envelope: structuredClone(envelope),
    });
  }

  async listEnvelopes(recipientDid: string): Promise<StoredEnvelope[]> {
    return Array.from(this.envelopes.values())
      .filter((record) => record.recipientDid === recipientDid && !record.ackedAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => structuredClone(record));
  }

  async ackEnvelope(id: string, recipientDid: string): Promise<StoredEnvelope | undefined> {
    const record = this.envelopes.get(id);
    if (!record || record.recipientDid !== recipientDid) {
      return undefined;
    }
    record.ackedAt = new Date().toISOString();
    return structuredClone(record);
  }

  snapshot(): {
    bundles: PreKeyBundle[];
    envelopes: StoredEnvelope[];
  } {
    return {
      bundles: Array.from(this.bundles.values()).map((bundle) => structuredClone(bundle)),
      envelopes: Array.from(this.envelopes.values()).map((record) => structuredClone(record)),
    };
  }
}

