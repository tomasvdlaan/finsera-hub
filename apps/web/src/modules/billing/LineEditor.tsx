import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { money, type InvoiceDetail } from './types.js';

interface EditableLine {
  description: string;
  quantity: string;
  /** Euros as typed; converted to cents only on save. */
  unitPrice: string;
  /**
   * Carried invisibly through every edit. Dropping these would free the billed hours
   * for a second invoice — editing a description must never unbill the time behind it.
   */
  sourceEntryIds: string[];
}

const toEuros = (cents: number) => (cents / 100).toFixed(2);
const toCents = (euros: string): number | null => {
  const parsed = Number(euros.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

/**
 * Draft invoice lines: edit, add, remove.
 *
 * The whole set saves as one replace — totals and VAT are recomputed server-side, so
 * the numbers shown after saving are the numbers that will be issued, not a client-side
 * estimate that might round differently.
 */
export function LineEditor({
  invoice,
  onSaved,
}: {
  invoice: InvoiceDetail;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLines(
      invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: toEuros(l.unitPriceCents),
        sourceEntryIds: l.sourceEntryIds ?? [],
      })),
    );
    setDirty(false);
  }, [invoice]);

  const edit = (index: number, patch: Partial<EditableLine>) => {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const addRow = () => {
    setLines((current) => [
      ...current,
      { description: '', quantity: '1.00', unitPrice: '0.00', sourceEntryIds: [] },
    ]);
    setDirty(true);
  };

  const removeRow = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  };

  const save = async () => {
    setError(null);
    const payload = [];
    for (const [i, line] of lines.entries()) {
      const description = line.description.trim();
      if (!description) return setError(`Line ${i + 1} needs a description`);
      const quantity = Number(line.quantity.replace(',', '.'));
      if (!Number.isFinite(quantity) || quantity === 0) {
        return setError(`Line ${i + 1}: "${line.quantity}" is not a valid quantity`);
      }
      const unitPriceCents = toCents(line.unitPrice);
      if (unitPriceCents == null) {
        return setError(`Line ${i + 1}: "${line.unitPrice}" is not a valid price`);
      }
      payload.push({
        description,
        quantity: quantity.toFixed(2),
        unitPriceCents,
        sourceEntryIds: line.sourceEntryIds,
      });
    }
    if (payload.length === 0) return setError('An invoice needs at least one line');

    setBusy(true);
    try {
      await api.put(`/billing/invoices/${invoice.id}/lines`, { lines: payload });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Description</th>
              <th>Hours</th>
              <th>Rate €</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const amount =
                (Number(line.quantity.replace(',', '.')) || 0) * (toCents(line.unitPrice) ?? 0);
              return (
                <tr key={i}>
                  <td style={{ textAlign: 'left' }}>
                    <input
                      value={line.description}
                      onChange={(e) => edit(i, { description: e.target.value })}
                      aria-label={`Line ${i + 1} description`}
                      style={{ width: '100%', minWidth: 220 }}
                    />
                    {line.sourceEntryIds.length > 0 && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        bills {line.sourceEntryIds.length} time{' '}
                        {line.sourceEntryIds.length === 1 ? 'entry' : 'entries'}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      value={line.quantity}
                      onChange={(e) => edit(i, { quantity: e.target.value })}
                      aria-label={`Line ${i + 1} hours`}
                      style={{ width: 70, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      value={line.unitPrice}
                      onChange={(e) => edit(i, { unitPrice: e.target.value })}
                      aria-label={`Line ${i + 1} rate`}
                      style={{ width: 90, textAlign: 'right' }}
                    />
                  </td>
                  <td className="muted">{money(Math.round(amount))}</td>
                  <td>
                    <button
                      className="link-button destructive"
                      onClick={() => removeRow(i)}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                Subtotal · BTW · Total
              </th>
              <td className="total" colSpan={2}>
                {money(invoice.subtotalCents)} · {money(invoice.vatCents)} ·{' '}
                {money(invoice.totalCents)}
                {dirty && <span className="muted"> (before edits)</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <button className="link-button" onClick={addRow}>
          + add line
        </button>
        <button onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save lines'}
        </button>
        {dirty && !busy && <span className="muted">unsaved changes — totals update on save</span>}
      </div>
    </div>
  );
}
