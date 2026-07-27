import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { contractUrgency } from './ContractList.js';
import { TYPE_LABELS, type Contract } from './contractTypes.js';

/** Contracts for one client — contributed to CRM's client page through the manifest. */
export function ClientContractsWidget({ clientId }: { clientId: string }) {
  const [contracts, setContracts] = useState<Contract[]>([]);

  useEffect(() => {
    api
      .get<Contract[]>(`/sales/contracts?clientId=${clientId}`)
      .then(setContracts)
      .catch(() => setContracts([]));
  }, [clientId]);

  if (contracts.length === 0) {
    return (
      <p className="muted">
        Nothing recorded — <Link to="/sales/contracts">add a contract</Link>.
      </p>
    );
  }

  const dpa = contracts.find((c) => c.type === 'dpa' && c.status === 'signed');

  return (
    <div>
      {/* Whether AI providers may process this client's data hangs on this one fact. */}
      <p className="muted">
        {dpa
          ? `DPA signed${dpa.allowsSubProcessors ? ` · sub-processors: ${dpa.allowsSubProcessors}` : ''}`
          : 'No signed DPA on file'}
      </p>
      <ul className="cards">
        {contracts.map((contract) => {
          const urgency = contractUrgency(contract);
          return (
            <li key={contract.id}>
              <Link to={`/sales/contracts/${contract.id}`}>{contract.title}</Link>{' '}
              <span className="badge">{TYPE_LABELS[contract.type]}</span>
              <span className="badge">{contract.status}</span>
              {urgency && (
                <span className={`badge${urgency.urgent ? ' priority-urgent' : ''}`}>
                  {urgency.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
