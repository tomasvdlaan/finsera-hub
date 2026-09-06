import { api, type PortalTask } from '../lib/api.js';
import { Card, Listing, Page, date, useList } from './shared.js';

/** Card types, in words a client uses. `spike` is research; nobody outside says "spike". */
const TYPE: Record<string, string> = {
  story: 'Werk',
  bug: 'Herstel',
  chore: 'Onderhoud',
  spike: 'Onderzoek',
};

/**
 * The work being done for this client, grouped by project.
 *
 * Only tasks somebody deliberately marked visible, and only in the reduced form the module
 * declares — no description, no assignee, no estimate. Read-only: a client moving a card
 * would be a client editing our board.
 *
 * Grouped rather than a flat list because a client thinks in projects, and the tasks of two
 * projects interleaved by rank is a list that reads as noise.
 */
export function Tasks() {
  const { rows, error } = useList<PortalTask>(api.tasks);

  return (
    <Page title="Taken" lead="Waar we op dit moment aan werken, per project.">
      <Listing rows={rows} error={error} empty="Er staat op dit moment niets voor u open.">
        {(tasks) => {
        const byProject = new Map<string, PortalTask[]>();
        for (const t of tasks) {
          const list = byProject.get(t.project_name) ?? [];
          list.push(t);
          byProject.set(t.project_name, list);
        }

        return (
          <>
            {[...byProject.entries()].map(([project, items]) => (
              <section key={project}>
                <h2>{project}</h2>
                <Card>
                  <table>
                  <thead>
                    <tr>
                      <th>Wat</th>
                      <th>Soort</th>
                      <th>Gepland</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>{TYPE[t.type] ?? t.type}</td>
                        <td className="nowrap">{date(t.due_on)}</td>
                        <td>
                          {t.completed_at ? (
                            <span className="tag">Afgerond {date(t.completed_at)}</span>
                          ) : (
                            // The board column's own name, which is ours and is shown as
                            // written: renaming a column should not silently rename it here
                            // into something we did not choose.
                            <span className="tag">{t.status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </Card>
              </section>
            ))}
          </>
        );
        }}
      </Listing>
    </Page>
  );
}
