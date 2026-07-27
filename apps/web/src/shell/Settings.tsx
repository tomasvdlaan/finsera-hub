import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';

interface OrgSettings {
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  kvkNumber: string;
  vatNumber: string;
  iban: string;
  invoiceEmail: string;
  invoiceNumberPrefix: string;
  defaultPaymentTermsDays: number;
}

const FIELDS: Array<{ key: keyof OrgSettings; label: string; hint?: string }> = [
  { key: 'legalName', label: 'Legal name', hint: 'As registered at the KvK — printed on every invoice' },
  { key: 'addressLine1', label: 'Address' },
  { key: 'addressLine2', label: 'Postcode & city' },
  { key: 'kvkNumber', label: 'KvK number' },
  { key: 'vatNumber', label: 'BTW number', hint: 'NL…B01' },
  { key: 'iban', label: 'IBAN', hint: 'Where clients pay' },
  { key: 'invoiceEmail', label: 'Invoice email' },
  { key: 'invoiceNumberPrefix', label: 'Invoice number prefix', hint: 'Optional — numbers look like 2026-0001' },
];

/**
 * Organisation settings — the header of every invoice and quote.
 *
 * A form rather than inline edits: these fields change together (a move changes three of
 * them) and rarely, so save-as-a-set fits how they are actually edited.
 */
export function Settings() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OrgSettings>('/core/settings')
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setSaved(false);
    try {
      await api.put('/core/settings', settings);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!settings) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const ready = settings.legalName && settings.kvkNumber && settings.vatNumber && settings.iban;

  return (
    <>
      <h1>Organisation</h1>
      <p className="muted">
        These details print on every invoice and quote. They are legally required on invoices —
        an invoice without the sender&rsquo;s KvK and BTW numbers is not a valid invoice.
      </p>

      {!ready && (
        <p className="error">
          Incomplete: legal name, KvK, BTW number and IBAN are all required before issuing a
          real invoice.
        </p>
      )}

      <form onSubmit={(e) => void save(e)} style={{ maxWidth: '32rem' }}>
        {FIELDS.map(({ key, label, hint }) => (
          <div key={key} style={{ marginBottom: '0.75rem' }}>
            <label className="muted" style={{ display: 'block', marginBottom: '0.2rem' }}>
              {label}
              {hint && <span style={{ opacity: 0.7 }}> — {hint}</span>}
            </label>
            <input
              value={String(settings[key] ?? '')}
              onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
              aria-label={label}
              style={{ width: '100%' }}
            />
          </div>
        ))}

        <div style={{ marginBottom: '0.75rem' }}>
          <label className="muted" style={{ display: 'block', marginBottom: '0.2rem' }}>
            Default payment terms (days)
          </label>
          <input
            value={String(settings.defaultPaymentTermsDays)}
            onChange={(e) =>
              setSettings({ ...settings, defaultPaymentTermsDays: Number(e.target.value) || 30 })
            }
            aria-label="Default payment terms"
            style={{ width: '6rem' }}
          />
        </div>

        <div className="row">
          <button type="submit">Save</button>
          {saved && <span className="muted">saved</span>}
        </div>
      </form>
      {error && <p className="error">{error}</p>}
    </>
  );
}
