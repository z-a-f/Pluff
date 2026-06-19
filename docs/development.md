# Development

Use Node 20 and `pnpm`:

```sh
nvm use
pnpm install
```

## Start apps

Start the relay and web app in separate terminals:

```sh
pnpm dev:relay
pnpm dev:web
```

The relay listens on `http://localhost:8787`. The web app listens on
`http://localhost:5173` and defaults to the local relay URL.

The relay uses the in-memory store by default. This is the fastest path for UI
and protocol debugging because identities, prekeys, and encrypted envelopes are
discarded when the relay stops.

## Stop apps

Press `Ctrl-C` in each terminal running a dev server.

If a process is detached or the terminal is gone, find app server processes:

```sh
pgrep -af '[v]ite|[t]sx src/main.ts'
```

Then stop the exact PID:

```sh
kill <pid>
```

Use `kill -9 <pid>` only when a normal `kill <pid>` does not stop the process.

## Postgres relay

Start Postgres:

```sh
pnpm dev:postgres
```

Start the relay with persistent storage:

```sh
export DATABASE_URL=postgres://pluff:pluff@localhost:5432/pluff
pnpm dev:relay
```

Stop Postgres:

```sh
pnpm stop:postgres
```

Remove the local Postgres container and volume only when you intentionally want
to delete persisted relay data:

```sh
docker compose down -v
```

## MCP debugging

Run the MCP stdio server:

```sh
pnpm dev:mcp
```

The MCP server stores local private identity state in `PLUFF_MCP_STATE` when set.
Otherwise it writes to the user data directory. Set a temporary state file when
debugging repeatable local sessions:

```sh
export PLUFF_MCP_STATE=/tmp/pluff-mcp-state.json
pnpm dev:mcp
```

## Health checks

Check the relay:

```sh
curl -sS http://localhost:8787/health
```

Expected response:

```json
{"ok":true}
```

Run verification:

```sh
pnpm typecheck
pnpm test
pnpm build
```

