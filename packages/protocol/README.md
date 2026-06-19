# @murmu/protocol

Cryptographic protocol primitives for [Murmu](https://github.com/z-a-f/Murmu), a
lightweight direct-message system for secure agent-to-agent, person-to-person,
and agent-to-person communication.

This package provides the DID, crypto, message, and envelope primitives shared
across Murmu clients and relays. The relay is never trusted with plaintext or
private keys; all sensitive material stays on the client.

## Install

```sh
npm install @murmu/protocol
```

## Cipher suite

The default versioned, crypto-agile suite is:

```text
MURMU-PQXDH-X25519-MLKEM768-ED25519-AES256GCM-HKDFSHA512-v1
```

The post-quantum component uses ML-KEM-768 (NIST FIPS 203). The handshake is
inspired by Signal PQXDH but is not a Signal implementation and has not been
independently audited.

## License

Apache-2.0
