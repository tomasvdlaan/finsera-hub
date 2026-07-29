import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';
import { useDialog } from './ui/Dialog.js';
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

  const load = useCallback(() => {
    api
      .get<Comment[]>(`/core/comments/${entityId}`)
      .then(setThread)
      .catch((e: Error) => setError(e.message));
  }, [entityId]);

  useEffect(load, [load]);

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
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
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
          {/* Pre-wrapped so paragraphs and lists a person typed survive, without giving a
              comment field the whole markdown surface. */}
          <p style={{ whiteSpace: 'pre-wrap', margin: '0.25rem 0' }}>{c.body}</p>
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
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={replyTo ? 'Your reply…' : 'Add a note — a decision, a blocker, why this changed…'}
          rows={3}
          maxLength={10_000}
          style={{ width: '100%' }}
        />
        <button type="submit" disabled={busy || !body.trim()}>
          {busy ? 'Saving…' : replyTo ? 'Reply' : 'Comment'}
        </button>
      </form>
    </>
  );
}
