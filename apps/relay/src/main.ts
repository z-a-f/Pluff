import { createRelayServer } from "./server.js";
import { MemoryRelayStore } from "./store.js";
import { PostgresRelayStore } from "./postgres-store.js";

const port = Number(process.env.PLUFF_RELAY_PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;

const store = databaseUrl
  ? new PostgresRelayStore(databaseUrl)
  : new MemoryRelayStore();

if (store instanceof PostgresRelayStore) {
  await store.migrate();
}

const server = createRelayServer(store);
server.listen(port, () => {
  console.log(`Pluff relay listening on http://localhost:${port}`);
});

