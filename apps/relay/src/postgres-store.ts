import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import {
  assertPreKeyBundle,
  type EncryptedEnvelope,
  type OneTimePreKey,
  type PreKeyBundle,
  type PreKeyClaim,
} from "@pluff/protocol";
import type { RelayStore, StoredEnvelope } from "./store.js";

export class PostgresRelayStore implements RelayStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async migrate(): Promise<void> {
    const currentFile = fileURLToPath(import.meta.url);
    const migrationPath = join(dirname(currentFile), "../migrations/001_init.sql");
    const sql = await readFile(migrationPath, "utf8");
    await this.pool.query(sql);
  }

  async upsertBundle(bundle: PreKeyBundle): Promise<void> {
    assertPreKeyBundle(bundle);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `
        insert into identities (did, identity, signed_pre_key, updated_at)
        values ($1, $2, $3, now())
        on conflict (did) do update
          set identity = excluded.identity,
              signed_pre_key = excluded.signed_pre_key,
              updated_at = now()
        `,
        [bundle.identity.did, bundle.identity, bundle.signedPreKey],
      );
      for (const oneTimePreKey of bundle.oneTimePreKeys) {
        await client.query(
          `
          insert into one_time_pre_keys (did, key_id, public_key)
          values ($1, $2, $3)
          on conflict (did, key_id) do nothing
          `,
          [bundle.identity.did, oneTimePreKey.id, oneTimePreKey],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getBundle(did: string): Promise<PreKeyBundle | undefined> {
    const identityResult = await this.pool.query(
      "select identity, signed_pre_key from identities where did = $1",
      [did],
    );
    if (identityResult.rowCount === 0) {
      return undefined;
    }
    const oneTimeResult = await this.pool.query(
      `
      select public_key
      from one_time_pre_keys
      where did = $1 and claimed_at is null
      order by created_at asc
      limit 100
      `,
      [did],
    );
    return {
      identity: identityResult.rows[0].identity,
      signedPreKey: identityResult.rows[0].signed_pre_key,
      oneTimePreKeys: oneTimeResult.rows.map((row) => row.public_key),
    };
  }

  async claimPreKey(did: string): Promise<PreKeyClaim | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const bundle = await this.getBundleForUpdate(client, did);
      if (!bundle) {
        await client.query("commit");
        return undefined;
      }
      const preKeyResult = await client.query(
        `
        select key_id, public_key
        from one_time_pre_keys
        where did = $1 and claimed_at is null
        order by created_at asc
        limit 1
        for update skip locked
        `,
        [did],
      );
      let oneTimePreKey: OneTimePreKey | undefined;
      if ((preKeyResult.rowCount ?? 0) > 0) {
        oneTimePreKey = preKeyResult.rows[0].public_key;
        await client.query(
          "update one_time_pre_keys set claimed_at = now() where did = $1 and key_id = $2",
          [did, preKeyResult.rows[0].key_id],
        );
      }
      await client.query("commit");
      return {
        identity: bundle.identity,
        signedPreKey: bundle.signedPreKey,
        oneTimePreKey,
        claimedAt: new Date().toISOString(),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async insertEnvelope(envelope: EncryptedEnvelope): Promise<void> {
    await this.pool.query(
      `
      insert into envelopes (id, sender_did, recipient_did, created_at, envelope)
      values ($1, $2, $3, $4, $5)
      on conflict (id) do nothing
      `,
      [
        envelope.id,
        envelope.senderDid,
        envelope.recipientDid,
        envelope.createdAt,
        envelope,
      ],
    );
  }

  async listEnvelopes(recipientDid: string): Promise<StoredEnvelope[]> {
    const result = await this.pool.query(
      `
      select id, sender_did, recipient_did, created_at, envelope, acked_at
      from envelopes
      where recipient_did = $1 and acked_at is null
      order by created_at asc
      `,
      [recipientDid],
    );
    return result.rows.map(rowToStoredEnvelope);
  }

  async ackEnvelope(id: string, recipientDid: string): Promise<StoredEnvelope | undefined> {
    const result = await this.pool.query(
      `
      update envelopes
      set acked_at = now()
      where id = $1 and recipient_did = $2
      returning id, sender_did, recipient_did, created_at, envelope, acked_at
      `,
      [id, recipientDid],
    );
    return result.rowCount ? rowToStoredEnvelope(result.rows[0]) : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async getBundleForUpdate(
    client: PoolClient,
    did: string,
  ): Promise<Omit<PreKeyBundle, "oneTimePreKeys"> | undefined> {
    const result = await client.query(
      `
      select identity, signed_pre_key
      from identities
      where did = $1
      for update
      `,
      [did],
    );
    if (result.rowCount === 0) {
      return undefined;
    }
    return {
      identity: result.rows[0].identity,
      signedPreKey: result.rows[0].signed_pre_key,
    };
  }
}

function rowToStoredEnvelope(row: {
  id: string;
  sender_did: string;
  recipient_did: string;
  created_at: Date;
  envelope: EncryptedEnvelope;
  acked_at?: Date | null;
}): StoredEnvelope {
  return {
    id: row.id,
    senderDid: row.sender_did,
    recipientDid: row.recipient_did,
    createdAt: row.created_at.toISOString(),
    ackedAt: row.acked_at ? row.acked_at.toISOString() : undefined,
    envelope: row.envelope,
  };
}
