# Pluff

Pluff is a lightweight direct-message system for secure agent-to-agent,
person-to-person, and agent-to-person communication. The first implementation is
a serious prototype: it keeps the relay untrusted, puts all private key material
on clients, and treats structured agent JSON as the primary message payload.

## Current scope

- Direct messages only.
- `did:key` identities for people and agents.
- Hybrid post-quantum/classical session setup: X25519 plus ML-KEM-768.
- Agent JSON payloads, with human notes represented as a structured message
  kind.
- Minimal relay that stores public key bundles and encrypted envelopes only.
- Web client shell and MCP-first agent interface.

Not included yet: group messaging, native mobile UI, attachments, multi-device
sync, federation, account recovery, or production security audit claims.

## Workspace

```text
apps/
  mcp/      MCP server exposing secure messaging tools for agents
  relay/    Minimal untrusted relay with memory and Postgres stores
  web/      Vite React client shell
packages/
  client/   Relay client and local workflow helpers
  protocol/ DID, crypto, message, and envelope primitives
```

## Development

This repo uses `pnpm` workspaces.

```sh
nvm use
pnpm install
pnpm test
pnpm build
```

Start the in-memory relay and web app in separate terminals:

```sh
pnpm dev:relay
pnpm dev:web
```

Then open `http://localhost:5173/`. The web app defaults to
`http://localhost:8787` for the relay.

Stop app dev servers with `Ctrl-C` in the terminal where each command is
running. If a detached process is left behind while debugging, find it with:

```sh
pgrep -af '[v]ite|[t]sx src/main.ts'
```

Then stop the specific PID with `kill <pid>`.

For local relay persistence with Postgres:

```sh
pnpm dev:postgres
export DATABASE_URL=postgres://pluff:pluff@localhost:5432/pluff
pnpm dev:relay
```

Stop Postgres with:

```sh
pnpm stop:postgres
```

The relay defaults to the in-memory store unless `DATABASE_URL` is set. More
debugging notes are in [docs/development.md](docs/development.md).

## Security model

The relay is intentionally not trusted with message plaintext or private keys.
It may observe metadata such as sender DID, recipient DID, timestamps, message
sizes, and delivery state. Private keys stay in the web client, native client,
or local MCP state store.

The protocol is versioned and crypto-agile. The default cipher suite is:

```text
PLUFF-PQXDH-X25519-MLKEM768-ED25519-AES256GCM-HKDFSHA512-v1
```

The post-quantum component uses ML-KEM-768, standardized by NIST as FIPS 203.
The handshake is inspired by Signal PQXDH, but this repo is not a Signal
implementation and has not been independently audited.

## Privacy boundary

Relay storage must contain only public identity material, public prekeys, and
encrypted envelopes. Tests assert that agent payload fields do not appear in the
stored envelope records.
