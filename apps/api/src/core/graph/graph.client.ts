import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Token refreshed this long before it actually expires, so a call never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * How many Graph calls may be in flight at once.
 *
 * Throttling quotas for an app-only credential are per-app-per-tenant, so the thing that
 * trips them is us doing something in bulk, not a user clicking. Four is slow enough to
 * stay under and fast enough that nobody notices.
 */
const MAX_CONCURRENT = 4;

/** Attempts per call, including the first. Three is enough for a blip and short of a storm. */
const MAX_ATTEMPTS = 3;

/**
 * One way in to Microsoft Graph (decision D8).
 *
 * App-only client credentials against one SharePoint site granted with `Sites.Selected`.
 * Not a per-user delegated flow: the identity provider here is Zitadel, an `Actor.userId` is
 * a Zitadel subject rather than an Entra object id, and the two writers that file invoice and
 * quote PDFs run with no user token in hand. Delegated would have meant a second identity
 * provider in the login path, a Zitadel-to-Entra mapping and a refresh-token store — and an
 * app-only credential anyway for those two.
 *
 * No Graph SDK, for the same reason `ZitadelClient` has no Zitadel SDK: client credentials is
 * one POST and every call after it is `fetch` with a bearer. The rule is "no vendor SDK
 * outside core", and honouring it by putting a large vendor SDK inside core misses the point.
 *
 * Nothing here reaches the network at boot. The API has to start during a tenant outage, and
 * an unset credential has to leave the rest of the platform working — so `configured` is a
 * property, not a probe, and callers ask it so a screen can explain its own absence rather
 * than offer a button that fails on the click.
 */
@Injectable()
export class GraphClient {
  private readonly logger = new Logger(GraphClient.name);

  /** The live token, or null. In memory only: it is short-lived and re-fetchable. */
  private token: { value: string; expiresAt: number } | null = null;

  /**
   * The refresh in progress.
   *
   * Ten concurrent uploads finding an expired token must produce one token request, not ten.
   * Holding the promise rather than a lock means the losers await the winner's result.
   */
  private refreshing: Promise<string> | null = null;

  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  /** Last thing that went wrong, for the health endpoint. Not an error channel. */
  private lastError: string | null = null;

  get tenantId(): string {
    return process.env.GRAPH_TENANT_ID ?? '';
  }
  get clientId(): string {
    return process.env.GRAPH_CLIENT_ID ?? '';
  }
  private get clientSecret(): string {
    return process.env.GRAPH_CLIENT_SECRET ?? '';
  }
  get siteId(): string {
    return process.env.GRAPH_SITE_ID ?? '';
  }

  /** Whether anything can be asked of it at all. */
  get configured(): boolean {
    return Boolean(this.tenantId && this.clientId && this.clientSecret && this.siteId);
  }

  /** Why it is not configured, in the words of whoever has to fix it. */
  get unconfiguredReason(): string | null {
    if (!this.tenantId) return 'GRAPH_TENANT_ID is not set';
    if (!this.clientId) return 'GRAPH_CLIENT_ID is not set';
    if (!this.clientSecret) {
      return 'GRAPH_CLIENT_SECRET is not set — create the Entra app registration, grant it ' +
        'Sites.Selected, grant that app write on the documents site only, and put the ' +
        'secret in deploy/.env';
    }
    if (!this.siteId) {
      return 'GRAPH_SITE_ID is not set — the composite id from ' +
        'GET /sites/{host}:/sites/{path}, of the form "host,siteCollectionId,siteId"';
    }
    return null;
  }

  get lastFailure(): string | null {
    return this.lastError;
  }

  /**
   * One Graph call, with the error the operator needs rather than the one the client sees.
   *
   * `idempotent` defaults to true because almost everything here is a GET or a PUT to a known
   * path. It must be passed false for an upload-session commit: retrying one blindly can
   * commit the same chunk range twice, and the failure that follows is much harder to read
   * than the one that caused the retry.
   */
  async call<T>(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; idempotent?: boolean } = {},
  ): Promise<T> {
    const res = await this.raw(method, path, init);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** As `call`, but the caller wants the Response — bytes, or a redirect it will follow. */
  async raw(
    method: string,
    path: string,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      idempotent?: boolean;
      redirect?: 'manual' | 'follow' | 'error';
      /** Statuses the caller expects and will read itself — a 404 that means "not there". */
      tolerate?: number[];
    } = {},
  ): Promise<Response> {
    if (!this.configured) {
      throw new ServiceUnavailableException(`Graph is not configured: ${this.unconfiguredReason}`);
    }

    const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
    const idempotent = init.idempotent ?? true;

    await this.acquire();
    try {
      let lastStatus = 0;
      let lastDetail = '';

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const token = await this.accessToken();
        const isBuffer = Buffer.isBuffer(init.body);

        let res: Response;
        try {
          res = await fetch(url, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(init.body === undefined || isBuffer
                ? {}
                : { 'Content-Type': 'application/json' }),
              ...(init.headers ?? {}),
            },
            ...(init.body === undefined
              ? {}
              : { body: isBuffer ? (init.body as Buffer) : JSON.stringify(init.body) }),
            ...(init.redirect ? { redirect: init.redirect } : {}),
          });
        } catch (err) {
          // A transport failure is worth one more try; a wall of them is not.
          lastStatus = 0;
          lastDetail = (err as Error).message;
          if (attempt < MAX_ATTEMPTS && idempotent) {
            await sleep(backoffMs(attempt));
            continue;
          }
          this.lastError = `Could not reach Graph (${method} ${path}): ${lastDetail}`;
          throw new ServiceUnavailableException(this.lastError);
        }

        if (res.ok || (res.status >= 300 && res.status < 400)) {
          this.lastError = null;
          return res;
        }

        // An expected status is an answer, not a failure: "no such folder" is how we learn
        // we have to make one. Returned unretried and without touching lastError.
        if ((init.tolerate ?? []).includes(res.status)) return res;

        // An expired-looking 401 is worth exactly one fresh token; a second means the
        // credential is wrong, and retrying a wrong credential is how you get locked out.
        if (res.status === 401 && attempt === 1) {
          this.token = null;
          lastStatus = 401;
          lastDetail = (await res.text()).slice(0, 400);
          continue;
        }

        const retryable = res.status === 429 || res.status === 503 || res.status === 509;
        lastStatus = res.status;
        lastDetail = (await res.text()).slice(0, 400);

        if (retryable && attempt < MAX_ATTEMPTS && idempotent) {
          // Honour Retry-After exactly when Microsoft sends it. It is not a suggestion:
          // ignoring it is how a throttle becomes a longer throttle.
          const after = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoffMs(attempt));
          continue;
        }
        break;
      }

      this.lastError = `Graph refused ${method} ${path} (${lastStatus}): ${lastDetail}`;
      this.logger.warn(this.lastError);
      throw new ServiceUnavailableException(this.lastError);
    } finally {
      this.release();
    }
  }

  /** A live bearer token, fetching one only when there is not a usable one already. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.refreshing) return this.refreshing;

    this.refreshing = this.fetchToken().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async fetchToken(): Promise<string> {
    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      this.lastError = `Could not reach Entra for a token: ${(err as Error).message}`;
      throw new ServiceUnavailableException(this.lastError);
    }

    const text = await res.text();
    if (!res.ok) {
      // Entra's error body names the actual problem — a wrong secret, an expired secret, a
      // consent that was never granted. A generic "unavailable" here costs an afternoon.
      this.lastError = `Entra refused the client credentials (${res.status}): ${text.slice(0, 400)}`;
      this.logger.warn(this.lastError);
      throw new ServiceUnavailableException(this.lastError);
    }

    const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) {
      this.lastError = 'Entra returned no access_token';
      throw new ServiceUnavailableException(this.lastError);
    }

    const ttlMs = (parsed.expires_in ?? 3600) * 1000;
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + Math.max(ttlMs - EXPIRY_SKEW_MS, 0),
    };
    return parsed.access_token;
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
    this.waiting.shift()?.();
  }
}

/** Exponential with jitter. The jitter is what stops four callers retrying in lockstep. */
function backoffMs(attempt: number): number {
  return 2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
