import { defineManifest } from '@platform/contracts';

/**
 * The portal owns logins, not data.
 *
 * Everything a client sees belongs to another module and is read through the projection.
 * That is why this manifest is nearly empty, and the emptiness is the point: a portal with
 * its own entities would become a second source of truth about a client's money.
 *
 * Note what is absent. No `portalExposure` — the portal does not get to decide what it may
 * show itself; the owning module decides, and the projection refuses anything undeclared.
 * No `aiTools`, so no assistant can reach portal internals (the roadmap's portal assistant
 * is deliberately not in this cut) — and, more pointedly, so nothing a client typed into a
 * request form can be read by the assistant as though we had written it.
 *
 * The navigation entry is for the internal side only: triaging what clients have asked
 * for. The portal itself remains a separate front end for a different audience, not a page
 * in this shell.
 */
export const portalManifest = defineManifest({
  name: 'portal',
  version: '0.1.0',

  entities: [
    {
      type: 'portal_user',
      displayTemplate: '{email}',
      // Their own page, which is new. This used to point at the client, from the days when a
      // portal login was a row on somebody else's screen rather than a person with an
      // account, artefacts of their own and a sign-in history.
      urlPattern: '/portal/users/:id',
      // Granting a client a login is the one capability members do not hold by default, so
      // the list of who has one is admin-only to see as well.
      readPermission: 'portal.admin',
    },
  ],
  structuralRefs: [],
  publishes: [
    {
      name: 'portal.signed_in',
      description:
        'Somebody opened a client portal — the client themselves, or one of us looking at ' +
        'theirs. Recorded against the client, so it appears on their timeline.',
    },
    /*
     * The two facts that make a ticket somebody's business.
     *
     * Until these existed, a client could open a ticket and nothing in the product said so:
     * no timeline entry, no count, nothing a rule could act on. Both name the client and
     * carry the ticket id — and the opening one the subject, because a notification without
     * one is a notification nobody acts on. Never the message body; see the service.
     *
     * There is deliberately no event for *our* replies. It is not news to us that we
     * answered, and a second event would make "who is waiting" the harder question.
     */
    {
      name: 'portal.ticket_opened',
      description:
        'A client opened a ticket in their portal. Recorded against the client, with the ' +
        'ticket id and its subject.',
    },
    {
      name: 'portal.ticket_replied',
      description:
        'A client replied on one of their own tickets, so it is waiting on us again. ' +
        'Recorded against the client, with the ticket id.',
    },
  ],
  subscribes: [],

  permissions: [
    {
      capability: 'portal.admin',
      description: 'Invite a client login, revoke one, and restore a revoked one.',
      // The one capability that hands data to someone outside the business. Members hold
      // every other declared capability by default; this one they do not.
      adminOnly: true,
    },
    {
      capability: 'portal.tickets',
      description: 'Read and answer the tickets clients have opened, and triage them.',
      /*
       * Not admin-only, and that is the change.
       *
       * Granting somebody a login is admin work: it hands a person outside the business
       * access to a client's money. *Answering a question a client has already asked* is
       * delivery work, and gating it behind `portal.admin` meant a colleague who opened the
       * inbox got an empty table — which reads as a broken page rather than as a refusal,
       * and made the triage list one person's job by accident.
       */
      adminOnly: false,
    },
  ],

  navigation: [
    { label: 'Client tickets', path: '/portal/tickets', icon: 'inbox', section: 'work', order: 4 },
  ],
  widgets: [{ slot: 'entity-page', component: 'portal:client-tickets' }],
  chatWidgets: [],
  reportingViews: [
    {
      view: 'portal.v_tickets',
      description:
        'Client tickets with status, age in days while waiting on us, who opened it and ' +
        'who owns it. No message bodies.',
    },
  ],
  portalExposure: [],
  aiTools: [],
});
