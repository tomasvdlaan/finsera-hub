import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { getUser } from '../../lib/auth.js';

type Preview =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'html'; html: string }
  | { kind: 'sheets'; sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> }
  | { kind: 'binary'; mimeType: string; hint: 'image' | 'pdf' | 'docx' }
  | { kind: 'none'; reason: string };

/**
 * Renders whatever the server's file-type handler produced.
 *
 * The component switches on `kind`, not on format — so a new file type needs a handler on
 * the server and, only if it introduces a genuinely new shape, a branch here.
 */
export function DocumentPreview({
  documentId,
  versionId,
}: {
  documentId: string;
  versionId?: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreview(null);
    setError(null);
    const query = versionId ? `?versionId=${versionId}` : '';
    api
      .get<Preview>(`/docs/documents/${documentId}/preview${query}`)
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [documentId, versionId]);

  // Images and PDFs are rendered by the browser, but the endpoint needs a bearer token,
  // which <img src> and <iframe src> cannot carry — so fetch the bytes and hand over a
  // blob URL instead.
  useEffect(() => {
    if (preview?.kind !== 'binary') return;
    let cancelled = false;
    let url: string | null = null;

    void (async () => {
      try {
        const user = await getUser();
        const query = versionId ? `?versionId=${versionId}` : '';
        const res = await fetch(`/api/docs/documents/${documentId}/raw${query}`, {
          headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const blob = await res.blob();
        if (cancelled) return;

        if (preview.hint === 'docx') {
          // docx-preview reproduces the real page layout — styles, tables, spacing —
          // which a server-side conversion to semantic HTML cannot.
          const { renderAsync } = await import('docx-preview');
          const container = docxRef.current;
          if (!container || cancelled) return;
          container.innerHTML = '';
          await renderAsync(await blob.arrayBuffer(), container, undefined, {
            className: 'docx',
            inWrapper: true,
            ignoreWidth: true, // fit the panel rather than a fixed A4 width
            ignoreHeight: true,
            breakPages: true,
            experimental: true,
          });
        } else {
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setBlobUrl(null);
    };
  }, [preview, documentId, versionId]);

  if (error) return <p className="error">{error}</p>;
  if (!preview) return <p className="muted">Loading preview…</p>;

  switch (preview.kind) {
    case 'none':
      return <p className="muted">{preview.reason}</p>;

    case 'text':
    case 'markdown':
      return <pre className="preview preview-text">{preview.text}</pre>;

    case 'html':
      // Sanitised server-side against an allowlist — see core/files/handlers.ts.
      return (
        <div className="preview preview-html" dangerouslySetInnerHTML={{ __html: preview.html }} />
      );

    case 'sheets':
      return (
        <div className="preview">
          {preview.sheets.map((sheet) => (
            <div key={sheet.name} style={{ marginBottom: '1rem' }}>
              <h3>{sheet.name}</h3>
              {sheet.rows.length === 0 ? (
                <p className="muted">Empty sheet.</p>
              ) : (
                <div className="grid-scroll">
                  <table className="grid">
                    <tbody>
                      {sheet.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) =>
                            // The first row reads as headers, which is how spreadsheets
                            // are actually written even though the format has no concept.
                            i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>,
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sheet.truncated && (
                <p className="muted">First 200 rows shown — download for the full sheet.</p>
              )}
            </div>
          ))}
        </div>
      );

    case 'binary':
      // The container must exist before rendering starts, so it is always mounted.
      if (preview.hint === 'docx') return <div ref={docxRef} className="preview preview-docx" />;
      if (!blobUrl) return <p className="muted">Loading file…</p>;
      return preview.hint === 'image' ? (
        <img className="preview preview-image" src={blobUrl} alt="Document preview" />
      ) : (
        <iframe className="preview preview-pdf" src={blobUrl} title="Document preview" />
      );
  }
}
