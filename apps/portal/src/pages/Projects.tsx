import { api, type PortalProject } from '../lib/api.js';
import { Card, Listing, Page, date, useList } from './shared.js';

const STATUS: Record<string, string> = {
  active: 'Loopt',
  on_hold: 'Gepauzeerd',
  completed: 'Afgerond',
  cancelled: 'Geannuleerd',
};

export function Projects() {
  const { rows, error } = useList<PortalProject>(api.projects);

  return (
    <Page title="Projecten" lead="Het werk dat we voor u doen, en waar het staat.">
      <Listing rows={rows} error={error} empty="Er lopen op dit moment geen projecten.">
        {(projects) => (
          <Card>
            <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Start</th>
              <th>Einde</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{STATUS[p.status] ?? p.status}</td>
                <td className="nowrap">{date(p.starts_on)}</td>
                <td className="nowrap">{date(p.ends_on)}</td>
              </tr>
            ))}
          </tbody>
            </table>
          </Card>
        )}
      </Listing>
    </Page>
  );
}
