# @murmu/relay

Minimal untrusted relay for [Murmu](https://github.com/z-a-f/Murmu).

This package is private and is not published to npm. It is part of the Murmu
workspace and exists to run the relay locally and in deployment.

## Role

The relay stores only public key bundles and encrypted envelopes. It is never
trusted with message plaintext or private keys. It may observe metadata such as
sender DID, recipient DID, timestamps, message sizes, and delivery state.
Authenticated routes require a signed request from the acting DID, and a
per-process nonce cache rejects replays.

## Stores

The relay defaults to an in-memory store. Set `DATABASE_URL` to use the Postgres
store, which migrates its schema on startup.

```sh
# In-memory (default)
pnpm dev:relay

# Postgres-backed
pnpm dev:postgres
export DATABASE_URL=postgres://murmu:murmu@localhost:5432/murmu
pnpm dev:relay
```

The listen port defaults to `8787` and can be overridden with
`MURMU_RELAY_PORT`.

## HTTP API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | no | Liveness check |
| `POST` | `/v1/identities` | no | Publish a prekey bundle |
| `GET` | `/v1/identities/:did` | no | Fetch an identity |
| `GET` | `/v1/identities/:did/bundle` | no | Fetch a full prekey bundle |
| `POST` | `/v1/prekeys/:did/claim` | yes | Claim a one-time prekey |
| `POST` | `/v1/envelopes` | yes | Submit an encrypted envelope |
| `GET` | `/v1/envelopes?recipientDid=...` | yes | List envelopes for a recipient |
| `POST` | `/v1/envelopes/:id/ack` | yes | Acknowledge delivery |

## Scripts

```sh
pnpm --filter @murmu/relay dev        # run with tsx
pnpm --filter @murmu/relay build      # tsc build to dist/
pnpm --filter @murmu/relay test       # vitest
pnpm --filter @murmu/relay typecheck
```

## License

Apache-2.0
