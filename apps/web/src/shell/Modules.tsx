import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface Subscriber {
  module: string;
  handler: string;
}

interface ModuleDoc {
  name: string;
  version: string;
  entities: Array<{ type: string; displayTemplate: string; urlPattern: string }>;
  structuralRefs: Array<{ from: string; toType: string; required: boolean }>;
  publishes: Array<{ name: string; description: string; subscribers: Subscriber[] }>;
  subscribes: Array<{ event: string; handler: string }>;
  permissions: Array<{ capability: string; description: string }>;
  navigation: Array<{ label: string; path: string }>;
  widgets: Array<{ slot: string; component: string }>;
  chatWidgets: Array<{ entityType: string; component: string }>;
  reportingViews: Array<{ view: string; description: string }>;
  portalExposure: Array<{ entityType: string }>;
  aiTools: Array<{ name: string; description: string; permission: string; riskClass: string }>;
}

const RISK_HINT: Record<string, string> = {
  read: 'Runs silently.',
  'write:draft': 'Runs and shows the result for review.',
  'write:commit': 'Withheld until the user confirms.',
  restricted: 'Never offered to the assistant.',
};

/**
 * Platform documentation, generated from the sealed manifests.
 *
 * Deliberately not hand-written: this is the contract the core actually runs on, so it
 * cannot drift from the system it describes. If something appears here, it exists.
 */
export function Modules() {
  const [modules, setModules] = useState<ModuleDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ModuleDoc[]>('/core/modules')
      .then((m) => {
        setModules(m);
        setOpen(m[0]?.name ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!modules) return <p className="muted">Loading…</p>;

  const total = (pick: (m: ModuleDoc) => unknown[]) =>
    modules.reduce((sum, m) => sum + pick(m).length, 0);

  return (
    <>
      <h1>Platform modules</h1>
      <p className="muted">
        Generated from each module&rsquo;s manifest — the same declarations the core reads at
        startup to assemble navigation, permissions, events and the assistant&rsquo;s tools. It
        cannot drift from the running system.
      </p>

      <div className="stat-row">
        <Stat label="Modules" value={modules.length} />
        <Stat label="Entity types" value={total((m) => m.entities)} />
        <Stat label="Events" value={total((m) => m.publishes)} />
        <Stat label="Capabilities" value={total((m) => m.permissions)} />
        <Stat label="AI tools" value={total((m) => m.aiTools)} />
        <Stat label="Reporting views" value={total((m) => m.reportingViews)} />
      </div>

      {modules.map((m) => {
        const isOpen = open === m.name;
        return (
          <section key={m.name} className="module-card">
            <button
              className="module-head"
              onClick={() => setOpen(isOpen ? null : m.name)}
              aria-expanded={isOpen}
            >
              <span>
                <strong>{m.name}</strong> <span className="muted">v{m.version}</span>
              </span>
              <span className="muted">
                {m.entities.length} entities · {m.aiTools.length} tools {isOpen ? '▲' : '▼'}
              </span>
            </button>

            {isOpen && (
              <div className="module-body">
                <Block title="Entities" hint="Registered in the core, so each is linkable, searchable and timeline-visible.">
                  {m.entities.map((e) => (
                    <Row key={e.type} code={e.type} note={e.urlPattern} />
                  ))}
                </Block>

                <Block title="References" hint="Structural links this module's records require.">
                  {m.structuralRefs.map((r, i) => (
                    <Row
                      key={i}
                      code={`${r.from} → ${r.toType}`}
                      note={r.required ? 'required' : 'optional'}
                    />
                  ))}
                </Block>

                <Block title="Publishes" hint="Events other modules may react to.">
                  {m.publishes.map((e) => (
                    <Row
                      key={e.name}
                      code={e.name}
                      note={
                        e.subscribers.length
                          ? `→ ${e.subscribers.map((s) => `${s.module}.${s.handler}`).join(', ')}`
                          : 'no subscribers yet'
                      }
                      description={e.description}
                    />
                  ))}
                </Block>

                <Block title="Subscribes" hint="Events this module reacts to.">
                  {m.subscribes.map((s, i) => (
                    <Row key={i} code={s.event} note={`handled by ${s.handler}`} />
                  ))}
                </Block>

                <Block title="Capabilities" hint="Permissions this module introduces.">
                  {m.permissions.map((p) => (
                    <Row key={p.capability} code={p.capability} description={p.description} />
                  ))}
                </Block>

                <Block
                  title="AI tools"
                  hint="What the assistant may do here. The risk class is enforced by the orchestrator, not by the model."
                >
                  {m.aiTools.map((t) => (
                    <Row
                      key={t.name}
                      code={t.name}
                      badge={t.riskClass}
                      description={t.description}
                      note={`${t.permission} · ${RISK_HINT[t.riskClass] ?? ''}`}
                    />
                  ))}
                </Block>

                <Block title="Screens & widgets" hint="What this module contributes to the shell.">
                  {[
                    ...m.navigation.map((n) => ({ code: n.path, note: n.label })),
                    ...m.widgets.map((w) => ({ code: w.component, note: `slot: ${w.slot}` })),
                  ].map((x, i) => (
                    <Row key={i} code={x.code} note={x.note} />
                  ))}
                </Block>

                <Block
                  title="Chat cards"
                  hint="How the assistant renders this module's records inside an answer."
                >
                  {m.chatWidgets.map((w) => (
                    <Row key={w.entityType} code={w.component} note={`for ${w.entityType}`} />
                  ))}
                </Block>

                <Block title="Reporting views" hint="The stable shape this module publishes for dashboards and Power BI.">
                  {m.reportingViews.map((v) => (
                    <Row key={v.view} code={v.view} description={v.description} />
                  ))}
                </Block>

                <Block
                  title="Portal exposure"
                  hint="What clients may see. Nothing is portal-visible by default."
                >
                  {m.portalExposure.map((p, i) => (
                    <Row key={i} code={p.entityType} />
                  ))}
                </Block>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode[];
}) {
  const items = children.filter(Boolean);
  return (
    <div className="module-block">
      <h3>{title}</h3>
      <p className="muted">{hint}</p>
      {items.length === 0 ? <p className="muted">— none —</p> : <ul className="decl">{items}</ul>}
    </div>
  );
}

function Row({
  code,
  note,
  badge,
  description,
}: {
  code: string;
  note?: string;
  badge?: string;
  description?: string;
}) {
  return (
    <li>
      <code>{code}</code>
      {badge && <span className={`badge risk-${badge.replace(':', '-')}`}>{badge}</span>}
      {description && <div>{description}</div>}
      {note && <div className="muted">{note}</div>}
    </li>
  );
}
