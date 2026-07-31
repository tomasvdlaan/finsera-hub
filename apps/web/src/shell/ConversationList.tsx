import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from './Icon.js';
import { useDialog } from './ui/Dialog.js';
import { folderTree, groupByDate } from './conversationGroups.js';
import type {
  ConversationQuery,
  ConversationSummary,
  Folder,
  SavedView,
  Tag,
} from './conversation/index.js';

/** An icon button. Every one of these has a word behind it for anyone not using a mouse. */
function IconButton({
  icon,
  label,
  onClick,
  className,
  active,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  className?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={['icon-btn', active && 'is-active', className].filter(Boolean).join(' ')}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** A menu row: glyph, then the word. A menu is read, so it keeps its words. */
function MenuItem({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: string;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={destructive ? 'destructive' : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </button>
  );
}

/**
 * Every conversation, grouped, filtered, searchable and filable.
 *
 * Compact by construction. A sidebar is scanned rather than read, so a row is one line: a
 * title, and the things that qualify it as glyphs and small chips beside it. The second line
 * appears only while searching, when the snippet is the reason the row is there at all.
 *
 * Actions are icons with a `title` and an `aria-label`, which is the trade this makes — a
 * glyph costs a moment of learning and buys back the width that a column of "Rename" and
 * "Archive" was spending. Menus keep their words, because a menu is read once you have
 * already decided to look.
 *
 * The organising idea underneath is that most filing should not need doing: a conversation
 * started from a client's page already knows its client, the answers know what they cited,
 * and dates group themselves. Folders and tags are for the rest.
 */
export function ConversationList({
  history,
  folders,
  tags,
  views,
  query,
  onQuery,
  activeId,
  onOpen,
  onChanged,
  onNew,
}: {
  history: ConversationSummary[];
  folders: Folder[];
  tags: Tag[];
  views: SavedView[];
  query: ConversationQuery;
  onQuery: (q: ConversationQuery) => void;
  activeId?: string;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onNew: () => void;
}) {
  const { ask, confirm } = useDialog();
  const [menu, setMenu] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  /* Selecting then filtering would act on rows nobody can see any more. */
  useEffect(() => setSelected(new Set()), [query]);

  const tree = useMemo(() => folderTree(folders), [folders]);
  const unfiled = useMemo(() => history.filter((c) => !c.folderId), [history]);
  const inFolder = useMemo(() => {
    const map = new Map<string, ConversationSummary[]>();
    for (const c of history) {
      if (!c.folderId) continue;
      const list = map.get(c.folderId) ?? [];
      list.push(c);
      map.set(c.folderId, list);
    }
    return map;
  }, [history]);

  const run = async (work: () => Promise<unknown>) => {
    setMenu(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const patch = (next: Partial<ConversationQuery>) => onQuery({ ...query, ...next });

  // ── one conversation ──────────────────────────────────────

  const rename = async (c: ConversationSummary) => {
    const answer = await ask({
      title: 'Rename',
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
      body: 'The whole thread goes, including its answers. Archiving keeps it, out of the way.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await run(() => api.del(`/assistant/conversations/${c.id}`));
  };

  /** Where the answers say it belongs — offered, never applied. */
  const whereBelongs = async (c: ConversationSummary) => {
    setMenu(null);
    try {
      const found = await api.get<{ displayName: string } | null>(
        `/assistant/conversations/${c.id}/suggested-subject`,
      );
      setNote(found ? `Looks like it is about ${found.displayName}.` : 'Nothing cited yet.');
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const bulk = (body: Record<string, unknown>) =>
    run(() => api.post('/assistant/conversations/bulk', { ids: [...selected], ...body }));

  // ── folders and searches ──────────────────────────────────

  const newFolder = async (parentId?: string) => {
    const answer = await ask({
      title: parentId ? 'Folder inside this one' : 'New folder',
      confirmLabel: 'Create',
      fields: [
        { name: 'name', label: 'Name', required: true, placeholder: 'Billing' },
        { name: 'emoji', label: 'Emoji', placeholder: '📁', hint: 'Optional — for finding it without reading it.' },
      ],
    });
    if (answer?.name) {
      await run(() =>
        api.post('/assistant/folders', {
          name: answer.name,
          emoji: answer.emoji || null,
          parentId: parentId ?? null,
        }),
      );
    }
  };

  const editFolder = async (f: Folder) => {
    const answer = await ask({
      title: 'Folder',
      confirmLabel: 'Save',
      fields: [
        { name: 'name', label: 'Name', required: true, defaultValue: f.name },
        { name: 'emoji', label: 'Emoji', defaultValue: f.emoji ?? '' },
        { name: 'position', label: 'Order', type: 'number', defaultValue: String(f.position) },
      ],
    });
    if (answer?.name) {
      await run(() =>
        api.patch(`/assistant/folders/${f.id}`, {
          name: answer.name,
          emoji: answer.emoji || null,
          position: Number(answer.position) || 0,
        }),
      );
    }
  };

  const deleteFolder = async (f: Folder) => {
    const ok = await confirm({
      title: `Delete "${f.name}"?`,
      // A reader who thinks this deletes the contents will never use folders at all.
      body: 'The conversations inside are kept — they move back to the top level.',
      confirmLabel: 'Delete folder',
      destructive: true,
    });
    if (ok) await run(() => api.del(`/assistant/folders/${f.id}`));
  };

  const saveSearch = async () => {
    const answer = await ask({
      title: 'Save this search',
      body: 'It stays current — a folder you never have to file into.',
      confirmLabel: 'Save',
      fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'Unfiled' }],
    });
    if (answer?.name) await run(() => api.post('/assistant/views', { name: answer.name, query }));
  };

  const dropZone = (folderId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDropTarget(folderId ?? 'none');
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = dragging;
      setDragging(null);
      setDropTarget(null);
      if (id) void run(() => api.post(`/assistant/conversations/${id}/move`, { folderId }));
    },
  });

  // ── a row ─────────────────────────────────────────────────

  const row = (c: ConversationSummary) => (
    <li
      key={c.id}
      className={`crow${dragging === c.id ? ' is-dragging' : ''}${selected.has(c.id) ? ' is-picked' : ''}`}
      draggable
      onDragStart={() => setDragging(c.id)}
      onDragEnd={() => {
        setDragging(null);
        setDropTarget(null);
      }}
    >
      {/* Only once something is selected, or the sidebar is a column of empty boxes. */}
      {selected.size > 0 && (
        <input
          type="checkbox"
          checked={selected.has(c.id)}
          aria-label={`Select ${c.title ?? 'conversation'}`}
          onChange={(e) =>
            setSelected((s) => {
              const next = new Set(s);
              if (e.target.checked) next.add(c.id);
              else next.delete(c.id);
              return next;
            })
          }
        />
      )}

      <button
        type="button"
        className={c.id === activeId ? 'crow-open active' : 'crow-open'}
        onClick={() => onOpen(c.id)}
      >
        <span className="crow-line">
          {c.pinnedAt && <Icon name="pin" size={11} />}
          {c.archivedAt && <Icon name="archive" size={11} />}
          <span className="crow-title">{c.title ?? 'Untitled'}</span>
          {/* Counts rather than names: three tag chips on a 240px row is a row of chips. */}
          {c.subject && (
            <span className="crow-badge" title={c.subject.displayName}>
              <Icon name="users" size={10} />
            </span>
          )}
          {c.tags.length > 0 && (
            <span
              className="crow-badge"
              title={c.tags.map((t) => t.name).join(', ')}
              style={c.tags[0]?.colour ? { color: c.tags[0].colour } : undefined}
            >
              <Icon name="tag" size={10} />
              {c.tags.length > 1 && c.tags.length}
            </span>
          )}
        </span>
        {/* The second line exists only while searching, when it is the reason for the row. */}
        {c.snippet && <span className="crow-snippet">{c.snippet}</span>}
      </button>

      <IconButton
        icon="more"
        label={`Actions for ${c.title ?? 'this conversation'}`}
        className="crow-more"
        onClick={() => setMenu((m) => (m === c.id ? null : c.id))}
      />

      {menu === c.id && (
        <div className="row-menu" role="menu">
          <MenuItem icon="pencil" onClick={() => void rename(c)}>
            Rename
          </MenuItem>
          <MenuItem
            icon="pin"
            onClick={() =>
              void run(() =>
                api.post(`/assistant/conversations/${c.id}/pin`, { pinned: !c.pinnedAt }),
              )
            }
          >
            {c.pinnedAt ? 'Unpin' : 'Pin to top'}
          </MenuItem>
          <MenuItem
            icon="archive"
            onClick={() =>
              void run(() =>
                api.post(`/assistant/conversations/${c.id}/archive`, { archived: !c.archivedAt }),
              )
            }
          >
            {c.archivedAt ? 'Unarchive' : 'Archive'}
          </MenuItem>
          <MenuItem icon="check" onClick={() => setSelected(new Set([c.id]))}>
            Select
          </MenuItem>
          <MenuItem icon="compass" onClick={() => void whereBelongs(c)}>
            Where does this belong?
          </MenuItem>
          <MenuItem icon="download" onClick={() => void exportThread(c)}>
            Export
          </MenuItem>

          {tags.length > 0 && <hr />}
          {tags.map((t) => {
            const on = c.tags.some((x) => x.id === t.id);
            return (
              <MenuItem
                key={t.id}
                icon={on ? 'check' : 'tag'}
                onClick={() =>
                  void run(() =>
                    api.post(`/assistant/conversations/${c.id}/tags`, { tagId: t.id, on: !on }),
                  )
                }
              >
                {t.name}
              </MenuItem>
            );
          })}

          <hr />
          <MenuItem icon="trash" destructive onClick={() => void remove(c)}>
            Delete
          </MenuItem>
        </div>
      )}
    </li>
  );

  /** Dates inside a folder would be six headings under every drawer. Flat there, grouped outside. */
  const grouped = (items: ConversationSummary[]) =>
    groupByDate(items).map((g) => (
      <div key={g.key} className="date-group">
        <h3>{g.label}</h3>
        <ul>{g.items.map(row)}</ul>
      </div>
    ));

  const folderRow = (f: Folder, nested: boolean) => {
    const inside = inFolder.get(f.id) ?? [];
    const open = !collapsed.has(f.id) || Boolean(query.q);
    return (
      <section
        key={f.id}
        className={[
          'cfolder',
          nested && 'is-nested',
          dropTarget === f.id && 'is-drop-target',
        ]
          .filter(Boolean)
          .join(' ')}
        {...dropZone(f.id)}
      >
        <div className="cfolder-head">
          <button
            type="button"
            className="cfolder-toggle"
            aria-expanded={open}
            onClick={() =>
              setCollapsed((s) => {
                const next = new Set(s);
                if (next.has(f.id)) next.delete(f.id);
                else next.add(f.id);
                return next;
              })
            }
          >
            <span className={open ? 'caret is-open' : 'caret'} aria-hidden="true">
              <Icon name="chevron" size={12} />
            </span>
            <span className="cfolder-name">
              {f.emoji ? <span aria-hidden="true">{f.emoji}</span> : <Icon name="folder" size={13} />}
              {f.name}
            </span>
            <span className="cfolder-count">{inside.length}</span>
          </button>
          <IconButton
            icon="more"
            label={`Actions for folder ${f.name}`}
            onClick={() => setMenu((m) => (m === `f-${f.id}` ? null : `f-${f.id}`))}
          />
          {menu === `f-${f.id}` && (
            <div className="row-menu" role="menu">
              <MenuItem icon="pencil" onClick={() => void editFolder(f)}>
                Rename, emoji, order
              </MenuItem>
              {!nested && (
                <MenuItem icon="plus" onClick={() => void newFolder(f.id)}>
                  Folder inside
                </MenuItem>
              )}
              <MenuItem icon="search" onClick={() => onQuery({ folderId: f.id })}>
                Show only this
              </MenuItem>
              <MenuItem icon="trash" destructive onClick={() => void deleteFolder(f)}>
                Delete folder
              </MenuItem>
            </div>
          )}
        </div>
        {open && inside.length > 0 && <ul>{inside.map(row)}</ul>}
      </section>
    );
  };

  const filtering = Boolean(
    query.q || query.folderId || query.tagId || query.archivedOnly || query.sort,
  );

  return (
    <aside className="assistant-history" ref={listRef}>
      {/* One row: search, new chat. The heading was a word nobody needed twice. */}
      <div className="clist-top">
        <label className="clist-search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={query.q ?? ''}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder="Search"
            aria-label="Search conversations"
          />
        </label>
        <IconButton icon="plus" label="New conversation" onClick={onNew} className="is-primary" />
      </div>

      <div className="clist-tools">
        <select
          value={query.sort ?? 'recent'}
          onChange={(e) => patch({ sort: e.target.value as ConversationQuery['sort'] })}
          aria-label="Sort"
          title="Sort"
        >
          <option value="recent">Recent</option>
          <option value="oldest">Oldest</option>
          <option value="title">A–Z</option>
        </select>

        {tags.length > 0 && (
          <select
            value={query.tagId ?? ''}
            onChange={(e) => patch({ tagId: e.target.value || undefined })}
            aria-label="Filter by tag"
            title="Filter by tag"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        <IconButton
          icon="archive"
          label="Show archived"
          active={Boolean(query.archivedOnly)}
          onClick={() => patch({ archivedOnly: !query.archivedOnly })}
        />
        {/* A link, not a button: it navigates, and middle-click should open it in a tab. */}
        <Link to="/assistant/starred" className="icon-btn" title="Saved answers" aria-label="Saved answers">
          <Icon name="star" size={14} />
        </Link>
        <IconButton icon="folder" label="New folder" onClick={() => void newFolder()} />
        {filtering && (
          <>
            <IconButton icon="download" label="Save this search" onClick={() => void saveSearch()} />
            <IconButton icon="x" label="Clear filters" onClick={() => onQuery({})} />
          </>
        )}
      </div>

      {views.length > 0 && (
        <div className="saved-views">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className="chip"
              onClick={() => onQuery(v.query)}
              onContextMenu={(e) => {
                e.preventDefault();
                void run(() => api.del(`/assistant/views/${v.id}`));
              }}
              title="Right-click to remove"
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      {note && (
        <p className="clist-note muted" onClick={() => setNote(null)}>
          {note}
        </p>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <strong>{selected.size}</strong>
          <select
            value=""
            onChange={(e) =>
              e.target.value && void bulk({ move: e.target.value === 'none' ? null : e.target.value })
            }
            aria-label="Move selected to folder"
            title="Move to folder"
          >
            <option value="">Move…</option>
            <option value="none">Top level</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <IconButton icon="archive" label="Archive selected" onClick={() => void bulk({ archive: true })} />
          <IconButton icon="pin" label="Pin selected" onClick={() => void bulk({ pin: true })} />
          <IconButton
            icon="trash"
            label={`Delete ${selected.size} conversations`}
            className="is-danger"
            onClick={async () => {
              const ok = await confirm({
                title: `Delete ${selected.size} conversations?`,
                body: 'Every thread and every answer in them. This cannot be undone.',
                confirmLabel: `Delete ${selected.size}`,
                destructive: true,
              });
              if (ok) {
                await bulk({ delete: true });
                setSelected(new Set());
              }
            }}
          />
          <IconButton icon="x" label="Cancel selection" onClick={() => setSelected(new Set())} />
        </div>
      )}

      {tree.map(({ folder, children }) => (
        <div key={folder.id}>
          {folderRow(folder, false)}
          {!collapsed.has(folder.id) && children.map((child) => folderRow(child, true))}
        </div>
      ))}

      <section
        className={`cunfiled${dropTarget === 'none' ? ' is-drop-target' : ''}`}
        {...dropZone(null)}
      >
        {/* Named and counted, so filing is a visible, finishable task rather than ambient. */}
        {folders.length > 0 && unfiled.length > 0 && (
          <div className="cfolder-head">
            <span className="cfolder-toggle">
              <span className="cfolder-name">Unfiled</span>
              <span className="cfolder-count">{unfiled.length}</span>
            </span>
          </div>
        )}
        {grouped(unfiled)}
      </section>

      {history.length === 0 && (
        <p className="muted clist-empty">{query.q ? 'Nothing matches.' : 'Nothing yet.'}</p>
      )}
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
  const thread = await api.get<{ messages: Array<{ role: string; content: string }> }>(
    `/assistant/conversations/${c.id}`,
  );
  const body = [
    `# ${c.title ?? 'Conversation'}`,
    '',
    ...thread.messages.flatMap((m) => [m.role === 'user' ? '## Question' : '## Answer', '', m.content, '']),
  ].join('\n');

  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.title ?? 'conversation').replace(/[^\w\-. ]+/g, '-').slice(0, 60)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
