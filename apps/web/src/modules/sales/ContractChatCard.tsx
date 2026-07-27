import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';
import { contractUrgency } from './ContractList.js';
import { TYPE_LABELS, type Contract } from './contractTypes.js';

/** A contract, as the assistant shows it. Read-only: it never signs anything. */
export function ContractChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [contract, setContract] = useState<Contract | null>(null);

  useEffect(() => {
    api
      .get<Contract>(`/sales/contracts/${id}`)
      .then(setContract)
      .catch(() => setContract(null));
  }, [id]);

  const urgency = contract ? contractUrgency(contract) : null;

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">{contract ? TYPE_LABELS[contract.type] : 'contract'}</span>
        <Link to={urlPath}>{contract?.title ?? displayName}</Link>
        {urgency?.urgent && <span className="badge priority-urgent">{urgency.label}</span>}
      </div>
      {contract && (
        <div className="muted">
          {contract.status}
          {contract.endsOn && ` · ends ${contract.endsOn}`}
          {contract.noticeDays != null && ` · ${contract.noticeDays} days notice`}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
      </div>
    </div>
  );
}
