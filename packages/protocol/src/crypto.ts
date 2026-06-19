import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToUtf8,
  canonicalJson,
  concatBytes,
  idWithPrefix,
  randomBytes,
  timingSafeEqual,
  utf8ToBytes,
} from "./encoding.js";
import { assertDidMatchesSigningKey, didKeyFromEd25519PublicKey } from "./did.js";
import { assertAgentMessage } from "./messages.js";
import {
  CIPHER_SUITE,
  PROTOCOL_VERSION,
  type AgentMessage,
  type DecryptMaterial,
  type EncryptedEnvelope,
  type IdentityKind,
  type LocalIdentity,
  type LocalOneTimePreKey,
  type LocalSignedPreKey,
  type OneTimePreKey,
  type PreKeyBundle,
  type PreKeyClaim,
  type PublicIdentity,
  type SignedPreKey,
} from "./types.js";

type NobleKeyUtils = {
  randomSecretKey?: () => Uint8Array;
  randomPrivateKey?: () => Uint8Array;
};

function randomSecretKey(utils: NobleKeyUtils): Uint8Array {
  const generator = utils.randomSecretKey ?? utils.randomPrivateKey;
  if (!generator) {
    throw new Error("Noble key generator is unavailable");
  }
  return generator();
}

type KemKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };
type KemEncapsulation = {
  sharedSecret: Uint8Array;
  ciphertext?: Uint8Array;
  cipherText?: Uint8Array;
};

function mlKemKeygen(): KemKeyPair {
  return ml_kem768.keygen() as KemKeyPair;
}

function mlKemEncapsulate(publicKey: Uint8Array): {
  sharedSecret: Uint8Array;
  ciphertext: Uint8Array;
} {
  const result = ml_kem768.encapsulate(publicKey) as KemEncapsulation;
  const ciphertext = result.ciphertext ?? result.cipherText;
  if (!ciphertext) {
    throw new Error("ML-KEM encapsulation did not return ciphertext");
  }
  return { sharedSecret: result.sharedSecret, ciphertext };
}

function mlKemDecapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(ciphertext, secretKey) as Uint8Array;
}

function keyBytes(value: string): Uint8Array {
  return base64UrlToBytes(value);
}

function signBytes(secretKey: string, payload: Uint8Array): string {
  return bytesToBase64Url(ed25519.sign(payload, keyBytes(secretKey)));
}

function verifyBytes(
  publicKey: string,
  payload: Uint8Array,
  signature: string,
): boolean {
  return ed25519.verify(keyBytes(signature), payload, keyBytes(publicKey));
}

function preKeyPayload(
  identityDid: string,
  keyKind: "signed" | "one_time",
  key: Omit<SignedPreKey | OneTimePreKey, "signature">,
): Uint8Array {
  return utf8ToBytes(
    canonicalJson({
      domain: "nonomessage.prekey.v1",
      identityDid,
      keyKind,
      key,
    }),
  );
}

function identityProofPayload(
  identity: Pick<
    PublicIdentity,
    | "did"
    | "kind"
    | "bundleVersion"
    | "signingPublicKey"
    | "agreementPublicKey"
    | "pqKemPublicKey"
    | "createdAt"
  >,
): Uint8Array {
  return utf8ToBytes(
    canonicalJson({
      domain: "nonomessage.identity.v1",
      did: identity.did,
      kind: identity.kind,
      bundleVersion: identity.bundleVersion,
      signingPublicKey: identity.signingPublicKey,
      agreementPublicKey: identity.agreementPublicKey,
      pqKemPublicKey: identity.pqKemPublicKey,
      createdAt: identity.createdAt,
    }),
  );
}

function envelopeHeader(
  envelope: Omit<EncryptedEnvelope, "associatedData" | "ciphertext">,
): Record<string, unknown> {
  return {
    id: envelope.id,
    protocolVersion: envelope.protocolVersion,
    cipherSuite: envelope.cipherSuite,
    senderDid: envelope.senderDid,
    recipientDid: envelope.recipientDid,
    createdAt: envelope.createdAt,
    sessionId: envelope.sessionId,
    preKeyIds: envelope.preKeyIds,
    ephemeralAgreementPublicKey: envelope.ephemeralAgreementPublicKey,
    kemCiphertext: envelope.kemCiphertext,
    nonce: envelope.nonce,
  };
}

function associatedDataFor(
  envelope: Omit<EncryptedEnvelope, "associatedData" | "ciphertext">,
): Uint8Array {
  return utf8ToBytes(canonicalJson(envelopeHeader(envelope)));
}

function sessionIdFromParts(parts: Uint8Array[]): string {
  return bytesToBase64Url(sha256(concatBytes(...parts)).slice(0, 16));
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto AES-GCM is unavailable");
  }
  return subtle.importKey("raw", toBufferSource(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(aad),
      tagLength: 128,
    },
    cryptoKey,
    toBufferSource(plaintext),
  );
  return new Uint8Array(ciphertext);
}

async function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(aad),
      tagLength: 128,
    },
    cryptoKey,
    toBufferSource(ciphertext),
  );
  return new Uint8Array(plaintext);
}

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

function deriveMessageKey(inputKeyMaterial: Uint8Array): Uint8Array {
  return hkdf(
    sha512,
    inputKeyMaterial,
    utf8ToBytes("nonomessage.pqxdh.v1.salt"),
    utf8ToBytes(CIPHER_SUITE),
    32,
  );
}

export function generateIdentity(
  kind: IdentityKind,
  options: { label?: string; createdAt?: string } = {},
): LocalIdentity {
  const signingSecretKey = randomSecretKey(ed25519.utils as NobleKeyUtils);
  const signingPublicKey = ed25519.getPublicKey(signingSecretKey);
  const agreementSecretKey = randomSecretKey(x25519.utils as NobleKeyUtils);
  const agreementPublicKey = x25519.getPublicKey(agreementSecretKey);
  const pqKem = mlKemKeygen();

  const signingSecretKeyB64 = bytesToBase64Url(signingSecretKey);
  const publicCore = {
    did: didKeyFromEd25519PublicKey(signingPublicKey),
    kind,
    bundleVersion: 1 as const,
    signingPublicKey: bytesToBase64Url(signingPublicKey),
    agreementPublicKey: bytesToBase64Url(agreementPublicKey),
    pqKemPublicKey: bytesToBase64Url(pqKem.publicKey),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };

  return {
    ...publicCore,
    label: options.label,
    keyProof: signBytes(signingSecretKeyB64, identityProofPayload(publicCore)),
    private: {
      signingSecretKey: signingSecretKeyB64,
      agreementSecretKey: bytesToBase64Url(agreementSecretKey),
      pqKemSecretKey: bytesToBase64Url(pqKem.secretKey),
    },
  };
}

export function assertPublicIdentity(identity: PublicIdentity): void {
  if (identity.bundleVersion !== 1) {
    throw new Error("Unsupported identity bundle version");
  }
  assertDidMatchesSigningKey(identity.did, identity.signingPublicKey);
  if (!verifyBytes(identity.signingPublicKey, identityProofPayload(identity), identity.keyProof)) {
    throw new Error("Invalid identity key proof");
  }
}

export function generateSignedPreKey(
  identity: LocalIdentity,
  options: { id?: string; createdAt?: string; expiresAt?: string } = {},
): LocalSignedPreKey {
  const agreementSecretKey = randomSecretKey(x25519.utils as NobleKeyUtils);
  const agreementPublicKey = x25519.getPublicKey(agreementSecretKey);
  const pqKem = mlKemKeygen();
  const keyWithoutSignature = {
    id: options.id ?? idWithPrefix("spk"),
    agreementPublicKey: bytesToBase64Url(agreementPublicKey),
    pqKemPublicKey: bytesToBase64Url(pqKem.publicKey),
    createdAt: options.createdAt ?? new Date().toISOString(),
    expiresAt: options.expiresAt,
  };

  return {
    publicKey: {
      ...keyWithoutSignature,
      signature: signBytes(
        identity.private.signingSecretKey,
        preKeyPayload(identity.did, "signed", keyWithoutSignature),
      ),
    },
    agreementSecretKey: bytesToBase64Url(agreementSecretKey),
    pqKemSecretKey: bytesToBase64Url(pqKem.secretKey),
  };
}

export function generateOneTimePreKey(
  identity: LocalIdentity,
  options: { id?: string; createdAt?: string } = {},
): LocalOneTimePreKey {
  const agreementSecretKey = randomSecretKey(x25519.utils as NobleKeyUtils);
  const agreementPublicKey = x25519.getPublicKey(agreementSecretKey);
  const pqKem = mlKemKeygen();
  const keyWithoutSignature = {
    id: options.id ?? idWithPrefix("otk"),
    agreementPublicKey: bytesToBase64Url(agreementPublicKey),
    pqKemPublicKey: bytesToBase64Url(pqKem.publicKey),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };

  return {
    publicKey: {
      ...keyWithoutSignature,
      signature: signBytes(
        identity.private.signingSecretKey,
        preKeyPayload(identity.did, "one_time", keyWithoutSignature),
      ),
    },
    agreementSecretKey: bytesToBase64Url(agreementSecretKey),
    pqKemSecretKey: bytesToBase64Url(pqKem.secretKey),
  };
}

export function verifySignedPreKey(
  identity: PublicIdentity,
  key: SignedPreKey,
): boolean {
  const { signature: _signature, ...keyWithoutSignature } = key;
  return verifyBytes(
    identity.signingPublicKey,
    preKeyPayload(identity.did, "signed", keyWithoutSignature),
    key.signature,
  );
}

export function verifyOneTimePreKey(
  identity: PublicIdentity,
  key: OneTimePreKey,
): boolean {
  const { signature: _signature, ...keyWithoutSignature } = key;
  return verifyBytes(
    identity.signingPublicKey,
    preKeyPayload(identity.did, "one_time", keyWithoutSignature),
    key.signature,
  );
}

export function assertPreKeyBundle(bundle: PreKeyBundle): void {
  assertPublicIdentity(bundle.identity);
  if (!verifySignedPreKey(bundle.identity, bundle.signedPreKey)) {
    throw new Error("Invalid signed prekey signature");
  }
  for (const oneTimePreKey of bundle.oneTimePreKeys) {
    if (!verifyOneTimePreKey(bundle.identity, oneTimePreKey)) {
      throw new Error("Invalid one-time prekey signature");
    }
  }
}

export function publicIdentity(identity: LocalIdentity): PublicIdentity {
  const { private: _private, ...publicPart } = identity;
  return publicPart;
}

export async function encryptAgentMessage(input: {
  sender: LocalIdentity;
  recipient: PreKeyClaim;
  message: AgentMessage;
  now?: string;
}): Promise<EncryptedEnvelope> {
  assertPublicIdentity(input.recipient.identity);
  if (!verifySignedPreKey(input.recipient.identity, input.recipient.signedPreKey)) {
    throw new Error("Recipient signed prekey is invalid");
  }
  if (
    input.recipient.oneTimePreKey &&
    !verifyOneTimePreKey(input.recipient.identity, input.recipient.oneTimePreKey)
  ) {
    throw new Error("Recipient one-time prekey is invalid");
  }
  assertAgentMessage(input.message);

  const ephemeralSecretKey = randomSecretKey(x25519.utils as NobleKeyUtils);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey);
  const selectedKemPublicKey = input.recipient.oneTimePreKey?.pqKemPublicKey
    ?? input.recipient.signedPreKey.pqKemPublicKey;
  const kem = mlKemEncapsulate(keyBytes(selectedKemPublicKey));

  const dhParts = [
    x25519.getSharedSecret(
      keyBytes(input.sender.private.agreementSecretKey),
      keyBytes(input.recipient.signedPreKey.agreementPublicKey),
    ),
    x25519.getSharedSecret(
      ephemeralSecretKey,
      keyBytes(input.recipient.identity.agreementPublicKey),
    ),
    x25519.getSharedSecret(
      ephemeralSecretKey,
      keyBytes(input.recipient.signedPreKey.agreementPublicKey),
    ),
  ];

  if (input.recipient.oneTimePreKey) {
    dhParts.push(
      x25519.getSharedSecret(
        ephemeralSecretKey,
        keyBytes(input.recipient.oneTimePreKey.agreementPublicKey),
      ),
    );
  }

  const messageKey = deriveMessageKey(concatBytes(...dhParts, kem.sharedSecret));
  const nonce = randomBytes(12);
  const baseEnvelope: Omit<EncryptedEnvelope, "associatedData" | "ciphertext"> = {
    id: idWithPrefix("env"),
    protocolVersion: PROTOCOL_VERSION,
    cipherSuite: CIPHER_SUITE,
    senderDid: input.sender.did,
    recipientDid: input.recipient.identity.did,
    createdAt: input.now ?? new Date().toISOString(),
    sessionId: sessionIdFromParts([
      keyBytes(input.sender.agreementPublicKey),
      keyBytes(input.recipient.identity.agreementPublicKey),
      ephemeralPublicKey,
    ]),
    preKeyIds: {
      signedPreKeyId: input.recipient.signedPreKey.id,
      oneTimePreKeyId: input.recipient.oneTimePreKey?.id,
    },
    ephemeralAgreementPublicKey: bytesToBase64Url(ephemeralPublicKey),
    kemCiphertext: bytesToBase64Url(kem.ciphertext),
    nonce: bytesToBase64Url(nonce),
  };
  const aad = associatedDataFor(baseEnvelope);
  const plaintext = utf8ToBytes(canonicalJson(input.message));
  const ciphertext = await aesGcmEncrypt(messageKey, nonce, aad, plaintext);

  return {
    ...baseEnvelope,
    associatedData: bytesToBase64Url(aad),
    ciphertext: bytesToBase64Url(ciphertext),
  };
}

export async function decryptAgentMessage(
  envelope: EncryptedEnvelope,
  material: DecryptMaterial,
): Promise<AgentMessage> {
  if (envelope.protocolVersion !== PROTOCOL_VERSION || envelope.cipherSuite !== CIPHER_SUITE) {
    throw new Error("Unsupported envelope version or cipher suite");
  }
  // Verify the sender's agreement/KEM keys are bound to its DID before trusting
  // them for key agreement; this is what defeats relay-driven sender spoofing.
  assertPublicIdentity(material.senderIdentity);
  if (envelope.recipientDid !== material.identity.did) {
    throw new Error("Envelope recipient does not match local identity");
  }
  if (envelope.senderDid !== material.senderIdentity.did) {
    throw new Error("Envelope sender does not match sender identity");
  }
  if (envelope.preKeyIds.signedPreKeyId !== material.signedPreKey.publicKey.id) {
    throw new Error("Envelope signed prekey does not match local material");
  }
  if (
    envelope.preKeyIds.oneTimePreKeyId &&
    envelope.preKeyIds.oneTimePreKeyId !== material.oneTimePreKey?.publicKey.id
  ) {
    throw new Error("Envelope one-time prekey does not match local material");
  }

  const { associatedData: _associatedData, ciphertext: _ciphertext, ...baseEnvelope } = envelope;
  const aad = associatedDataFor(baseEnvelope);
  if (!timingSafeEqual(aad, keyBytes(envelope.associatedData))) {
    throw new Error("Envelope associated data mismatch");
  }

  const ephemeralPublicKey = keyBytes(envelope.ephemeralAgreementPublicKey);
  const dhParts = [
    x25519.getSharedSecret(
      keyBytes(material.signedPreKey.agreementSecretKey),
      keyBytes(material.senderIdentity.agreementPublicKey),
    ),
    x25519.getSharedSecret(
      keyBytes(material.identity.private.agreementSecretKey),
      ephemeralPublicKey,
    ),
    x25519.getSharedSecret(
      keyBytes(material.signedPreKey.agreementSecretKey),
      ephemeralPublicKey,
    ),
  ];

  const selectedKemSecretKey = material.oneTimePreKey?.pqKemSecretKey
    ?? material.signedPreKey.pqKemSecretKey;

  if (envelope.preKeyIds.oneTimePreKeyId) {
    if (!material.oneTimePreKey) {
      throw new Error("Envelope requires one-time prekey material");
    }
    dhParts.push(
      x25519.getSharedSecret(
        keyBytes(material.oneTimePreKey.agreementSecretKey),
        ephemeralPublicKey,
      ),
    );
  }

  const kemSharedSecret = mlKemDecapsulate(
    keyBytes(envelope.kemCiphertext),
    keyBytes(selectedKemSecretKey),
  );
  const messageKey = deriveMessageKey(concatBytes(...dhParts, kemSharedSecret));
  const plaintext = await aesGcmDecrypt(
    messageKey,
    keyBytes(envelope.nonce),
    aad,
    keyBytes(envelope.ciphertext),
  );
  const parsed = JSON.parse(bytesToUtf8(plaintext)) as AgentMessage;
  assertAgentMessage(parsed);
  return parsed;
}
