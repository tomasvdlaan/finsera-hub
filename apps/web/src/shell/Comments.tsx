import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';
import { useDialog } from './ui/Dialog.js';
import { Markdown, MarkdownEditor } from './ui/MarkdownEditor.js';
import { useToast } from './ui/Toast.js';

interface Comment {
  id: string;
  body: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Decided by the server. If the browser decided, hiding the button would be the protection. */
  mine: boolean;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * Discussion on a record, in the shell rather than in a module.
 *
 * The endpoint takes any registry id, so this component works unchanged on a task, a meeting
 * note, an invoice or a contract — the first caller is the task page because that is what was
 * asked for, not because comments are a scrum concept.
 *
 * Deliberately plain: a textarea, a list, and edit/delete on your own. No mentions and no
 * inbox, because until a second colleague can sign in those address an audience of one — the
 * author. They arrive in the same change as the second sign-in.
 */
export function Comments({ entityId }: { entityId: string }) {
  const { confirm } = useDialog();
  const toast = useToast();
  const [thread, setThread] = useState<Comment[]>();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** Who can be named. Fetched once, and empty until it arrives — the picker just stays shut. */
  const [people, setPeople] = useState<Array<{ id: string; displayName: string }>>([]);
  /** The `@…` being typed at the caret, or null when there is not one. */
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    api
      .get<Comment[]>(`/core/comments/${entityId}`)
      .then(setThread)
      .catch((e: Error) => setError(e.message));
  }, [entityId]);

  useEffect(load, [load]);

  useEffect(() => {
    api
      .get<Array<{ id: string; displayName: string }>>('/core/mentionable')
      // Silently: naming somebody is a convenience, and a failed lookup should cost the
      // picker rather than the ability to comment.
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  /*
   * What the caret is in the middle of typing, if it is a name.
   *
   * Read from the text before the caret rather than tracked as you type, so pasting, undo and
   * clicking somewhere else all give the same answer as typing does. The `@` has to start a
   * word, matching what the server will accept — offering a completion that would not be
   * recognised is worse than offering none.
   */
  const suggesting = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && /[\w@]/.test(before[at - 1] ?? '')) return null;
    const typed = before.slice(at + 1);
    // A name, not a paragraph: two words is enough for "First Last" and stops the menu
    // reappearing halfway down a sentence that happened to contain an address.
    if (/\n/.test(typed) || typed.split(/\s+/).length > 2) return null;
    return typed;
  }, []);

  const matches =
    query === null
      ? []
      : people
          .filter((p) => p.displayName.toLowerCase().startsWith(query.toLowerCase()))
          .slice(0, 6);

  const insert = (name: string) => {
    const el = composer.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return;
    const next = `${body.slice(0, at)}@${name} ${body.slice(caret)}`;
    setBody(next);
    setQuery(null);
    // The caret goes after the name, not to the end: people carry on mid-sentence.
    const to = at + name.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(to, to);
    });
  };

  const post = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(undefined);
    api
      .post(`/core/comments/${entityId}`, { body, parentId: replyTo ?? undefined })
      .then(() => {
        setBody('');
        setReplyTo(null);
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const saveEdit = (id: string) => {
    setBusy(true);
    api
      .patch(`/core/comments/${id}`, { body: draft })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const remove = async (id: string) => {
    // A comment is somebody's words and deleting one is not routine, so it asks — unlike a
    // time entry, which gets an undo instead.
    const go = await confirm({
      title: 'Delete this comment?',
      body: 'It leaves a marker so any reply still makes sense, but the text is gone.',
      confirmLabel: 'Delete comment',
      destructive: true,
    });
    if (!go) return;
    setBusy(true);
    api
      .del(`/core/comments/${id}`)
      .then(() => {
        toast.ok('Comment deleted');
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const top = (thread ?? []).filter((c) => !c.parentId);
  const repliesTo = (id: string) => (thread ?? []).filter((c) => c.parentId === id);

  const render = (c: Comment, isReply = false) => (
    <li key={c.id} className={isReply ? 'comment comment-reply' : 'comment'}>
      <div className="comment-head">
        <strong>{c.authorName}</strong>
        <span className="muted">
          {when(c.createdAt)}
          {c.editedAt && ' · edited'}
        </span>
      </div>

      {c.deleted ? (
        <p className="muted">
          <em>This comment was deleted.</em>
        </p>
      ) : editing === c.id ? (
        <>
          <MarkdownEditor value={draft} onSave={setDraft} placeholder="Edit your comment…" />
          <div className="row">
            <button onClick={() => saveEdit(c.id)} disabled={busy || !draft.trim()}>
              Save
            </button>
            <button className="link-button" onClick={() => setEditing(null)}>
              cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {/* The same Markdown a note is written in, so a screenshot pasted into a remark
              about a card behaves exactly as one pasted into the card itself. */}
          <Markdown
            value={c.body}
            className="comment-body"
            names={people.map((p) => p.displayName)}
          />
          <div className="comment-actions">
            {!isReply && (
              <button className="link-button" onClick={() => setReplyTo(c.id)}>
                reply
              </button>
            )}
            {c.mine && (
              <>
                <button
                  className="link-button"
                  onClick={() => {
                    setEditing(c.id);
                    setDraft(c.body);
                  }}
                >
                  edit
                </button>
                <button className="link-button destructive" onClick={() => void remove(c.id)}>
                  delete
                </button>
              </>
            )}
          </div>
        </>
      )}

      {!isReply && repliesTo(c.id).length > 0 && (
        <ul className="comment-list">{repliesTo(c.id).map((r) => render(r, true))}</ul>
      )}
    </li>
  );

  return (
    <>
      {error && <p className="error">{error}</p>}

      {thread === undefined ? (
        <p className="muted">Loading…</p>
      ) : top.length === 0 ? (
        <p className="muted">
          Nothing discussed yet. What you write here is what you will read in six months when
          you have forgotten why.
        </p>
      ) : (
        <ul className="comment-list">{top.map((c) => render(c))}</ul>
      )}

      <form onSubmit={post}>
        {replyTo && (
          <p className="tag">
            Replying{' '}
            <button className="link-button" onClick={() => setReplyTo(null)} type="button">
              cancel
            </button>
          </p>
        )}
        <div className="comment-compose">
          <textarea
            ref={composer}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setQuery(suggesting(e.target.value, e.target.selectionStart));
              setPick(0);
            }}
            /* Clicking elsewhere in the text is a way of abandoning the name, too. */
            onClick={(e) => setQuery(suggesting(body, e.currentTarget.selectionStart))}
            onBlur={() => setQuery(null)}
            onKeyDown={(e) => {
              if (matches.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setPick((i) => (i + 1) % matches.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((i) => (i - 1 + matches.length) % matches.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                // Enter picks the name rather than submitting, but only while the menu is
                // open — otherwise it would stop being the key that posts a comment.
                e.preventDefault();
                insert(matches[pick]!.displayName);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setQuery(null);
              }
            }}
            placeholder={
              replyTo ? 'Your reply…' : 'Add a note — @ to name someone, or say why this changed…'
            }
            rows={3}
            maxLength={10_000}
            style={{ width: '100%' }}
          />
          {matches.length > 0 && (
            <ul className="mention-menu" role="listbox" aria-label="People">
              {matches.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === pick}
                    className={i === pick ? 'mention-option on' : 'mention-option'}
                    /* Before blur, or the textarea loses focus and the menu closes first. */
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(p.displayName);
                    }}
                  >
                    {p.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" disabled={busy || !body.trim()}>
          {busy ? 'Saving…' : replyTo ? 'Reply' : 'Comment'}
        </button>
      </form>
    </>
  );
}
