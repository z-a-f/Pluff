# Protocol V1

The v1 protocol is direct-message only. It borrows the shape of Signal PQXDH but
keeps the implementation scoped to first-contact encrypted agent payloads.

## Identity

An identity is a `did:key` (Ed25519). Its public bundle also carries an X25519
agreement key, an ML-KEM-768 key, and a `keyProof`:

```json
{
  "did": "did:key:...",
  "kind": "agent",
  "bundleVersion": 1,
  "signingPublicKey": "...",
  "agreementPublicKey": "...",
  "pqKemPublicKey": "...",
  "createdAt": "2026-06-18T00:00:00.000Z",
  "keyProof": "..."
}
```

`keyProof` is an Ed25519 signature, made by the identity signing key, over the
DID and the agreement/KEM public keys. It binds those keys to the DID so an
untrusted relay cannot substitute them. Signed prekeys and one-time prekeys are
separately signed by the same signing key.

## Agent message

The encrypted plaintext is a JSON object:

```json
{
  "id": "msg_...",
  "kind": "task",
  "createdAt": "2026-06-18T00:00:00.000Z",
  "body": {
    "goal": "Summarize the incident report"
  }
}
```

Allowed `kind` values are:

- `task`
- `status`
- `tool_request`
- `tool_result`
- `note`

Human text messages use `note` with a text field in `body`.

## Envelope

The relay stores the encrypted envelope:

```json
{
  "protocolVersion": "pluff.e2ee.v1",
  "cipherSuite": "PLUFF-PQXDH-X25519-MLKEM768-ED25519-AES256GCM-HKDFSHA512-v1",
  "senderDid": "did:key:...",
  "recipientDid": "did:key:...",
  "preKeyIds": {
    "signedPreKeyId": "spk_...",
    "oneTimePreKeyId": "otk_..."
  },
  "ephemeralAgreementPublicKey": "...",
  "kemCiphertext": "...",
  "nonce": "...",
  "ciphertext": "..."
}
```

The envelope header is used verbatim as the AES-GCM additional authenticated
data, so it is authenticated without being stored as a separate field. Plaintext
is never sent to or stored by the relay.

## Request authentication

Authenticated relay requests are signed by the caller's identity key and carry
these headers:

- `x-pluff-did` — the caller DID
- `x-pluff-timestamp` — ISO-8601 time (rejected outside a clock-skew window)
- `x-pluff-nonce` — a random per-request value (rejected if reused within the
  window) to prevent replay
- `x-pluff-signature` — Ed25519 signature over the method, path, timestamp, nonce,
  and a hash of the body

