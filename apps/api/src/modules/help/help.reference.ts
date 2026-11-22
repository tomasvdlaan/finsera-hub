import type { ModuleManifest, RiskClass } from '@platform/contracts';
import type { HelpPage } from './help.content.js';

/**
 * The reference half of Help: pages nobody writes.
 *
 * Everything here is read off the module manifests, which are the one place the platform
 * already has to say what it contains — a capability that is not declared is not enforced,
 * a tool that is not declared is not offered, a rail entry that is not declared is not shown.
 * Documenting from them means the reference cannot disagree with the product, and a new
 * module appears in Help by being registered, not by somebody remembering.
 *
 * `core` is the shell's own manifest, and is shown as "Platform" because "core" means
 * something to the people who built it and nothing to anybody else.
 */

const SECTION_LABEL: Record<string, string> = {
  today: 'Today',
  time: 'Time',
  money: 'Money',
  clients: 'Clients',
  work: 'Work',
  record: 'Record',
  setup: 'Setup',
  more: 'More',
};

const RISK_MEANING: Record<RiskClass, string> = {
  read: 'looks things up, runs without asking',
  'write:draft': 'makes a change and shows you what it did',
  'write:commit': 'asks you to confirm before it does anything',
  restricted: 'never done by the assistant; you do it yourself',
};

export function moduleLabel(name: string): string {
  if (name === 'core') return 'Platform';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** 'time:project-burn' → 'Project burn'. The keys are all the manifest knows about a block. */
function humanizeWidget(key: string): string {
  const name = key.split(':').pop() ?? key;
  const spaced = name.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Tool descriptions are written for a model and run long; the first sentence is for people. */
function firstSentence(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const s = end > 0 ? flat.slice(0, end + 1) : flat;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const byName = (a: ModuleManifest, b: ModuleManifest) => a.name.localeCompare(b.name);

function page(
  slug: string,
  title: string,
  summary: string,
  keywords: string[],
  body: string,
): HelpPage {
  return { slug: `reference/${slug}`, title, summary, module: 'help', paths: [], keywords, kind: 'reference', body };
}

export function buildReference(manifests: ModuleManifest[]): HelpPage[] {
  const mods = [...manifests].sort(byName);
  const pages: HelpPage[] = [];

  /* ---- every page in the rail ---- */
  {
    const out: string[] = [
      'Every screen the platform declares, grouped by module. Pages marked *from a hub* are reached from another page rather than the left rail, but the address works.',
    ];
    for (const m of mods) {
      if (m.navigation.length === 0) continue;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| Page | Address | Rail section |', '|---|---|---|');
      for (const n of [...m.navigation].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))) {
        const where = n.hidden ? 'from a hub' : SECTION_LABEL[n.section ?? 'more'];
        out.push(`| ${n.label} | \`${n.path}\` | ${where} |`);
      }
    }
    pages.push(
      page('pages', 'Every page', 'All pages in the platform, their addresses and where to find them.', ['menu', 'navigation', 'sidebar', 'rail', 'where is'], out.join('\n')),
    );
  }

  /* ---- who can do what ---- */
  {
    const out: string[] = [
      'A **capability** is one thing somebody may do. Colleagues hold every capability except the ones marked *administrators only*. Roles are explained in [Roles and permissions](help:shell/roles-and-permissions).',
    ];
    for (const m of mods) {
      if (m.permissions.length === 0) continue;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| Capability | What it allows | Who |', '|---|---|---|');
      for (const p of m.permissions) {
        out.push(`| \`${p.capability}\` | ${p.description} | ${p.adminOnly ? 'Administrators only' : 'Everyone'} |`);
      }
    }
    pages.push(
      page('permissions', 'Permissions', 'Every capability in the platform, what it allows and who holds it.', ['access', 'role', 'admin', 'allowed', 'cannot see', 'forbidden', 'rights'], out.join('\n')),
    );
  }

  /* ---- what the assistant can do ---- */
  {
    const out: string[] = [
      'The assistant acts as **you**: it can only use a tool you are allowed to use, and it never goes beyond that. How careful it is depends on the kind of action:',
      '',
      ...Object.entries(RISK_MEANING).map(([k, v]) => `- **${k}** — ${v}.`),
    ];
    for (const m of mods) {
      if (m.aiTools.length === 0) continue;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| Tool | What it does | Kind | Needs |', '|---|---|---|---|');
      for (const t of m.aiTools) {
        if (t.riskClass === 'restricted') continue;
        out.push(`| \`${t.name}\` | ${firstSentence(t.description).replace(/\|/g, '/')} | ${t.riskClass} | \`${t.permission}\` |`);
      }
    }
    pages.push(
      page('assistant', 'What the assistant can do', 'Every action the assistant can take, with the permission and the care it needs.', ['ai', 'tools', 'abilities', 'ask', 'chat', 'confirm'], out.join('\n')),
    );
  }

  /* ---- records ---- */
  {
    const out: string[] = [
      'Everything you can open, link, search for or mention is a **record** of some type.',
    ];
    for (const m of mods) {
      if (m.entities.length === 0) continue;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| Record | Opens at | Seen by |', '|---|---|---|');
      for (const e of m.entities) {
        out.push(`| ${e.type.replace(/_/g, ' ')} | \`${e.urlPattern}\` | \`${e.readPermission}\` |`);
      }
      for (const r of m.structuralRefs) {
        out.push(
          '',
          `A ${r.from.replace(/_/g, ' ')} ${r.required ? 'must belong to' : 'can belong to'} a ${r.toType.replace(/_/g, ' ')}.`,
        );
      }
    }
    pages.push(
      page('records', 'Records and what they belong to', 'The kinds of record in the platform, where each opens and what it is attached to.', ['entity', 'type', 'link', 'belongs to', 'attached'], out.join('\n')),
    );
  }

  /* ---- what clients can see ---- */
  {
    const out: string[] = [
      'Nothing is visible to a client by default. These are the records a client **can** see once somebody shares them, and the only fields they get.',
    ];
    let any = false;
    for (const m of mods) {
      if (m.portalExposure.length === 0) continue;
      any = true;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| Record | Fields shown to the client |', '|---|---|');
      for (const p of m.portalExposure) {
        out.push(`| ${p.entityType.replace(/_/g, ' ')} | ${p.fields.map((f) => `\`${f}\``).join(', ')} |`);
      }
    }
    if (any) {
      pages.push(
        page('client-portal', 'What clients can see', 'The records and fields that can be shown to a client in the portal.', ['portal', 'client', 'visible', 'share', 'expose', 'privacy'], out.join('\n')),
      );
    }
  }

  /* ---- events ---- */
  {
    const subscribers = new Map<string, string[]>();
    for (const m of mods) for (const s of m.subscribes) subscribers.set(s.event, [...(subscribers.get(s.event) ?? []), moduleLabel(m.name)]);
    const out: string[] = [
      'Events are how one part of the platform tells the others something happened. They feed the activity timeline, Insights, and the automatic reactions between modules.',
    ];
    for (const m of mods) {
      if (m.publishes.length === 0) continue;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| Event | Happens when | Reacted to by |', '|---|---|---|');
      for (const e of m.publishes) {
        out.push(`| \`${e.name}\` | ${e.description} | ${(subscribers.get(e.name) ?? ['—']).join(', ')} |`);
      }
    }
    pages.push(
      page('events', 'Events', 'What the platform announces when something happens, and who reacts.', ['activity', 'timeline', 'log', 'trigger', 'automatic', 'notification'], out.join('\n')),
    );
  }

  /* ---- dashboard blocks ---- */
  {
    const out: string[] = [
      'Blocks you can place on your dashboard or that appear on record pages, by the module that provides them. Names are derived from the block keys.',
    ];
    for (const m of mods) {
      if (m.widgets.length === 0) continue;
      out.push(`\n## ${moduleLabel(m.name)}\n`);
      for (const slot of ['dashboard', 'entity-page', 'timeline', 'meeting-room'] as const) {
        const ws = m.widgets.filter((w) => w.slot === slot);
        if (ws.length === 0) continue;
        const where = { dashboard: 'Dashboard', 'entity-page': 'On record pages', timeline: 'Timeline', 'meeting-room': 'Inside a meeting' }[slot];
        out.push(`- **${where}:** ${ws.map((w) => humanizeWidget(w.component)).join(', ')}`);
      }
    }
    pages.push(
      page('dashboard-blocks', 'Dashboard blocks', 'The blocks each module contributes to the dashboard and to record pages.', ['widget', 'dashboard', 'card', 'tile', 'home'], out.join('\n')),
    );
  }

  /* ---- reporting views ---- */
  {
    const out: string[] = ['The data each module publishes for reporting.'];
    let any = false;
    for (const m of mods) {
      if (m.reportingViews.length === 0) continue;
      any = true;
      out.push(`\n## ${moduleLabel(m.name)}\n`, '| View | Contains |', '|---|---|');
      for (const v of m.reportingViews) out.push(`| \`${v.view}\` | ${v.description} |`);
    }
    if (any) {
      pages.push(
        page('reporting-views', 'Reporting data', 'The datasets each module publishes for reporting.', ['report', 'sql', 'data', 'export', 'view'], out.join('\n')),
      );
    }
  }

  /* ---- reference landing ---- */
  pages.unshift(
    page(
      'index',
      'Reference',
      'Lists generated from the platform itself — always current.',
      ['reference', 'list', 'everything'],
      [
        'These pages are **generated from the platform itself** each time it starts, so they cannot be out of date. For how to do things step by step, see the guides in each module.',
        '',
        ...pages.map((p) => `- [${p.title}](help:${p.slug}) — ${p.summary}`),
      ].join('\n'),
    ),
  );

  return pages;
}
