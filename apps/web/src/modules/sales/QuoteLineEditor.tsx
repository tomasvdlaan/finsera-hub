import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { money, type QuoteDetail, type QuoteLine } from './types.js';

interface EditableLine {
  description: string;
  quantity: string;
  /** Euros as typed; converted to cents only on save. */
  unitPrice: string;
  unit: QuoteLine['unit'];
}

const toEuros = (cents: number) => (cents / 100).toFixed(2);
const toCents = (euros: string): number | null => {
  const parsed = Number(euros.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

/**
 * Draft quote lines: edit, add, remove.
 *
 * Deliberately the same shape as the invoice line editor — the two documents are edited
 * the same way because they are the same kind of thing at different moments. The set
 * saves as one replace, and totals come back from the server's VAT engine rather than
 * being estimated here.
 */
export function QuoteLineEditor({
  quote,
  onSaved,
}: {
  quote: QuoteDetail;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLines(
      quote.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: toEuros(l.unitPriceCents),
        unit: l.unit,
      })),
    );
    setDirty(false);
  }, [quote]);

  const edit = (index: number, patch: Partial<EditableLine>) => {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const addRow = () => {
    setLines((current) => [
      ...current,
      { description: '', quantity: '1.00', unitPrice: '0.00', unit: 'hours' },
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
        unit: line.unit,
      });
    }
    if (payload.length === 0) return setError('A quote needs at least one line');

    setBusy(true);
    try {
      await api.put(`/sales/quotes/${quote.id}/lines`, { lines: payload });
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
              <th>Unit</th>
              <th>Quantity</th>
              <th>Price €</th>
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
                  </td>
                  <td>
                    <select
                      value={line.unit}
                      onChange={(e) => edit(i, { unit: e.target.value as EditableLine['unit'] })}
                      aria-label={`Line ${i + 1} unit`}
                    >
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                      <option value="fixed">fixed</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={line.quantity}
                      onChange={(e) => edit(i, { quantity: e.target.value })}
                      aria-label={`Line ${i + 1} quantity`}
                      style={{ width: 70, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      value={line.unitPrice}
                      onChange={(e) => edit(i, { unitPrice: e.target.value })}
                      aria-label={`Line ${i + 1} price`}
                      style={{ width: 90, textAlign: 'right' }}
                    />
                  </td>
                  <td className="muted">{money(Math.round(amount))}</td>
                  <td>
                    <button
                      className="link-button"
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
              <th scope="row" colSpan={4} style={{ textAlign: 'right' }}>
                Subtotal · BTW · Total
              </th>
              <td className="total" colSpan={2}>
                {money(quote.subtotalCents)} · {money(quote.vatCents)} ·{' '}
                {money(quote.totalCents)}
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
