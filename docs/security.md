# Security Notes

This repository is a prototype. It uses modern primitives and tests the
plaintext boundary, but it is not production-audited cryptographic software.

## Cipher suite

`PLUFF-PQXDH-X25519-MLKEM768-ED25519-AES256GCM-HKDFSHA512-v1`

- Ed25519 signs identity-controlled prekey bundles.
- X25519 provides classical elliptic-curve key agreement.
- ML-KEM-768 provides post-quantum KEM material.
- HKDF-SHA512 derives the message encryption key.
- AES-256-GCM encrypts structured agent payloads.

The HKDF step binds the full handshake transcript (sender/recipient DIDs, both
identity agreement keys, the prekey ids, the ephemeral key, and the KEM
ciphertext) into the derived key.

## Identity authentication

A `did:key` only commits to the Ed25519 signing key. The X25519 agreement key and
the ML-KEM key are therefore additionally bound to the identity by a `keyProof`:
an Ed25519 self-signature, made by the identity signing key, over the DID and the
agreement/KEM public keys.

This binding is what keeps the relay untrusted for authenticity. Without it, a
relay could serve a victim's real DID and signing key while substituting its own
agreement key and forge messages from any sender (the only sender authentication
is the key-agreement term over the identity agreement key). `keyProof` is verified
whenever an identity bundle is accepted and again before decryption trusts a
sender identity for key agreement.

## Replay protection

- **Transport:** signed relay requests carry a random `x-pluff-nonce` (alongside the
  DID, timestamp, and signature). The relay rejects a reused `(did, nonce)` within
  the clock-skew window, so a captured request cannot be replayed (e.g. to exhaust
  a victim's one-time prekeys).
- **Delivery:** envelope inserts are idempotent (an id is never overwritten), and
  recipients record processed envelope ids and ignore redeliveries, so an envelope
  cannot be re-delivered even by a relay that ignores acknowledgements.

## Metadata

The relay can observe:

- Sender DID
- Recipient DID
- Envelope creation time
- Message size
- Delivery acknowledgement state

V1 does not attempt metadata-hiding, mixnets, private information retrieval, or
sealed sender.

## Key storage

The web app stores local identity state in IndexedDB. The MCP app stores local
identity state in a JSON file chosen by `PLUFF_MCP_STATE` or a user data
directory. Production mobile clients should use platform secure storage.

## Limitations

- **No Double Ratchet.** Each message is an independent first-contact handshake.
  Every message uses a fresh ephemeral key and, when available, a one-time prekey,
  so individual messages have forward secrecy. But once a recipient's one-time
  prekeys are exhausted, messages fall back to the long-lived signed prekey:
  compromise of that one signed-prekey secret then exposes all such messages.
  Rotate signed prekeys and keep one-time prekeys replenished.
- **No post-compromise security.** There is no ratchet, so compromise of
  long-term key material is not healed by continued messaging.
- The protocol is versioned and crypto-agile, but has not been independently
  audited.

## Deferred hardening (TODO)

These are known gaps intentionally left for later; they are larger or
product-shaped changes rather than protocol corrections.

### Web key encryption at rest

Today the web client stores private keys unencrypted in IndexedDB (see
`apps/web/src/db.ts`). Any script that runs in the origin (e.g. via XSS) can read
them. Motivation: keys should not be recoverable from a stolen profile or an
injected script.

Options:

- Wrap keys with a key derived from a user passphrase (Argon2id or PBKDF2) using
  AES-GCM; prompt for the passphrase on load. Simplest, but adds a passphrase UX.
- Use a WebAuthn PRF-derived key so unlock is bound to a hardware authenticator.
- Generate non-extractable WebCrypto keys so raw key bytes never leave the
  browser key store (requires reworking the protocol to operate on `CryptoKey`s).

### Relay rate limiting

The relay applies no rate limiting, so prekey claims and envelope inserts can be
abused (one-time-prekey exhaustion, storage flooding). Motivation: blunt cheap
denial-of-service against a shared relay.

Options:

- In-memory fixed-window or token-bucket limiter keyed by client IP and/or DID
  (simple; per-process only).
- Enforce limits at a reverse proxy / API gateway in front of the relay.
- A shared-store (e.g. Redis) token bucket for correct limits across multiple
  relay instances.

