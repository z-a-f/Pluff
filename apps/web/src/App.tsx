import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Inbox,
  KeyRound,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  RelayClient,
  createPreKeyBundle,
  type LocalAccount,
} from "@pluff/client";
import {
  decryptAgentMessage,
  encryptAgentMessage,
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  publicIdentity,
  createAgentMessage,
  type AgentMessage,
  type AgentMessageKind,
} from "@pluff/protocol";
import { getAccount, listAccounts, saveAccount } from "./db.js";
import "./styles.css";

interface InboxItem {
  envelopeId: string;
  senderDid: string;
  message: AgentMessage;
}

const DEFAULT_BODY = JSON.stringify(
  {
    goal: "summarize the latest project status",
    priority: "normal",
  },
  null,
  2,
);

export function App() {
  const [relayUrl, setRelayUrl] = useState("http://localhost:8787");
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [activeDid, setActiveDid] = useState("");
  const [recipientDid, setRecipientDid] = useState("");
  const [kind, setKind] = useState<AgentMessageKind>("task");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const relay = useMemo(() => new RelayClient({ baseUrl: relayUrl }), [relayUrl]);
  const activeAccount = accounts.find((account) => account.identity.did === activeDid);

  useEffect(() => {
    void refreshAccounts();
  }, []);

  async function refreshAccounts() {
    const loaded = await listAccounts();
    setAccounts(loaded);
    if (!activeDid && loaded[0]) {
      setActiveDid(loaded[0].identity.did);
    }
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setStatus(label);
    try {
      await action();
      setStatus("Done");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function createIdentity() {
    await run("Creating identity", async () => {
      const identity = generateIdentity("agent", { label: "Web agent" });
      const signedPreKey = generateSignedPreKey(identity);
      const oneTimePreKeys = Array.from({ length: 10 }, () =>
        generateOneTimePreKey(identity),
      );
      const account: LocalAccount = {
        identity,
        signedPreKey,
        oneTimePreKeys,
        contacts: {},
        processedEnvelopeIds: [],
      };
      await saveAccount(account);
      await refreshAccounts();
      setActiveDid(identity.did);
    });
  }

  async function registerIdentity() {
    if (!activeAccount) {
      return;
    }
    await run("Registering bundle", async () => {
      await relay.registerBundle(createPreKeyBundle(activeAccount));
    });
  }

  async function sendMessage() {
    if (!activeAccount) {
      return;
    }
    await run("Encrypting and sending", async () => {
      const parsedBody = JSON.parse(body);
      const claim = await relay.claimPreKey(recipientDid, activeAccount.identity);
      const message = createAgentMessage(kind, parsedBody);
      const envelope = await encryptAgentMessage({
        sender: activeAccount.identity,
        recipient: claim,
        message,
      });
      await relay.submitEnvelope(envelope, activeAccount.identity);
    });
  }

  async function fetchInbox() {
    if (!activeAccount) {
      return;
    }
    await run("Fetching inbox", async () => {
      const records = await relay.listEnvelopes(activeAccount.identity.did, activeAccount.identity);
      const processed = new Set(activeAccount.processedEnvelopeIds ?? []);
      const messages: InboxItem[] = [];
      for (const record of records) {
        // Ignore an envelope we already decrypted (a relay that ignores acks
        // could redeliver it); re-ack so it stops coming back.
        if (processed.has(record.id)) {
          await relay.ackEnvelope(record.id, activeAccount.identity);
          continue;
        }
        const senderIdentity =
          activeAccount.contacts[record.senderDid] ?? await relay.resolveIdentity(record.senderDid);
        const oneTimePreKey = activeAccount.oneTimePreKeys.find(
          (key) => key.publicKey.id === record.envelope.preKeyIds.oneTimePreKeyId,
        );
        const message = await decryptAgentMessage(record.envelope, {
          identity: activeAccount.identity,
          signedPreKey: activeAccount.signedPreKey,
          oneTimePreKey,
          senderIdentity,
        });
        processed.add(record.id);
        messages.push({ envelopeId: record.id, senderDid: record.senderDid, message });
        await relay.ackEnvelope(record.id, activeAccount.identity);
      }
      await saveAccount({ ...activeAccount, processedEnvelopeIds: [...processed] });
      await refreshAccounts();
      setInbox(messages);
    });
  }

  async function rotatePreKeys() {
    if (!activeAccount) {
      return;
    }
    await run("Rotating prekeys", async () => {
      const updated: LocalAccount = {
        ...activeAccount,
        signedPreKey: generateSignedPreKey(activeAccount.identity),
        oneTimePreKeys: Array.from({ length: 10 }, () =>
          generateOneTimePreKey(activeAccount.identity),
        ),
      };
      await saveAccount(updated);
      await refreshAccounts();
      await relay.registerBundle(createPreKeyBundle(updated));
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Pluff</h1>
          <p>{status}</p>
        </div>
        <label className="relay-input">
          <span>Relay</span>
          <input
            value={relayUrl}
            onChange={(event) => setRelayUrl(event.target.value)}
            spellCheck={false}
          />
        </label>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="section-heading">
            <h2>Identity</h2>
            <button onClick={createIdentity} disabled={busy} title="Create identity">
              <Plus size={18} />
            </button>
          </div>
          <select
            value={activeDid}
            onChange={(event) => setActiveDid(event.target.value)}
            disabled={!accounts.length}
          >
            <option value="">No local identity</option>
            {accounts.map((account) => (
              <option key={account.identity.did} value={account.identity.did}>
                {account.identity.label ?? account.identity.kind} - {shortDid(account.identity.did)}
              </option>
            ))}
          </select>
          {activeAccount ? (
            <div className="identity-block">
              <code>{activeAccount.identity.did}</code>
              <div className="button-row">
                <button onClick={registerIdentity} disabled={busy} title="Register bundle">
                  <ShieldCheck size={18} />
                  <span>Register</span>
                </button>
                <button onClick={rotatePreKeys} disabled={busy} title="Rotate prekeys">
                  <KeyRound size={18} />
                  <span>Keys</span>
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        <section className="composer">
          <div className="section-heading">
            <h2>Compose</h2>
            <button onClick={sendMessage} disabled={busy || !activeAccount} title="Send message">
              <Send size={18} />
            </button>
          </div>
          <label>
            <span>Recipient DID</span>
            <input
              value={recipientDid}
              onChange={(event) => setRecipientDid(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="split-row">
            <label>
              <span>Kind</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as AgentMessageKind)}>
                <option value="task">task</option>
                <option value="status">status</option>
                <option value="tool_request">tool_request</option>
                <option value="tool_result">tool_result</option>
                <option value="note">note</option>
              </select>
            </label>
            <button onClick={() => setBody(DEFAULT_BODY)} disabled={busy} title="Reset payload">
              <RefreshCcw size={18} />
            </button>
          </div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck={false}
          />
        </section>

        <section className="inbox">
          <div className="section-heading">
            <h2>Inbox</h2>
            <button onClick={fetchInbox} disabled={busy || !activeAccount} title="Fetch inbox">
              <Inbox size={18} />
            </button>
          </div>
          {inbox.length === 0 ? (
            <div className="empty-state">
              <Check size={18} />
              <span>Clear</span>
            </div>
          ) : (
            <div className="message-list">
              {inbox.map((item) => (
                <article key={item.envelopeId} className="message-card">
                  <header>
                    <strong>{item.message.kind}</strong>
                    <code>{shortDid(item.senderDid)}</code>
                  </header>
                  <pre>{JSON.stringify(item.message.body, null, 2)}</pre>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function shortDid(did: string): string {
  return did.length > 24 ? `${did.slice(0, 14)}...${did.slice(-8)}` : did;
}

