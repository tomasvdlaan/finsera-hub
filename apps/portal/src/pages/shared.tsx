import { useEffect, useState } from 'react';

/** Money, in the currency the invoice was actually issued in. */
export const euros = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);

export const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

/**
 * One loader for every page.
 *
 * `empty` is a distinct state rather than an empty table, because "you have no invoices"
 * and "something went wrong" look identical otherwise — and for a client with no data,
 * an unexplained blank page reads as the portal being broken.
 */
export function useList<T>(load: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    load()
      .then((r) => live && setRows(r))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
    // `load` is a method on the module-level `api` object, so this runs once per mount
    // rather than on every render.
  }, [load]);

  return { rows, error };
}

export function Listing<T>({
  rows,
  error,
  empty,
  children,
}: {
  rows: T[] | undefined;
  error?: string;
  empty: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="empty">Bezig…</p>;
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return <>{children(rows)}</>;
}
