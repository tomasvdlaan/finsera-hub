import { useEffect, useState } from 'react';
import { PageHeader } from './ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Empty } from './ui/primitives.js';
import { Markdown } from './ui/MarkdownEditor.js';

interface Starred {
  id: string;
  conversationId: string;
  conversationTitle: string;
  content: string;
  starredAt: string;
}

/**
 * The answers worth keeping, away from the threads they came from.
 *
 * Often the unit you want is one answer rather than a conversation — the paragraph that
 * finally explained the VAT rule, in a thread that was mostly about something else. Filing
 * the whole conversation would bury it again.
 */
export function StarredAnswers() {
  const [answers, setAnswers] = useState<Starred[]>();
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<Starred[]>('/assistant/starred')
      .then(setAnswers)
      .catch((e: Error) => setError(e.message));

  useEffect(() => void load(), []);

  const unstar = async (id: string) => {
    await api.post(`/assistant/messages/${id}/mark`, { starred: false });
    await load();
  };

  return (
    <>
      <p>
        <Link to="/assistant">← Assistant</Link>
      </p>
      <PageHeader title="Saved answers" />
      {error && <p className="error">{error}</p>}

      {answers === undefined ? (
        <p className="muted">Loading…</p>
      ) : answers.length === 0 ? (
        <Empty>
          Nothing saved yet. Star an answer and it appears here, with a way back to the
          conversation it came from.
        </Empty>
      ) : (
        <ul className="starred-list">
          {answers.map((a) => (
            <li key={a.id}>
              <div className="row starred-head">
                {/* The thread is how you get the context back, so it is the link, not a label. */}
                <Link to={`/assistant/${a.conversationId}`} className="muted">
                  {a.conversationTitle}
                </Link>
                <button type="button" className="link-button" onClick={() => void unstar(a.id)}>
                  unstar
                </button>
              </div>
              <Markdown value={a.content} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
