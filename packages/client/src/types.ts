import type {
  EncryptedEnvelope,
  LocalIdentity,
  LocalOneTimePreKey,
  LocalSignedPreKey,
  PreKeyBundle,
  PreKeyClaim,
  PublicIdentity,
} from "@pluff/protocol";

export interface RelayClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface StoredEnvelope {
  id: string;
  senderDid: string;
  recipientDid: string;
  createdAt: string;
  ackedAt?: string;
  envelope: EncryptedEnvelope;
}

export interface LocalAccount {
  identity: LocalIdentity;
  signedPreKey: LocalSignedPreKey;
  oneTimePreKeys: LocalOneTimePreKey[];
  contacts: Record<string, PublicIdentity>;
  // Envelope ids already decrypted by this account. Used to ignore a relay that
  // ignores acks and redelivers, so a captured envelope cannot be replayed.
  processedEnvelopeIds?: string[];
}

export interface RegistrationResult {
  identity: PublicIdentity;
  oneTimePreKeyCount: number;
}

export type { PreKeyBundle, PreKeyClaim };

