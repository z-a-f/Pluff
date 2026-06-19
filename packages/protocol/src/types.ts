export const PROTOCOL_VERSION = "nonomessage.e2ee.v1";

export const CIPHER_SUITE =
  "NNM-PQXDH-X25519-MLKEM768-ED25519-AES256GCM-HKDFSHA512-v1";

export type Base64UrlString = string;

export type IdentityKind = "person" | "agent" | "service";

export type AgentMessageKind =
  | "task"
  | "status"
  | "tool_request"
  | "tool_result"
  | "note";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface AgentMessage {
  id: string;
  kind: AgentMessageKind;
  createdAt: string;
  body: JsonObject;
  replyTo?: string;
  threadId?: string;
}

export interface PublicIdentity {
  did: string;
  kind: IdentityKind;
  label?: string;
  bundleVersion: 1;
  signingPublicKey: Base64UrlString;
  agreementPublicKey: Base64UrlString;
  pqKemPublicKey: Base64UrlString;
  createdAt: string;
  // Ed25519 self-signature by the identity signing key over the DID and the
  // agreement/KEM public keys. Binds those keys to the DID so an untrusted relay
  // cannot swap them to impersonate a sender. See assertPublicIdentity.
  keyProof: Base64UrlString;
}

export interface IdentityPrivateMaterial {
  signingSecretKey: Base64UrlString;
  agreementSecretKey: Base64UrlString;
  pqKemSecretKey: Base64UrlString;
}

export interface LocalIdentity extends PublicIdentity {
  private: IdentityPrivateMaterial;
}

export interface SignedPreKey {
  id: string;
  agreementPublicKey: Base64UrlString;
  pqKemPublicKey: Base64UrlString;
  createdAt: string;
  expiresAt?: string;
  signature: Base64UrlString;
}

export interface OneTimePreKey {
  id: string;
  agreementPublicKey: Base64UrlString;
  pqKemPublicKey: Base64UrlString;
  createdAt: string;
  signature: Base64UrlString;
}

export interface LocalSignedPreKey {
  publicKey: SignedPreKey;
  agreementSecretKey: Base64UrlString;
  pqKemSecretKey: Base64UrlString;
}

export interface LocalOneTimePreKey {
  publicKey: OneTimePreKey;
  agreementSecretKey: Base64UrlString;
  pqKemSecretKey: Base64UrlString;
}

export interface PreKeyBundle {
  identity: PublicIdentity;
  signedPreKey: SignedPreKey;
  oneTimePreKeys: OneTimePreKey[];
}

export interface PreKeyClaim {
  identity: PublicIdentity;
  signedPreKey: SignedPreKey;
  oneTimePreKey?: OneTimePreKey;
  claimedAt: string;
}

export interface EnvelopePreKeyIds {
  signedPreKeyId: string;
  oneTimePreKeyId?: string;
}

export interface EncryptedEnvelope {
  id: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  cipherSuite: typeof CIPHER_SUITE;
  senderDid: string;
  recipientDid: string;
  createdAt: string;
  sessionId: string;
  preKeyIds: EnvelopePreKeyIds;
  ephemeralAgreementPublicKey: Base64UrlString;
  kemCiphertext: Base64UrlString;
  nonce: Base64UrlString;
  associatedData: Base64UrlString;
  ciphertext: Base64UrlString;
}

export interface DecryptMaterial {
  identity: LocalIdentity;
  signedPreKey: LocalSignedPreKey;
  oneTimePreKey?: LocalOneTimePreKey;
  senderIdentity: PublicIdentity;
}

