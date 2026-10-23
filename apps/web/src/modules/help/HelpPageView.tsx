import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError } from '../../lib/api.js';
import { Badge, Empty } from '../../shell/ui/primitives.js';
import { PageHeader } from '../../shell/ui/layout.js';
import { helpUrl } from './HelpHome.js';
import type { HelpPageData } from './types.js';

/** Same rule as the server's `slugifyHeading`, so a search hit's anchor finds its heading. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Text of a heading's children, for slugging. Headings are plain text in every page. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

/**
 * `help:time/log-hours` is how a page names another page. Resolved here so a page can be
 * moved by changing one slug and a link check, never by hunting for addresses.
 */
function resolveHref(href: string | undefined): { to?: string; external?: string } {
  if (!href) return {};
  if (href.startsWith('help:')) {
    const [slug, anchor] = href.slice(5).split('#');
    return { to: helpUrl(slug ?? '', anchor) };
  }
  if (/^https?:/.test(href)) return { external: href };
  return { to: href };
}

export function HelpPageView() {
  const params = useParams();
  // `/help/start` is the start page; every other slug is the rest of the address.
  const slug = !params['*'] || params['*'] === 'start' ? 'index' : params['*'];
  const { hash } = useLocation();
  const [page, setPage] = useState<HelpPageData | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    setPage(null);
    setError(null);
    api
      .get<HelpPageData>(`/help/page?slug=${encodeURIComponent(slug)}`)
      .then(setPage)
      .catch((e: unknown) =>
        setError({ status: e instanceof ApiError ? e.status : 0, message: (e as Error).message }),
      );
  }, [slug]);

  // Scroll to the heading a search hit pointed at, once the page has rendered.
  useEffect(() => {
    if (!page || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [page, hash]);

  const toc = useMemo(
    () =>
      (page?.body.match(/^## .+$/gm) ?? []).map((h) => {
        const text = h.slice(3).trim();
        return { text, id: slugifyHeading(text) };
      }),
    [page],
  );

  if (error) {
    return (
      <>
        <PageHeader title="Help" back={{ to: '/help', label: 'All of Help' }} />
        <Empty>
          {error.status === 404
            ? 'There is no help page at this address. It may have been renamed — try searching.'
            : error.message}
        </Empty>
      </>
    );
  }
  if (!page) return <><PageHeader title="Help" back={{ to: '/help', label: 'All of Help' }} /></>;

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle={page.summary}
        back={{ to: '/help', label: 'All of Help' }}
        meta={
          <>
            {page.kind === 'reference' ? (
              <Badge tone="brand" title="Generated from the platform itself each time it starts">
                generated, always current
              </Badge>
            ) : (
              page.updated && <span className="muted">Last checked {page.updated}</span>
            )}
            {page.capability && (
              <span className="muted" title={`Capability: ${page.capability}`}>
                Needs: {page.capability}
              </span>
            )}
          </>
        }
      />

      <div className="help-article">
        {toc.length > 2 && (
          <nav className="help-toc" aria-label="On this page">
            <strong>On this page</strong>
            <ul>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="prose help-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => <h2 id={slugifyHeading(textOf(children))}>{children}</h2>,
              a: ({ href, children }) => {
                const r = resolveHref(href);
                if (r.to) return <Link to={r.to}>{children}</Link>;
                return (
                  <a href={r.external} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {page.body}
          </ReactMarkdown>
        </div>
      </div>
    </>
  );
}
