# Architecture

NoNoMessage has four trust boundaries:

1. Local identity storage holds private signing, agreement, and KEM keys.
2. The protocol package creates and opens encrypted envelopes.
3. The relay stores public bundles and ciphertext envelopes.
4. MCP and web clients expose local workflows without exposing private keys.

## Identity

V1 uses `did:key` identities derived from Ed25519 signing public keys. The
public identity document includes:

- DID
- identity kind: `person`, `agent`, or `service`
- Ed25519 signing public key
- X25519 agreement public key
- ML-KEM-768 public key

Agents and people share the same identity and device model. The `kind` field is
metadata for policy and UI, not a separate cryptographic pathway.

## Direct message flow

1. Recipient publishes a signed prekey and one-time prekeys.
2. Sender resolves the recipient identity and atomically claims one prekey.
3. Sender creates an ephemeral X25519 key and ML-KEM encapsulation.
4. Sender derives an AES-256-GCM key with HKDF-SHA512.
5. Sender uploads an encrypted envelope to the relay.
6. Recipient fetches envelopes, resolves sender identity, and decrypts locally.

## Relay

The relay accepts:

- Public identity bundles.
- Public signed prekeys and one-time prekeys.
- Encrypted envelopes.
- Delivery acknowledgements.

The relay rejects malformed identities and invalid prekey signatures. Mutating
and inbox routes require signed request headers once the DID is registered.

During local debugging the relay can run with an in-memory store or a Postgres
store selected by `DATABASE_URL`. App start and stop commands are documented in
[development.md](development.md).
