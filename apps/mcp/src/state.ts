import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { LocalAccount } from "@pluff/client";
import type { PublicIdentity } from "@pluff/protocol";

interface McpStateData {
  accounts: Record<string, LocalAccount>;
}

export class McpStateStore {
  constructor(private readonly filePath = defaultStatePath()) {}

  async load(): Promise<McpStateData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as McpStateData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { accounts: {} };
      }
      throw error;
    }
  }

  async save(data: McpStateData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async saveAccount(account: LocalAccount): Promise<void> {
    const data = await this.load();
    data.accounts[account.identity.did] = account;
    await this.save(data);
  }

  async getAccount(did: string): Promise<LocalAccount> {
    const data = await this.load();
    const account = data.accounts[did];
    if (!account) {
      throw new Error(`Unknown local identity: ${did}`);
    }
    return account;
  }

  async addContact(ownerDid: string, contact: PublicIdentity): Promise<void> {
    const data = await this.load();
    const account = data.accounts[ownerDid];
    if (!account) {
      throw new Error(`Unknown local identity: ${ownerDid}`);
    }
    account.contacts[contact.did] = contact;
    await this.save(data);
  }
}

function defaultStatePath(): string {
  if (process.env.PLUFF_MCP_STATE) {
    return process.env.PLUFF_MCP_STATE;
  }
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "pluff", "mcp-state.json");
}

