import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationView } from '@platform/contracts';
import { api } from '../lib/api.js';
import { Card } from './ui/card.js';
import { notificationsChanged } from './notifications.js';

const ago = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/**
 * *For you* — what was addressed to you by name.
 *
 * At the top of the Inbox, above everything a rule worked out, because these are the things a
 * person did to you: named you, gave you a task. It replaced the mentions card, which was the
 * first of them; a mention still shows the start of what was written.
 *
 * Unread entries first-class, read ones kept for a fortnight underneath so "where was that
 * thing somebody sent me" still has an answer. Opening one reads it — and its whole group.
 */
export function ForYou() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<NotificationView[]>('/core/notifications')
        .then(setItems)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const read = async (ids?: string[]) => {
    // Optimistic: the server agrees by the time anybody could notice, and a reload would make
    // the row flicker before settling.
    setItems((current) =>
      current.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true, count: 0 } : n)),
    );
    try {
      await api.post('/core/notifications/read', { ids });
      notificationsChanged();
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  };

  const unread = items.filter((n) => !n.read);
  if (items.length === 0 && !error) return null;

  return (
    <Card
      span={12}
      tone={unread.length > 0 ? 'info' : undefined}
      title={unread.length > 0 ? `For you · ${unread.length}` : 'For you'}
      sub="Addressed to you by name — mentions, assignments, clients waiting on you."
      error={error ?? undefined}
      aside={
        unread.length > 0 ? (
          <button type="button" className="chip" onClick={() => void read()}>
            Mark all read
          </button>
        ) : undefined
      }
    >
      <ul className="mention-list for-you">
        {items.map((n) => (
          <li key={n.id} data-read={n.read || undefined}>
            <div className="mention-who">
              {n.url ? (
                // Following it is reading it, so it clears on the way out.
                <Link to={n.url} onClick={() => !n.read && void read([n.id])}>
                  {n.title}
                </Link>
              ) : (
                <span>{n.title}</span>
              )}
              {n.count > 1 && <span className="for-you-more"> · {n.count} new</span>}
            </div>
            {n.excerpt && <p className="mention-excerpt muted">{n.excerpt}</p>}
            <div className="for-you-meta">
              <span className="muted">{ago(n.createdAt)}</span>
              {!n.read && (
                <button type="button" className="link-button" onClick={() => void read([n.id])}>
                  mark read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
