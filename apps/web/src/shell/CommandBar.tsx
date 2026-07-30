import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from './Icon.js';
import type { NavItem } from '../modules/types.js';

/** How long after the last keystroke the server is asked. */
const SEARCH_AFTER_MS = 180;

/** A question that runs a model can legitimately take a while; this is a backstop. */
const ASK_TIMEOUT_MS = 120_000;

interface EntityHit {
  id: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}

type Row =
  | { kind: 'page'; key: string; label: string; path: string; icon?: string }
  | { kind: 'record'; key: string; label: string; path: string; entityType: string }
  | { kind: 'ask'; key: string; label: string };

/**
 * One box that goes anywhere, finds anything, and answers questions.
 *
 * The assistant was real and almost invisible: a button in the rail, opening a panel, on
 * pages that had one. Everything it can do — thirty-eight tools across ten modules, hybrid
 * search over documents and notes — sat behind a click most people never made. Meanwhile
 * finding a client meant knowing that clients live under Clients.
 *
 * Both are the same problem, which is why this is one control rather than two. You press
 * ⌘K and type; what you typed is matched against the pages you can go to and everything in
 * the platform that has a name, and if none of that is what you meant, the last row hands
 * the same words to the assistant.
 *
 * Records come from one endpoint over the entity registry rather than from each module,
 * which is possible because registration is an invariant here — see SearchService. The
 * practical effect is that a note, an invoice and a contact all turn up in one list without
 * the shell knowing that any of those things exist.
 */
export function CommandBar({ nav }: { nav: NavItem[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [picked, setPicked] = useState(0);
  const [searching, setSearching] = useState(false);

  /** The assistant's answer, shown in place rather than in another panel. */
  const [answer, setAnswer] = useState<{ text: string; tools: string[] } | null>(null);
  const [asking, setAsking] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setAnswer(null);
    setPicked(0);
  }, []);

  /*
   * ⌘K from anywhere, including the meeting room.
   *
   * Bound on the window rather than inside a layout, because the room renders outside the
   * ordinary chrome and is exactly where reaching for something without losing your place
   * matters most.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((was) => !was);
        return;
      }
      if (e.key === 'Escape' && open) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /** Ask the server what matches, once the typing settles. */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<{ results: EntityHit[] }>(`/core/search?q=${encodeURIComponent(q)}`)
        .then((r) => setHits(r.results))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, SEARCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Row[] = nav
      .filter((i) => !i.hidden && (!q || i.label.toLowerCase().includes(q)))
      .slice(0, q ? 5 : 7)
      .map((i) => ({ kind: 'page', key: `p:${i.path}`, label: i.label, path: i.path, icon: i.icon }));

    const records: Row[] = hits.map((h) => ({
      kind: 'record',
      key: `r:${h.id}`,
      label: h.displayName,
      path: h.urlPath,
      entityType: h.entityType,
    }));

    // Always last, and always offered: the question you could not have answered by
    // navigating is the whole reason the assistant is here.
    const ask: Row[] = q ? [{ kind: 'ask', key: 'ask', label: query.trim() }] : [];
    return [...pages, ...records, ...ask];
  }, [nav, hits, query]);

  useEffect(() => setPicked(0), [rows.length]);

  const run = useCallback(
    async (row: Row) => {
      if (row.kind !== 'ask') {
        navigate(row.path);
        close();
        return;
      }

      setAsking(true);
      setAnswer(null);
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), ASK_TIMEOUT_MS);
      try {
        const res = await api.post<{ answer: string; toolCalls?: Array<{ toolName: string }> }>(
          '/assistant/ask',
          { message: row.label },
          abort.signal,
        );
        setAnswer({ text: res.answer, tools: (res.toolCalls ?? []).map((t) => t.toolName) });
      } catch (e) {
        setAnswer({
          text:
            (e as Error).name === 'AbortError'
              ? 'That took too long and was given up on. Ask it again.'
              : (e as Error).message,
          tools: [],
        });
      } finally {
        clearTimeout(deadline);
        setAsking(false);
      }
    },
    [navigate, close],
  );

  if (!open) return null;

  const chosen = rows[Math.min(picked, rows.length - 1)];

  return (
    <div className="cmdk-scrim" onClick={close} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Search and ask"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Go to, find, or ask anything…"
            aria-label="Go to, find, or ask anything"
            onChange={(e) => {
              setQuery(e.target.value);
              setAnswer(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setPicked((i) => (i + step + rows.length) % Math.max(rows.length, 1));
              }
              if (e.key === 'Enter' && chosen) {
                e.preventDefault();
                void run(chosen);
              }
            }}
          />
          {searching && <span className="muted cmdk-hint">searching…</span>}
        </div>

        {rows.length > 0 && (
          <ul className="cmdk-list" role="listbox">
            {rows.map((row, i) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === picked}
                  className={i === picked ? 'cmdk-row cmdk-on' : 'cmdk-row'}
                  onMouseEnter={() => setPicked(i)}
                  onClick={() => void run(row)}
                >
                  {row.kind === 'ask' ? (
                    <>
                      <span className="cmdk-glyph" aria-hidden="true">
                        ✦
                      </span>
                      <span className="cmdk-label">
                        Ask the assistant<span className="muted"> — “{row.label}”</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="cmdk-glyph" aria-hidden="true">
                        {row.kind === 'page' ? <Icon name={row.icon} /> : '›'}
                      </span>
                      <span className="cmdk-label">{row.label}</span>
                      <span className="tag">
                        {row.kind === 'page' ? 'Page' : row.entityType.replace(/_/g, ' ')}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {(asking || answer) && (
          <div className="cmdk-answer">
            {asking ? (
              <p className="muted">Thinking…</p>
            ) : (
              <>
                <p>{answer!.text}</p>
                {answer!.tools.length > 0 && (
                  /* What it looked at, so the answer can be checked rather than trusted. */
                  <p className="cmdk-tools">
                    {answer!.tools.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="cmdk-foot muted">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
