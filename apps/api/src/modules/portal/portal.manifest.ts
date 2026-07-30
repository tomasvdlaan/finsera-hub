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
      urlPattern: '/settings/portal-users',
    },
  ],
  structuralRefs: [],
  publishes: [],
  subscribes: [],

  permissions: [
    {
      capability: 'portal.admin',
      description: 'Invite a client login, and revoke one.',
      // The one capability that hands data to someone outside the business. Members hold
      // every other declared capability by default; this one they do not.
      adminOnly: true,
    },
  ],

  navigation: [{ label: 'Client requests', path: '/portal/requests', icon: 'inbox', section: 'work', order: 4 }],
  widgets: [],
  chatWidgets: [],
  reportingViews: [],
  portalExposure: [],
  aiTools: [],
});
