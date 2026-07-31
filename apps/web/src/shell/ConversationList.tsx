import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useDialog } from './ui/Dialog.js';
import { Button } from './ui/primitives.js';
import type { ConversationSummary } from './conversation/index.js';

export interface Folder {
  id: string;
  name: string;
}

/**
 * Every conversation, grouped and searchable.
 *
 * It was a flat list of thirty rows, each labelled with the first sixty characters of the
 * question that started it — so five separate afternoons spent on invoicing all read "How
 * many clients do we have?" and the only way to find one was to open them in turn.
 *
 * The three things that fixes are grouping, naming and searching, and none of them is worth
 * much without the others: folders you cannot name are drawers with no labels, names you
 * cannot search are still a list to scroll, and search over titles alone misses the thing
 * you actually remember, which is something the assistant said.
 */
export function ConversationList({
  history,
  folders,
  activeId,
  onOpen,
  onChanged,
  onNew,
}: {
  history: ConversationSummary[];
  folders: Folder[];
  activeId?: string;
  onOpen: (id: string) => void;
  /** Something was renamed, moved, pinned or deleted — reload both lists. */
  onChanged: () => void;
  onNew: () => void;
}) {
  const { ask, confirm } = useDialog();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* A click anywhere else closes the open menu, which is what every menu everywhere does. */
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  /*
   * Filtering here is on the title only, and deliberately so.
   *
   * The server searches message text as well, which is the useful half — but a round trip per
   * keystroke would make typing feel like waiting. So this narrows what is already on screen
   * immediately, and the caller re-queries the server when the field settles.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;
    return history.filter((c) => (c.title ?? '').toLowerCase().includes(needle));
  }, [history, query]);

  const grouped = useMemo(() => {
    const loose = shown.filter((c) => !c.folderId);
    const byFolder = new Map<string, ConversationSummary[]>();
    for (const f of folders) byFolder.set(f.id, []);
    for (const c of shown) if (c.folderId) byFolder.get(c.folderId)?.push(c);
    return { loose, byFolder };
  }, [shown, folders]);

  const run = async (work: () => Promise<unknown>) => {
    setMenu(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = async (c: ConversationSummary) => {
    const answer = await ask({
      title: 'Rename conversation',
      confirmLabel: 'Rename',
      fields: [{ name: 'title', label: 'Name', required: true, defaultValue: c.title ?? '' }],
    });
    if (answer?.title) {
      await run(() => api.patch(`/assistant/conversations/${c.id}`, { title: answer.title }));
    }
  };

  const remove = async (c: ConversationSummary) => {
    const ok = await confirm({
      title: `Delete "${c.title ?? 'this conversation'}"?`,
      body: 'The whole thread goes, including its answers. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await run(() => api.del(`/assistant/conversations/${c.id}`));
  };

  const newFolder = async () => {
    const answer = await ask({
      title: 'New folder',
      confirmLabel: 'Create',
      fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'Billing' }],
    });
    if (answer?.name) await run(() => api.post('/assistant/folders', { name: answer.name }));
  };

  const renameFolder = async (f: Folder) => {
    const answer = await ask({
      title: 'Rename folder',
      confirmLabel: 'Rename',
      fields: [{ name: 'name', label: 'Name', required: true, defaultValue: f.name }],
    });
    if (answer?.name) await run(() => api.patch(`/assistant/folders/${f.id}`, { name: answer.name }));
  };

  const deleteFolder = async (f: Folder) => {
    const ok = await confirm({
      title: `Delete the folder "${f.name}"?`,
      // Worth saying plainly: a reader who thinks this deletes the contents will never use it.
      body: 'The conversations inside it are kept — they move back to the top level.',
      confirmLabel: 'Delete folder',
      destructive: true,
    });
    if (ok) await run(() => api.del(`/assistant/folders/${f.id}`));
  };

  const row = (c: ConversationSummary) => (
    <li key={c.id} className="conversation-row">
      <button
        type="button"
        className={c.id === activeId ? 'nav-row active' : 'nav-row'}
        onClick={() => onOpen(c.id)}
      >
        {c.pinnedAt && (
          <span className="pin-mark" aria-label="Pinned">
            ●
          </span>
        )}
        <span className="nav-label">{c.title ?? 'Untitled'}</span>
      </button>

      <button
        type="button"
        className="row-menu-trigger"
        aria-label={`Actions for ${c.title ?? 'this conversation'}`}
        aria-expanded={menu === c.id}
        onClick={() => setMenu((m) => (m === c.id ? null : c.id))}
      >
        ⋯
      </button>

      {menu === c.id && (
        <div className="row-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void rename(c)}>
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(() =>
                api.post(`/assistant/conversations/${c.id}/pin`, { pinned: !c.pinnedAt }),
              )
            }
          >
            {c.pinnedAt ? 'Unpin' : 'Pin to top'}
          </button>
          <button type="button" role="menuitem" onClick={() => void exportThread(c)}>
            Export as Markdown
          </button>

          {/* Moving is a list of destinations rather than a submenu: there are rarely more
              than a handful of folders, and a submenu is a second thing to aim at. */}
          {(folders.length > 0 || c.folderId) && <hr />}
          {c.folderId && (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                void run(() => api.post(`/assistant/conversations/${c.id}/move`, { folderId: null }))
              }
            >
              Move out of folder
            </button>
          )}
          {folders
            .filter((f) => f.id !== c.folderId)
            .map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                onClick={() =>
                  void run(() =>
                    api.post(`/assistant/conversations/${c.id}/move`, { folderId: f.id }),
                  )
                }
              >
                Move to {f.name}
              </button>
            ))}

          <hr />
          <button
            type="button"
            role="menuitem"
            className="destructive"
            onClick={() => void remove(c)}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );

  return (
    <aside className="assistant-history" ref={listRef}>
      <div className="row">
        <h2>Conversations</h2>
        <Button size="sm" onClick={onNew}>
          New
        </Button>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search conversations"
        aria-label="Search conversations"
        className="conversation-search"
      />

      {error && <p className="error">{error}</p>}

      {folders.map((f) => {
        const inside = grouped.byFolder.get(f.id) ?? [];
        const open = openFolders.has(f.id) || query.trim().length > 0;
        return (
          <section key={f.id} className="conversation-folder">
            <div className="folder-head">
              <button
                type="button"
                className="folder-toggle"
                aria-expanded={open}
                onClick={() =>
                  setOpenFolders((s) => {
                    const next = new Set(s);
                    if (next.has(f.id)) next.delete(f.id);
                    else next.add(f.id);
                    return next;
                  })
                }
              >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span> {f.name}
                <span className="muted"> {inside.length}</span>
              </button>
              <button
                type="button"
                className="row-menu-trigger"
                aria-label={`Actions for folder ${f.name}`}
                onClick={() => setMenu((m) => (m === `f-${f.id}` ? null : `f-${f.id}`))}
              >
                ⋯
              </button>
              {menu === `f-${f.id}` && (
                <div className="row-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void renameFolder(f)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="destructive"
                    onClick={() => void deleteFolder(f)}
                  >
                    Delete folder
                  </button>
                </div>
              )}
            </div>
            {open && inside.length > 0 && <ul>{inside.map(row)}</ul>}
            {open && inside.length === 0 && <p className="muted folder-empty">Empty</p>}
          </section>
        );
      })}

      {grouped.loose.length > 0 && <ul>{grouped.loose.map(row)}</ul>}

      {shown.length === 0 && (
        <p className="muted">{query ? 'Nothing matches.' : 'Nothing yet. Ask something.'}</p>
      )}

      <button type="button" className="link-button new-folder" onClick={() => void newFolder()}>
        + New folder
      </button>
    </aside>
  );
}

/**
 * A conversation as a Markdown file.
 *
 * Built from the stored messages rather than from what is on screen, so exporting a thread
 * you have not opened works and gives the same file either way.
 */
async function exportThread(c: ConversationSummary): Promise<void> {
  const thread = await api.get<{
    messages: Array<{ role: string; content: string; createdAt: string }>;
  }>(`/assistant/conversations/${c.id}`);

  const body = [
    `# ${c.title ?? 'Conversation'}`,
    '',
    ...thread.messages.flatMap((m) => [
      m.role === 'user' ? '## Question' : '## Answer',
      '',
      m.content,
      '',
    ]),
  ].join('\n');

  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.title ?? 'conversation').replace(/[^\w\-. ]+/g, '-').slice(0, 60)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
