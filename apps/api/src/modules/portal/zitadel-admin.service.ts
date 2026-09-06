import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PORTAL_ROLE } from '../../core/auth/roles.js';

/**
 * What an invitation is once it exists: a link, and when it stops working.
 *
 * The code itself never leaves this file except inside the URL. It is a single-use secret
 * that sets somebody's first password, so it is not logged, not stored, and not returned as
 * a field anybody could accidentally render next to an email address.
 */
export interface PortalInvite {
  url: string;
  /** The Zitadel account the link belongs to, so a re-issue knows who to ask about. */
  zitadelUserId: string;
}

/**
 * The Zitadel management calls that give a client a login.
 *
 * Everything else in this platform reads Zitadel through a token somebody presented. This is
 * the one place that acts *as* the organisation — creating an account, granting it a role —
 * so it is deliberately small, deliberately separate, and refuses to do anything at all
 * unless `ZITADEL_ADMIN_TOKEN` is set. A platform that half-works without its credential is
 * how a missing secret turns into a mystery instead of a message.
 *
 * Nothing here sends email. Zitadel's own invitation mail is what put a client on the wrong
 * host in the first place, and the point of `returnCode` is that the link comes back to us:
 * it goes out in a message somebody writes, from an address the client recognises.
 */
@Injectable()
export class ZitadelAdminService {
  private readonly logger = new Logger(ZitadelAdminService.name);

  private get issuer(): string {
    return (process.env.ZITADEL_ISSUER ?? '').replace(/\/$/, '');
  }
  private get token(): string {
    return process.env.ZITADEL_ADMIN_TOKEN ?? '';
  }
  private get projectId(): string {
    return process.env.ZITADEL_PROJECT_ID ?? '';
  }
  private get organisationId(): string {
    return process.env.ZITADEL_ORG_ID ?? '';
  }

  /**
   * Whether a login can be created from here at all.
   *
   * Read by the caller so the screen can offer the button or explain its absence, rather
   * than offering it and failing on the click.
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
   * Create the account if it does not exist, grant it the portal role, and mint a link.
   *
   * Idempotent on purpose rather than transactional. There is no rollback across three HTTP
   * calls to somebody else's system, and the failure that matters — an account created and
   * then not granted — is repaired by pressing the button again: an existing address is
   * found rather than refused, a grant that exists is left alone, and a fresh code replaces
   * the last one. Deleting a half-made account to "clean up" would be the destructive
   * reading of the same problem.
   */
  async inviteToPortal(input: {
    email: string;
    displayName?: string;
  }): Promise<PortalInvite> {
    this.assertConfigured();

    const existing = await this.findByEmail(input.email);
    const zitadelUserId = existing ?? (await this.createUser(input));
    if (existing) {
      this.logger.log(`Zitadel already knows ${input.email}; re-using that account`);
    }

    await this.grantPortalRole(zitadelUserId);
    const code = await this.createInviteCode(zitadelUserId);

    return { url: this.inviteUrl(zitadelUserId, code), zitadelUserId };
  }

  /**
   * A fresh link for an account that already exists.
   *
   * Creating a new code invalidates the previous one — Zitadel's rule, not ours — so this is
   * "the last link is lost or expired", never "give me a second copy". The screen says so,
   * because a colleague resending to be helpful would silently break the link the client is
   * about to click.
   */
  async reissue(zitadelUserId: string): Promise<PortalInvite> {
    this.assertConfigured();
    const code = await this.createInviteCode(zitadelUserId);
    return { url: this.inviteUrl(zitadelUserId, code), zitadelUserId };
  }

  /** The account with this address, or null. */
  async findByEmail(email: string): Promise<string | null> {
    const body = await this.call<{ result?: Array<{ userId: string }> }>('POST', '/v2/users', {
      queries: [{ emailQuery: { emailAddress: email, method: 'TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE' } }],
    });
    return body.result?.[0]?.userId ?? null;
  }

  private async createUser(input: { email: string; displayName?: string }): Promise<string> {
    const [given, ...rest] = (input.displayName ?? input.email.split('@')[0] ?? 'Client').split(' ');
    const body = await this.call<{ userId: string }>('POST', '/v2/users/human', {
      username: input.email,
      profile: {
        givenName: given || input.email,
        // Zitadel requires a family name. An address with no name behind it gets the
        // address, which is at least true, rather than a placeholder that looks like data.
        familyName: rest.join(' ') || input.email,
      },
      email: {
        email: input.email,
        /*
         * The verification code comes back to us and is thrown away.
         *
         * Every other option sends mail: `sendCode` emails a verification link, and omitting
         * the field entirely makes Zitadel do the same by default — which is the mail this
         * whole feature exists to replace. Accepting the invitation is what verifies the
         * address, and the invitation is the link we hand over.
         */
        returnCode: {},
      },
      ...(this.organisationId ? { organization: { orgId: this.organisationId } } : {}),
    });
    this.logger.log(`Created Zitadel account ${body.userId} for ${input.email}`);
    return body.userId;
  }

  /**
   * The `portal_client` grant, without which the login is refused at gate two.
   *
   * A grant that already exists comes back as an "already exists" error, which is success
   * for our purposes: this is the state we wanted, and treating it as a failure would make
   * the repeat press of the button — the one thing that fixes a half-made invitation —
   * report an error instead.
   */
  private async grantPortalRole(userId: string): Promise<void> {
    if (!this.projectId) {
      throw new ServiceUnavailableException(
        'ZITADEL_PROJECT_ID is not set, so the portal role cannot be granted — the login ' +
          'would be refused with "Geen toegang"',
      );
    }
    try {
      await this.call('POST', `/management/v1/users/${userId}/grants`, {
        projectId: this.projectId,
        roleKeys: [PORTAL_ROLE],
      });
    } catch (err) {
      const message = (err as Error).message;
      if (/already exists|AlreadyExists/i.test(message)) return;
      throw err;
    }
  }

  private async createInviteCode(userId: string): Promise<string> {
    const body = await this.call<{ inviteCode: string }>(
      'POST',
      `/v2/users/${userId}/invite_code`,
      // `returnCode` rather than `sendCode`: the whole point is that the link comes back
      // here so a person can put it in their own message.
      { returnCode: {} },
    );
    if (!body.inviteCode) {
      throw new ServiceUnavailableException('Zitadel returned no invitation code');
    }
    return body.inviteCode;
  }

  /**
   * The address on the link.
   *
   * Zitadel hosts the page that takes a first password, so we never handle one — and the
   * shape of that URL is Zitadel's, not ours, which is why it is a template rather than a
   * string built in code. Verify it once against a real invitation (send one with `sendCode`
   * and read the link in the mail) and set `ZITADEL_INVITE_URL` if this default is wrong for
   * your version; a link that 404s is the one failure a client cannot work around.
   */
  private inviteUrl(userId: string, code: string): string {
    /*
     * Where a client lands *after* this page is not ours to decide.
     *
     * It is Zitadel's "Default Redirect URI" — Settings → Login Behavior and Security —
     * which is where the login sends anyone whose auth request context is absent, and
     * Zitadel's own docs name activation mail as one of the ways that happens. Its default
     * is the management console, which is exactly where a registering client ended up.
     *
     * An attempt was made to solve this in code, by minting an auth request here and putting
     * it on the link. It cannot work: `/oauth/v2/authorize` sets `__Host-zitadel.useragent`
     * and binds the request to the browser that asked for it, so a request made by this
     * server belongs to this server, and the client's browser arrives holding nothing.
     * Reverted rather than left in place, because a mechanism that cannot work is worse than
     * none — it looks like the thing that handles this.
     *
     * The address itself is the v2 page. Both UIs answer 200 on this instance, which is how
     * the v1 default went unnoticed, but authorize hands out `V2_` requests destined for
     * `/ui/v2/login` and that is the UI in use.
     */
    const template =
      process.env.ZITADEL_INVITE_URL ||
      `${this.issuer}/ui/v2/login/verify?userId={userId}&code={code}&invite=true`;
    return template
      .replace('{userId}', encodeURIComponent(userId))
      .replace('{code}', encodeURIComponent(code))
      .replace('{orgId}', encodeURIComponent(this.organisationId));
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(this.unconfiguredReason ?? 'Zitadel is not configured');
    }
  }

  /**
   * One HTTP call, with the error the operator needs rather than the one the client sees.
   *
   * Zitadel answers a bad token with 401 and a bad payload with 400 and a body explaining
   * which field — so the body is logged and summarised into the thrown message. A generic
   * "request failed" here would mean reading somebody else's server logs to learn that a
   * family name was missing.
   */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
