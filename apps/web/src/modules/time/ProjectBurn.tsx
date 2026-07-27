import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatMoney } from '../crm/types.js';

interface Burn {
  loggedHours: number;
  billableHours: number;
  invoicedHours: number;
  onDraftHours: number;
  uninvoicedHours: number;
  uninvoicedAmountCents: number | null;
  readyToInvoiceHours: number;
  budgetedHours: number | null;
  budgetAmountCents: number | null;
  burnedAmountCents: number | null;
  currency: string;
  billingModel: string;
}

/**
 * Budget burn — contributed BY the Time module TO CRM's project page, via the manifest's
 * widgets section. CRM gained this without CRM changing, which is the extensibility
 * mechanism doing its job.
 */
export function ProjectBurn({ projectId }: { projectId: string }) {
  const [burn, setBurn] = useState<Burn | null>(null);

  useEffect(() => {
    api
      .get<Burn>(`/time/projects/${projectId}/burn`)
      .then(setBurn)
      .catch(() => setBurn(null));
  }, [projectId]);

  if (!burn) return <p className="muted">No hours logged yet.</p>;

  const pct =
    burn.budgetedHours && burn.budgetedHours > 0
      ? Math.round((burn.loggedHours / burn.budgetedHours) * 100)
      : burn.budgetAmountCents && burn.burnedAmountCents
        ? Math.round((burn.burnedAmountCents / burn.budgetAmountCents) * 100)
        : null;

  const unbilled = burn.uninvoicedHours > 0 || burn.onDraftHours > 0;

  return (
    <div>
      <p>
        <strong>{burn.loggedHours}h</strong> logged
        {burn.budgetedHours != null && <span className="muted"> of {burn.budgetedHours}h budget</span>}
        {burn.billableHours !== burn.loggedHours && (
          <span className="muted"> · {burn.billableHours}h billable</span>
        )}
        {burn.burnedAmountCents != null && (
          <span className="muted">
            {' '}
            · {formatMoney(burn.burnedAmountCents, burn.currency)} at the project rate
          </span>
        )}
      </p>

      {unbilled && (
        <p>
          <strong>{burn.uninvoicedHours}h</strong> not invoiced
          {burn.uninvoicedAmountCents != null && (
            <span className="muted">
              {' '}
              ({formatMoney(burn.uninvoicedAmountCents, burn.currency)})
            </span>
          )}
          {burn.readyToInvoiceHours > 0 && (
            <span className="muted"> · {burn.readyToInvoiceHours}h ready to invoice now</span>
          )}
          {burn.onDraftHours > 0 && (
            <span className="muted"> · {burn.onDraftHours}h on a draft</span>
          )}
          {burn.invoicedHours > 0 && (
            <span className="muted"> · {burn.invoicedHours}h invoiced</span>
          )}
        </p>
      )}

      {pct != null && (
        <>
          <div
            className="meter"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Budget consumed"
          >
            <div
              className="meter-fill"
              style={{
                width: `${Math.min(pct, 100)}%`,
                // Over budget is the thing you must not miss on a glance.
                background: pct > 100 ? 'var(--error)' : pct > 85 ? '#d97706' : 'var(--accent)',
              }}
            />
          </div>
          <p className="muted">{pct}% of budget consumed</p>
        </>
      )}
    </div>
  );
}
