import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';
import { formatMoney, humanise, type Client, type Project } from './types.js';

/** A client, as the assistant shows it: status plus how much work sits under it. */
export function ClientChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [data, setData] = useState<{ client: Client; projects: Project[] } | null>(null);

  useEffect(() => {
    api
      .get<{ client: Client; projects: Project[] }>(`/crm/clients/${id}/overview`)
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">client</span>
        <Link to={urlPath}>{data?.client.name ?? displayName}</Link>
      </div>
      {data && (
        <div className="muted">
          {humanise(data.client.status)} · {data.projects.length} project
          {data.projects.length === 1 ? '' : 's'}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
      </div>
    </div>
  );
}

/** A project, with its commercials — the numbers you would otherwise go looking for. */
export function ProjectChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [burn, setBurn] = useState<{ loggedHours: number; budgetedHours: number | null } | null>(
    null,
  );

  useEffect(() => {
    api
      .get<Project>(`/crm/projects/${id}`)
      .then(setProject)
      .catch(() => setProject(null));
    // Burn comes from the Time module — the card shows the cross-module picture.
    api
      .get<{ loggedHours: number; budgetedHours: number | null }>(`/time/projects/${id}/burn`)
      .then(setBurn)
      .catch(() => setBurn(null));
  }, [id]);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">project</span>
        <Link to={urlPath}>{project?.name ?? displayName}</Link>
      </div>
      {project && (
        <div className="muted">
          {humanise(project.status)} · {humanise(project.billingModel)}
          {project.defaultRateCents != null &&
            ` · ${formatMoney(project.defaultRateCents, project.currency)}/hr`}
        </div>
      )}
      {burn && (
        <div className="muted">
          {burn.loggedHours}h logged
          {burn.budgetedHours != null && ` of ${burn.budgetedHours}h budget`}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
        <Link to={`/board?projectId=${id}`}>board</Link>
      </div>
    </div>
  );
}
