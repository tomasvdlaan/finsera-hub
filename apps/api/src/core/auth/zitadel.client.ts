import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * One way in to the identity provider.
 *
 * It lives in core because identity is a core concern and because two callers now need it
 * from opposite sides of a boundary the architecture enforces: the portal creates client
 * logins, and the shell wants to show a colleague's account state on their own page. The
 * shell may not import a module — `shell-no-modules` in the dependency rules — so the choice
 * was a second copy of this or one copy here, and a second copy of a credentialled HTTP
 * client is the kind of duplication that drifts silently until one half stops logging what
 * went wrong.
 *
 * It is also the seam if the provider ever changes. Everything Zitadel-shaped above this —
 * the user search, the role grant, the invite code — is a handful of paths and payloads in
 * two services; everything below is `fetch` with a bearer token.
 */
@Injectable()
export class ZitadelClient {
  private readonly logger = new Logger(ZitadelClient.name);

  get issuer(): string {
    return (process.env.ZITADEL_ISSUER ?? '').replace(/\/$/, '');
  }
  private get token(): string {
    return process.env.ZITADEL_ADMIN_TOKEN ?? '';
  }

  /**
   * Whether anything can be asked of it at all.
   *
   * Read by callers so a screen can explain its own absence rather than offering a button
   * that fails on the click.
   */
  get configured(): boolean {
    return Boolean(this.issuer && this.token);
  }

  /** Why it is not configured, in the words of whoever has to fix it. */
  get unconfiguredReason(): string | null {
    if (!this.issuer) return 'ZITADEL_ISSUER is not set';
    if (!this.token) {
      return 'ZITADEL_ADMIN_TOKEN is not set — create a service user with rights to manage ' +
        'users and grants, give it a personal access token, and put it in deploy/.env';
    }
    return null;
  }

  /**
   * The account with this address, or null.
   *
   * One query shape in one place. It was written out twice — here for a colleague's account
   * panel and again in the portal's invite service, which needs only the id — with the same
   * `TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE`, because an address that differs only in case is the
   * same person and matching exactly would create them a second account.
   */
  async searchByEmail(email: string): Promise<ZitadelUser | null> {
    const body = await this.call<{ result?: ZitadelUser[] }>('POST', '/v2/users', {
      queries: [
        { emailQuery: { emailAddress: email, method: 'TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE' } },
      ],
    });
    return body.result?.[0] ?? null;
  }

  /**
   * One HTTP call, with the error the operator needs rather than the one the client sees.
   *
   * Zitadel answers a bad token with 401 and a bad payload with 400 and a body explaining
   * which field — so the body is logged and summarised into the thrown message. A generic
   * "identity provider unavailable" costs an afternoon of guessing which field was wrong.
   */
  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.issuer}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach Zitadel (${path}): ${(err as Error).message}`,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      // Truncated: a Zitadel error body is small, but this ends up in an audit log and on a
      // screen, and an unbounded remote string does not belong in either.
      const detail = text.slice(0, 400);
      this.logger.warn(`Zitadel ${method} ${path} → ${res.status}: ${detail}`);
      throw new ServiceUnavailableException(`Zitadel refused ${path} (${res.status}): ${detail}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** What the provider knows about one person, as a screen needs to read it. */
export interface IdentityAccount {
  userId: string;
  /** `USER_STATE_ACTIVE` and friends, reduced to the two states anybody acts on. */
  active: boolean;
  loginNames: string[];
  emailVerified: boolean;
  /** When a password was last set. Null means never — the invitation is still outstanding. */
  passwordChangedAt: string | null;
  createdAt: string | null;
  /** Their page in the provider's own console, for everything this screen will not do. */
  consoleUrl: string;
}

/**
 * A colleague's account at the identity provider, read only.
 *
 * The hub owns what somebody may do here — their role, their departments, their contract —
 * and the provider owns whether they can sign in at all. Those were two screens in two
 * different applications, so "why can this person not log in" meant leaving the hub, finding
 * them again in a console, and knowing what to look at.
 *
 * Read only, deliberately. Everything that changes an account — a password reset, a new
 * activation mail, deactivating somebody — is a write into the identity provider with its own
 * blast radius, and each deserves its own decision rather than arriving as a side effect of
 * putting a status on a page. The link out is the honest answer until then.
 */
@Injectable()
export class IdentityDirectory {
  constructor(private readonly zitadel: ZitadelClient) {}

  get configured(): boolean {
    return this.zitadel.configured;
  }

  /**
   * Null when the provider has never heard of this address.
   *
   * Which is a real answer and not an error: a colleague added to the hub before their
   * account exists is an ordinary state, and the page says so rather than failing.
   */
  async accountFor(email: string): Promise<IdentityAccount | null> {
    if (!this.zitadel.configured || !email) return null;

    const user = await this.zitadel.searchByEmail(email);
    if (!user) return null;

    return {
      userId: user.userId,
      active: user.state === 'USER_STATE_ACTIVE',
      loginNames: user.loginNames ?? [],
      emailVerified: user.human?.email?.isVerified === true,
      passwordChangedAt: user.human?.passwordChanged ?? null,
      createdAt: user.details?.creationDate ?? null,
      consoleUrl: `${this.zitadel.issuer}/ui/console/users/${user.userId}`,
    };
  }
}

/** Only the fields anything here reads; Zitadel's payload is much larger. */
export interface ZitadelUser {
  userId: string;
  state?: string;
  loginNames?: string[];
  details?: { creationDate?: string };
  human?: { email?: { isVerified?: boolean }; passwordChanged?: string };
}
