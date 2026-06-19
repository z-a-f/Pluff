import {
  bodyToAuthString,
  canonicalJson,
  publicIdentity,
  signRelayRequest,
  type EncryptedEnvelope,
  type LocalIdentity,
  type LocalOneTimePreKey,
  type LocalSignedPreKey,
  type PreKeyBundle,
  type PreKeyClaim,
  type PublicIdentity,
} from "@pluff/protocol";
import type {
  RegistrationResult,
  RelayClientOptions,
  StoredEnvelope,
} from "./types.js";

export class RelayClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RelayClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async registerBundle(bundle: PreKeyBundle): Promise<RegistrationResult> {
    return this.request<RegistrationResult>({
      method: "POST",
      path: "/v1/identities",
      body: bundle,
    });
  }

  async resolveIdentity(did: string): Promise<PublicIdentity> {
    return this.request<PublicIdentity>({
      method: "GET",
      path: `/v1/identities/${encodeURIComponent(did)}`,
    });
  }

  async getPreKeyBundle(did: string): Promise<PreKeyBundle> {
    return this.request<PreKeyBundle>({
      method: "GET",
      path: `/v1/identities/${encodeURIComponent(did)}/bundle`,
    });
  }

  async claimPreKey(recipientDid: string, requester: LocalIdentity): Promise<PreKeyClaim> {
    return this.request<PreKeyClaim>({
      method: "POST",
      path: `/v1/prekeys/${encodeURIComponent(recipientDid)}/claim`,
      body: { requesterDid: requester.did },
      identity: requester,
    });
  }

  async submitEnvelope(
    envelope: EncryptedEnvelope,
    sender: LocalIdentity,
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>({
      method: "POST",
      path: "/v1/envelopes",
      body: envelope,
      identity: sender,
    });
  }

  async listEnvelopes(
    recipientDid: string,
    recipient: LocalIdentity,
  ): Promise<StoredEnvelope[]> {
    return this.request<StoredEnvelope[]>({
      method: "GET",
      path: `/v1/envelopes?recipientDid=${encodeURIComponent(recipientDid)}`,
      identity: recipient,
    });
  }

  async ackEnvelope(
    id: string,
    recipient: LocalIdentity,
  ): Promise<{ id: string; ackedAt: string }> {
    return this.request<{ id: string; ackedAt: string }>({
      method: "POST",
      path: `/v1/envelopes/${encodeURIComponent(id)}/ack`,
      body: { recipientDid: recipient.did },
      identity: recipient,
    });
  }

  private async request<T>(input: {
    method: string;
    path: string;
    body?: unknown;
    identity?: LocalIdentity;
  }): Promise<T> {
    const url = new URL(input.path, this.baseUrl);
    const body = input.body === undefined
      ? undefined
      : canonicalJson(input.body as Parameters<typeof canonicalJson>[0]);
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (input.identity) {
      Object.assign(
        headers,
        signRelayRequest({
          identity: input.identity,
          method: input.method,
          path: `${url.pathname}${url.search}`,
          body: bodyToAuthString(body),
        }),
      );
    }

    const response = await this.fetchImpl(url, {
      method: input.method,
      headers,
      body,
    });
    const responseText = await response.text();
    const payload = responseText ? JSON.parse(responseText) : undefined;
    if (!response.ok) {
      const message = payload?.error ?? response.statusText;
      throw new Error(`Relay request failed: ${message}`);
    }
    return payload as T;
  }
}

export function createPreKeyBundle(input: {
  identity: LocalIdentity;
  signedPreKey: LocalSignedPreKey;
  oneTimePreKeys: LocalOneTimePreKey[];
}): PreKeyBundle {
  return {
    identity: publicIdentity(input.identity),
    signedPreKey: input.signedPreKey.publicKey,
    oneTimePreKeys: input.oneTimePreKeys.map((key) => key.publicKey),
  };
}

