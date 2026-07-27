import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

interface Item {
  id: string;
  title: string;
}

export function DemoList() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<{ items: Item[] }>('/demo/items')
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/demo/items', { title: title.trim() });
      setTitle('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Demo items</h1>
      <p className="muted">
        A throwaway module, deleted at gate G0. Its only job is to prove the core: every
        item below is a registered entity that can be linked, appears on timelines, and is
        already declared to the AI layer.
      </p>

      <form onSubmit={(e) => void create(e)} className="row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New item title"
          aria-label="New item title"
        />
        <button type="submit" disabled={busy || !title.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {items.length === 0 ? (
        <p className="muted">Nothing yet — create one above.</p>
      ) : (
        <ul className="cards">
          {items.map((i) => (
            <li key={i.id}>
              <Link to={`/demo/items/${i.id}`}>{i.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
