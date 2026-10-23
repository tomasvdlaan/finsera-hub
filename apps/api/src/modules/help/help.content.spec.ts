import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@platform/contracts';
import { billingManifest } from '../billing/billing.manifest.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { insightsManifest } from '../insights/insights.manifest.js';
import { meetingsManifest } from '../meetings/meetings.manifest.js';
import { portalManifest } from '../portal/portal.manifest.js';
import { reportingManifest } from '../reporting/reporting.manifest.js';
import { salesManifest } from '../sales/sales.manifest.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { timeManifest } from '../time/time.manifest.js';
import { whiteboardManifest } from '../whiteboard/whiteboard.manifest.js';
import { coreManifest } from '../../shell/shell.manifest.js';
import { helpManifest } from './help.manifest.js';
import { assemble, HelpService } from './help.service.js';
import type { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { loadGuides } from './help.content.js';

/**
 * The guard on the half of Help that people write.
 *
 * Reference pages cannot drift, because they are the manifests. Guides can, and prose cannot
 * be tested for truth — so this tests what *can* be: that nothing a manifest declares is left
 * without a page that claims it, and that nothing a page claims has stopped existing. A new
 * screen therefore cannot ship without somebody at least deciding which page explains it.
 *
 * Add a manifest to the registry below when a module is added to `app.module.ts`; the test
 * that follows it fails until the module has a Help overview.
 */
const MANIFESTS: ModuleManifest[] = [
  coreManifest,
  crmManifest,
  timeManifest,
  docsManifest,
  scrumManifest,
  billingManifest,
  salesManifest,
  reportingManifest,
  insightsManifest,
  meetingsManifest,
  portalManifest,
  whiteboardManifest,
  helpManifest,
];

/** The shell's own manifest is named `core`; its Help folder is `shell`. */
const helpModuleOf = (manifestName: string) => (manifestName === 'core' ? 'shell' : manifestName);

/** `/clients/:id` and `/clients/:clientId` are the same page. */
const normalise = (p: string) => p.replace(/:[A-Za-z_]+/g, ':_').replace(/\/+$/, '') || '/';

const guides = loadGuides();
const { pages } = assemble(MANIFESTS, guides);

describe('help guides', () => {
  it('parse, and every one has the fields the viewer and search rely on', () => {
    expect(guides.length).toBeGreaterThan(0);
    for (const g of guides) {
      expect(g.updated, `${g.slug} needs an "updated" date`).toBeTruthy();
      expect(g.body.length, `${g.slug} is empty`).toBeGreaterThan(40);
    }
  });

  it('start with a top-level page', () => {
    expect(pages.has('index')).toBe(true);
  });

  it('give every module an overview', () => {
    const missing = MANIFESTS.map((m) => helpModuleOf(m.name)).filter((m) => !pages.has(`${m}/index`));
    expect(missing, `No Help overview (content/<module>/index.md) for: ${missing.join(', ')}`).toEqual([]);
  });

  it('belong to a real module', () => {
    const known = new Set(MANIFESTS.map((m) => helpModuleOf(m.name)));
    const bad = guides.filter((g) => !known.has(g.module)).map((g) => `${g.slug} → ${g.module}`);
    expect(bad).toEqual([]);
  });

  it('live in the folder of the module they say they belong to', () => {
    const bad = guides
      .filter((g) => g.slug !== 'index' && g.slug.split('/')[0] !== g.module)
      .map((g) => `${g.slug} says module: ${g.module}`);
    // `billing/money-hub` is the one documented exception pattern: a page may sit in a
    // module's folder and still be about it. Anything else is a typo in one of the two.
    expect(bad).toEqual([]);
  });

  it('claim every screen a manifest puts in the rail or gives a record', () => {
    const claimed = new Set(guides.flatMap((g) => g.paths.map(normalise)));
    const unclaimed: string[] = [];
    for (const m of MANIFESTS) {
      for (const n of m.navigation) {
        if (!claimed.has(normalise(n.path))) unclaimed.push(`${m.name}: ${n.label} (${n.path})`);
      }
      for (const e of m.entities) {
        if (!claimed.has(normalise(e.urlPattern))) unclaimed.push(`${m.name}: ${e.type} (${e.urlPattern})`);
      }
    }
    expect(
      unclaimed,
      `These screens are in a manifest but no Help page lists their address in \`paths\`.\n` +
        `Write a page for each (or add the path to the page that covers it):\n  ${unclaimed.join('\n  ')}`,
    ).toEqual([]);
  });

  it('only name capabilities that exist', () => {
    const real = new Set(MANIFESTS.flatMap((m) => m.permissions.map((p) => p.capability)));
    const bad = guides
      .filter((g) => g.capability && !real.has(g.capability))
      .map((g) => `${g.slug} → ${g.capability}`);
    expect(bad).toEqual([]);
  });

  it('only link to pages that exist', () => {
    const bad: string[] = [];
    for (const p of pages.values()) {
      for (const m of p.body.matchAll(/\]\(help:([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (!pages.has(m[1] ?? '')) bad.push(`${p.slug} → help:${m[1]}`);
      }
    }
    expect(bad, `Broken help: links:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});

describe('generated reference', () => {
  it('lists every capability, rail page and assistant tool in the manifests', () => {
    const permissions = pages.get('reference/permissions')?.body ?? '';
    const rail = pages.get('reference/pages')?.body ?? '';
    const assistant = pages.get('reference/assistant')?.body ?? '';

    for (const m of MANIFESTS) {
      for (const p of m.permissions) expect(permissions, p.capability).toContain(`\`${p.capability}\``);
      for (const n of m.navigation) expect(rail, n.path).toContain(`\`${n.path}\``);
      for (const t of m.aiTools) {
        if (t.riskClass !== 'restricted') expect(assistant, t.name).toContain(`\`${t.name}\``);
      }
    }
  });
});

describe('search over the real pages', () => {
  const { index } = assemble(MANIFESTS, guides);
  const top = (q: string) => index.search(q, 6).map((h) => h.slug);

  it.each([
    ['how do I send an invoice', 'billing/issue-invoice'],
    ['approve a colleague\'s week', 'time/approve-weeks'],
    ['start a timer', 'time/run-a-clock'],
    ['invite a client to the portal', 'portal/portal-logins'],
    ['who can see the costs page', 'shell/costs'],
  ])('answers "%s" from %s', (q, slug) => {
    expect(top(q)).toContain(slug);
  });
});

describe('finding a page by whatever the assistant passes', () => {
  const svc = new HelpService({ all: () => MANIFESTS } as unknown as ManifestRegistry);

  it.each([
    'time/approve-weeks',
    '/time/approve-weeks',
    'help:time/approve-weeks',
    'time/approve-weeks.md',
    'Approve or send back a week',
  ])('resolves %s', (ref) => {
    expect(svc.find(ref)?.slug).toBe('time/approve-weeks');
  });

  it('returns null for a page that does not exist', () => {
    expect(svc.find('time/nonsense')).toBeNull();
  });
});
