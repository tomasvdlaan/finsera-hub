import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Empty, Panel } from '../../shell/ui/primitives.js';
import { PageHeader } from '../../shell/ui/layout.js';
import type { HelpHit, HelpNav } from './types.js';

/** The address of a page, and of a heading inside it. */
export const helpUrl = (slug: string, anchor?: string) =>
  slug === 'index' ? '/help/start' : `/help/${slug}${anchor ? `#${anchor}` : ''}`;

/**
 * Help's front door: a search box, and under it the whole of Help laid out by module.
 *
 * The query lives in the address (`?q=`) rather than in state, so a result list can be
 * shared and the back button returns to it instead of to an empty box.
 */
export function HelpHome() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [nav, setNav] = useState<HelpNav | null>(null);
  const [hits, setHits] = useState<HelpHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HelpNav>('/help')
      .then(setNav)
      .catch((e: Error) => setError(e.message));
  }, []);

  // A short pause before searching, so typing "invoice" is one request and not seven.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api
        .get<{ hits: HelpHit[] }>(`/help/search?q=${encodeURIComponent(query)}`)
        .then((r) => live && setHits(r.hits))
        .catch((e: Error) => live && setError(e.message));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <>
      <PageHeader
        title="Help"
        subtitle="How to do things on the platform. Search, browse by area, or ask the assistant."
      />

      <div className="help-search">
        <input
          type="search"
          value={q}
          autoFocus
          placeholder="Search — for example: send an invoice, approve a week, invite a client"
          aria-label="Search help"
          onChange={(e) => {
            const v = e.target.value;
            setParams(v ? { q: v } : {}, { replace: true });
          }}
        />
      </div>

      {error && <p className="error">{error}</p>}

      {q.trim() && hits && (
        <Panel title={hits.length ? 'Best matches' : undefined}>
          {hits.length === 0 ? (
            <Empty>
              Nothing in Help matches “{q.trim()}”. Try other words — or ask the assistant, and tell
              the owner of this page that it is missing.
            </Empty>
          ) : (
            <ul className="help-hits">
              {hits.map((h) => (
                <li key={`${h.slug}#${h.anchor}`}>
                  <Link to={helpUrl(h.slug, h.anchor)}>
                    <strong>{h.title}</strong>
                    {h.anchor && <span className="muted"> › {h.heading}</span>}
                  </Link>
                  {h.kind === 'reference' && <Badge>reference</Badge>}
                  <p className="muted">{h.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {!q.trim() && nav && (
        <>
          {nav.start && (
            <Panel title="New here?" sub={nav.start.summary}>
              <Link to={helpUrl(nav.start.slug)}>Start with “{nav.start.title}” →</Link>
            </Panel>
          )}

          {nav.groups.map((g) => (
            <Panel
              key={g.module}
              title={g.overview ? <h2><Link to={helpUrl(g.overview.slug)}>{g.label}</Link></h2> : g.label}
              sub={g.overview?.summary}
            >
              <ul className="help-list">
                {g.pages.map((p) => (
                  <li key={p.slug}>
                    <Link to={helpUrl(p.slug)}>{p.title}</Link>
                    <span className="muted"> — {p.summary}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}

          <Panel
            title="Reference"
            sub="Lists generated from the platform itself, so they are always current."
          >
            <ul className="help-list">
              {nav.reference.map((p) => (
                <li key={p.slug}>
                  <Link to={helpUrl(p.slug)}>{p.title}</Link>
                  <span className="muted"> — {p.summary}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
