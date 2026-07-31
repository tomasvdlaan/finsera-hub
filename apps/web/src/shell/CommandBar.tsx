import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from './Icon.js';
import { Button } from './ui/primitives.js';
import { Composer, ConversationView, useConversation } from './conversation/index.js';
import type { NavItem } from '../modules/types.js';

/** How long after the last keystroke the server is asked. */
const SEARCH_AFTER_MS = 180;


interface EntityHit {
  id: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}

type Row =
  | { kind: 'page'; key: string; label: string; path: string; icon?: string }
  | { kind: 'record'; key: string; label: string; path: string; entityType: string }
  | { kind: 'recent'; key: string; label: string; path: string; entityType: string }
  | { kind: 'action'; key: string; label: string; run: () => Promise<string | null> }
  | { kind: 'ask'; key: string; label: string };

/** What the box remembers between sessions. Small on purpose — this is a shortcut, not history. */
const RECENTS_KEY = 'finsera.cmdk.recents';
const RECENTS_MAX = 5;

interface Recent {
  id: string;
  label: string;
  path: string;
  entityType: string;
}

function readRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as Recent[]).slice(0, RECENTS_MAX) : [];
  } catch {
    // A corrupt entry must not take the command bar down with it.
    return [];
  }
}

function rememberRecent(entry: Recent): void {
  try {
    const kept = [entry, ...readRecents().filter((r) => r.id !== entry.id)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(kept));
  } catch {
    /* private browsing, a full quota — not worth failing a navigation over */
  }
}

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
export function CommandBar({
  nav,
  me,
  open,
  onOpenChange,
}: {
  nav: NavItem[];
  /** Needed to start a ceremony with an attendee — see the standup action. */
  me: { displayName: string } | null;
  /*
   * Owned by the shell rather than here, so the sidebar's Search button opens the same
   * overlay ⌘K does. A shortcut nobody was told about is indistinguishable from no feature,
   * and two ways in must not mean two states.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const setOpen = onOpenChange;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [picked, setPicked] = useState(0);
  const [searching, setSearching] = useState(false);

  /*
   * A conversation, not an answer.
   *
   * This used to call /assistant/ask with no conversationId and render the reply as a dead
   * end — you could read it and that was all. There was no way to say "and the second one?",
   * which is most of what anyone wants to say next.
   */
  const chat = useConversation();
  const [recents, setRecents] = useState<Recent[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Once a question has been asked, the box stops being a list and becomes a thread. */
  const talking = chat.turns.length > 0 || chat.busy;

  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setPicked(0);
    chat.reset();
  }, [chat]);

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
        setOpen(!open);
        return;
      }
      if (e.key === 'Escape' && open) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      // Read on open rather than on mount, so a record opened in another tab is here too.
      setRecents(readRecents());
    }
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

  /**
   * The things you can do from here, as opposed to go to.
   *
   * Deliberately few, and all of them things you would otherwise navigate somewhere to start.
   * Each returns the path to land on, so an action and a destination behave the same from the
   * outside: you press Enter and end up where the work is.
   */
  const actions = useMemo<Row[]>(
    () => [
      {
        kind: 'action',
        key: 'a:standup',
        label: 'Start a daily stand-up',
        run: async () => {
          const note = await api.post<{ id: string }>('/meetings', {
            title: `Daily stand-up — ${new Date().toISOString().slice(0, 10)}`,
            template: 'daily_standup',
            // Yourself, matching the hub: the per-person block needs a heading, and the
            // consent gate needs somebody to have agreed or recording refuses to start.
            attendees: [{ name: me?.displayName ?? 'Me' }],
          });
          return `/meetings/${note.id}/room`;
        },
      },
      {
        kind: 'action',
        key: 'a:note',
        label: 'New meeting note',
        run: async () => {
          const note = await api.post<{ id: string }>('/meetings', { title: 'Untitled meeting' });
          return `/meetings/${note.id}`;
        },
      },
    ],
    [me],
  );

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

    /*
     * With nothing typed, the box opens on where you have just been.
     *
     * An empty command bar listing the same seven pages the rail already shows is a worse
     * rail. What you actually want at that moment is the note you were in ten minutes ago.
     */
    if (!q) {
      const recent: Row[] = recents.map((r) => ({
        kind: 'recent',
        key: `h:${r.id}`,
        label: r.label,
        path: r.path,
        entityType: r.entityType,
      }));
      return [...recent, ...pages];
    }

    const doable: Row[] = actions.filter((a) => a.label.toLowerCase().includes(q));

    // Always last, and always offered: the question you could not have answered by
    // navigating is the whole reason the assistant is here.
    const ask: Row[] = [{ kind: 'ask', key: 'ask', label: query.trim() }];
    return [...doable, ...pages, ...records, ...ask];
  }, [nav, hits, query, recents, actions]);

  useEffect(() => setPicked(0), [rows.length]);

  const run = useCallback(
    async (row: Row) => {
      if (row.kind === 'record' || row.kind === 'recent') {
        // Remembered on the way out, so the next ⌘K opens on it.
        rememberRecent({
          id: row.key.slice(2),
          label: row.label,
          path: row.path,
          entityType: row.entityType,
        });
        navigate(row.path);
        close();
        return;
      }

      if (row.kind === 'page') {
        navigate(row.path);
        close();
        return;
      }

      if (row.kind === 'action') {
        setRunning(row.key);
        try {
          const to = await row.run();
          if (to) navigate(to);
          close();
        } catch (e) {
          setActionError((e as Error).message);
        } finally {
          setRunning(null);
        }
        return;
      }

      /*
       * The entity the current page is about, so "this client" resolves without naming it.
       *
       * The sidebar panel scraped this out of the URL and the command bar never did, which
       * meant the same question answered differently depending on where you asked it.
       */
      const entityId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
        .exec(window.location.pathname)?.[0];
      await chat.ask(row.label, entityId ? { entityId } : undefined);
    },
    [navigate, close, chat],
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
              setActionError(null);
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
                  {row.kind === 'action' ? (
                    <>
                      <span className="cmdk-glyph" aria-hidden="true">
                        {running === row.key ? '…' : '+'}
                      </span>
                      <span className="cmdk-label">{row.label}</span>
                      <span className="tag">Action</span>
                    </>
                  ) : row.kind === 'ask' ? (
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

        {talking && (
          <div className="cmdk-thread">
            <ConversationView turns={chat.turns} busy={chat.busy} waited={chat.waited} compact />
          </div>
        )}

        {talking && (
          /* Keep going here, or take it somewhere with room. The hand-off carries the
             conversation, so nothing is retyped. */
          <div className="cmdk-continue">
            <Composer onSend={(m) => void chat.ask(m)} busy={chat.busy} placeholder="Reply…" />
            {chat.conversationId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigate(`/assistant/${chat.conversationId}`);
                  close();
                }}
              >
                Open in full →
              </Button>
            )}
          </div>
        )}

        {actionError && <p className="error cmdk-continue">{actionError}</p>}

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
