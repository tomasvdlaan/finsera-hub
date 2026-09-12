/**
 * Who is looking at a portal, as types only.
 *
 * These live apart from `portal.projection.ts` because the projection holds a
 * `PortalAccessService`, and that service has to talk about viewers too. With the types on
 * the projection, the two files import each other and the module graph is no longer acyclic
 * — which `pnpm boundaries` rejects, and rightly: a cycle is the shape in which Nest's
 * injector and node's module loader disagree at boot. A viewer is not a projection concept
 * anyway; it is what both of them are given.
 *
 * The projection re-exports everything here, so `from './portal.projection.js'` keeps
 * working and no caller has to know this file exists.
 */

/**
 * Whose data a projection query is about.
 *
 * Narrower than `PortalVisitor` because there are two legitimate callers and only one of
 * them is a visitor: a signed-in client, and an internal preview of what that client sees.
 * The projection's job is "show exactly this client's data"; deciding *which* client is
 * allowed is the caller's, and there are exactly two places that decide —
 * `PortalAuthGuard` (from an invitation) and `PortalPreviewController` (from an internal
 * capability, audited). Anything else passing a clientId here is a bug.
 */
export interface PortalAudience {
  clientId: string;
}

/**
 * A signed-in client, resolved from an invitation.
 *
 * Deliberately not an `Actor`. An Actor is an internal identity with capabilities, and
 * accepting one on the client path would make it possible to serve internal data through
 * a portal endpoint by passing the wrong object. A different type makes that a compile
 * error.
 */
export interface PortalVisitor extends PortalAudience {
  portalUserId: string;
  email: string;
  /** What to call them on their own front page. Null until they have a name on file. */
  displayName?: string | null;
  /** When they were last here, *before* this visit. Null on a first sign-in. */
  previousSeenAt?: Date | null;
  /**
   * Whether the money sections are theirs to see.
   *
   * Required rather than optional, so that every place a visitor is constructed has to say
   * what this person may see. An optional flag defaulting to `true` would mean a caller that
   * forgot it hands out a visitor who sees the invoices, and "forgot" is the failure mode
   * this pair of columns exists to survive.
   */
  seesInvoices: boolean;
  seesQuotes: boolean;
}

/**
 * One of us, looking at a client's portal (Phase 8, P5).
 *
 * Deliberately not a `PortalVisitor`, for the same reason a visitor is not an `Actor`: the
 * two are allowed different things, and a different type makes passing the wrong one a
 * compile error rather than a policy someone has to remember. A staff viewer may read
 * everything the client can read — that is what "see what they see" means — and may not
 * *act* as them, because accepting a quote is a statement by the client. The routes that
 * write ask for a `PortalVisitor`, so they refuse staff by construction.
 *
 * It carries a `core.users` id, so a staff read is audited under a real internal identity
 * and "who looked at Duce's portal" has an answer.
 */
export interface PortalStaff extends PortalAudience {
  staffUserId: string;
  email: string;
}

/** Anyone with a portal session. Enough to read; not necessarily enough to write. */
export type PortalViewer = PortalVisitor | PortalStaff;
