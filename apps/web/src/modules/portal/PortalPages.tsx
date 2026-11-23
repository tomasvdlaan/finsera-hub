import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api.js';
import { Empty, Panel } from '../../shell/ui/primitives.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { ArtefactVisibility } from './ArtefactVisibility.js';
import { portalHost } from './PortalUsers.js';

interface Page {
  id: string;
  slug: string;
  title: string;
  kind: string;
  sourceUrl: string;
  enabled: boolean;
  hasSecret: boolean;
  timeoutSeconds: number;
}

interface PageList {
  pages: Page[];
  secretsAvailable: boolean;
}

/**
 * The custom content a client has been given, managed where the client is.
 *
 * The reports themselves live on Vercel; this decides what they are called, where they
 * hang on the client's own address, and which secret gets them past deployment protection.
 * The source URL is visible here and nowhere else — the client's browser never receives it,
 * which is the difference between a link you can share and a link that is itself the access.
 */
export function PortalPages({
  clientId,
  portalSlug,
}: {
  clientId: string;
  portalSlug: string | null;
}) {
  const { confirm, ask } = useDialog();
  const toast = useToast();
  const [data, setData] = useState<PageList>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ slug: '', title: '', sourceUrl: '', bypassSecret: '', kind: 'proxy', timeoutSeconds: '' });

  const load = () =>
    api
      .get<PageList>(`/portal-admin/clients/${clientId}/pages`)
      .then(setData)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
  }, [clientId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api.post(`/portal-admin/clients/${clientId}/pages`, {
        slug: draft.slug.trim(),
        title: draft.title.trim(),
        kind: draft.kind,
        sourceUrl: draft.sourceUrl.trim(),
        bypassSecret: draft.bypassSecret.trim() || null,
        ...(draft.timeoutSeconds ? { timeoutSeconds: Number(draft.timeoutSeconds) } : {}),
      });
      setDraft({ slug: '', title: '', sourceUrl: '', bypassSecret: '', kind: 'proxy', timeoutSeconds: '' });
      setOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (page: Page, body: Record<string, unknown>) => {
    setError(undefined);
    try {
      await api.patch(`/portal-admin/pages/${page.id}`, body);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /**
   * Everything a page is called and pointed at, in one dialog. The secret field is blank on
   * purpose: left empty it leaves the stored one alone, so editing a link never needs the
   * credential to be typed again (or shown).
   */
  const edit = async (page: Page) => {
    const v = await ask({
      title: `Edit “${page.title}”`,
      confirmLabel: 'Save',
      fields: [
        { name: 'title', label: 'Title', defaultValue: page.title, required: true },
        {
          name: 'slug',
          label: 'Link',
          defaultValue: page.slug,
          required: true,
          hint: 'The part after the client address. Changing it breaks links people already have.',
        },
        { name: 'sourceUrl', label: 'Source URL', defaultValue: page.sourceUrl, required: true },
        {
          name: 'timeoutSeconds',
          label: 'Time-out (seconds)',
          type: 'number',
          defaultValue: String(page.timeoutSeconds),
          hint: 'Between 5 and 60.',
          required: true,
        },
        {
          name: 'bypassSecret',
          label: 'Bypass secret',
          placeholder: page.hasSecret ? 'Leave empty to keep the current one' : 'Optional',
        },
      ],
    });
    if (!v) return;
    const body: Record<string, unknown> = {
      title: v.title.trim(),
      slug: v.slug.trim(),
      sourceUrl: v.sourceUrl.trim(),
      timeoutSeconds: Number(v.timeoutSeconds),
    };
    if (v.bypassSecret.trim()) body.bypassSecret = v.bypassSecret.trim();
    await patch(page, body);
  };

  const remove = async (page: Page) => {
    const go = await confirm({
      title: `Remove “${page.title}”?`,
      body: `Any link to ${page.slug} stops working. The content itself is untouched — it stays wherever it is hosted.`,
      confirmLabel: 'Remove page',
      destructive: true,
    });
    if (!go) return;
    await api.del(`/portal-admin/pages/${page.id}`);
    toast.ok(`${page.title} removed`);
    await load();
  };

  /** One real request from this server, because that is the thing that has to work. */
  const test = async (page: Page) => {
    setError(undefined);
    setBusy(true);
    try {
      const r = await api.post<{ status: number; ok: boolean; note?: string }>(
        `/portal-admin/pages/${page.id}/test`,
        {},
      );
      const line = `${page.title}: HTTP ${r.status}${r.note ? ` — ${r.note}` : ''}`;
      if (r.ok) toast.ok(line);
      else setError(line);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!portalSlug) return null;

  return (
    <Panel title="Custom content">
      <p className="muted">
        Reports we host elsewhere, served from this client&rsquo;s own address. We fetch them
        server-side, so the hosting URL never reaches their browser and the deployment can keep
        its protection on.
      </p>

      {error && <p className="error">{error}</p>}

      {data && data.pages.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Link</th>
              <th>Title</th>
              <th>Visible to</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.pages.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={`https://${portalHost(portalSlug)}/${p.slug}/`} target="_blank" rel="noreferrer">
                    {portalHost(portalSlug)}/{p.slug}
                  </a>
                  {p.kind === 'redirect' && <span className="muted"> · redirect</span>}
                  {!p.enabled && <span className="muted"> · off</span>}
                </td>
                <td>{p.title}</td>
                {/* A report is the artefact most likely to be for some of a client's people
                    and not others — a margin analysis for the director, an operational
                    dashboard for everyone — so the choice sits on the report. */}
                <td style={{ verticalAlign: 'top' }}>
                  <ArtefactVisibility clientId={clientId} kind="page" artefactId={p.id} title={p.title} />
                </td>
                <td className="muted" style={{ maxWidth: '22rem', overflowWrap: 'anywhere' }}>
                  {p.sourceUrl}
                  {p.hasSecret && <span> · secret set</span>}
                  <span> · time-out {p.timeoutSeconds}s</span>
                </td>
                <td className="num">
                  <button className="link-button" disabled={busy} onClick={() => void test(p)}>
                    test
                  </button>{' '}
                  <button className="link-button" onClick={() => void edit(p)}>
                    edit
                  </button>{' '}
                  <button
                    className="link-button"
                    onClick={() => void patch(p, { enabled: !p.enabled })}
                  >
                    {p.enabled ? 'disable' : 'enable'}
                  </button>{' '}
                  <button className="link-button destructive" onClick={() => void remove(p)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && data.pages.length === 0 && <Empty>No custom content for this client yet.</Empty>}

      {open ? (
        <form onSubmit={create} style={{ marginTop: '.75rem' }}>
          <div className="row">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Rapportage Q3"
              required
            />
            <input
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="rapportage-q3"
              required
            />
          </div>
          <p className="muted">
            Will be at <code>{portalHost(portalSlug)}/{draft.slug || 'address'}/</code>
          </p>
          <div className="row">
            <input
              style={{ minWidth: '24rem' }}
              value={draft.sourceUrl}
              onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
              placeholder="https://rapportage-q3-duce.vercel.app"
              required
            />
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="proxy">Serve it here</option>
              <option value="redirect">Redirect to it</option>
            </select>
          </div>
          {data?.secretsAvailable ? (
            <div className="row">
              <input
                type="password"
                style={{ minWidth: '24rem' }}
                value={draft.bypassSecret}
                onChange={(e) => setDraft({ ...draft, bypassSecret: e.target.value })}
                placeholder="Vercel protection-bypass secret (optional)"
                autoComplete="off"
              />
            </div>
          ) : (
            <p className="muted">
              Set <code>PORTAL_PAGE_KEY</code> on the server to store a Vercel bypass secret.
              Without one, the deployment has to be publicly reachable.
            </p>
          )}
          <div className="row">
            <input
              type="number"
              min={5}
              max={60}
              style={{ width: '9rem' }}
              value={draft.timeoutSeconds}
              onChange={(e) => setDraft({ ...draft, timeoutSeconds: e.target.value })}
              placeholder="Time-out (s)"
              title="How long to wait for the deployment. Default 10, at most 60."
            />
            <span className="muted">Seconds to wait for the deployment; 10 if left empty.</span>
          </div>
          <p className="muted">
            Build the report with a relative base (<code>base: &apos;./&apos;</code> in Vite) so its
            assets resolve under the page. A Next.js app should use <code>basePath</code> equal to
            the slug and <code>trailingSlash: true</code>, and its source URL should end in that
            path. Root-absolute URLs in HTML and CSS are rewritten as a fallback; ones built in
            JavaScript are not.
          </p>
          <div className="row">
            <button type="submit" disabled={busy}>
              Add page
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>
              cancel
            </button>
          </div>
        </form>
      ) : (
        <button style={{ marginTop: '.75rem' }} onClick={() => setOpen(true)}>
          Add custom content
        </button>
      )}
    </Panel>
  );
}
