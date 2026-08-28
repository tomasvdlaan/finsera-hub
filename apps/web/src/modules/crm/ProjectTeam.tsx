import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Empty } from '../../shell/ui/primitives.js';
import { useCan } from '../../shell/useCan.js';
import { useDialog } from '../../shell/ui/Dialog.js';

/**
 * Who is on this project.
 *
 * Reading it is open to anyone who can see the project — knowing who your colleagues are on a
 * piece of work is not a privilege inside a company, it is how you know who to ask. Changing it
 * takes `crm.projects.assign`, which is admin-only: deciding who works on what is how the owner
 * allocates the only resource this business really has.
 *
 * So a member sees the same names and no controls at all — not disabled controls. A button that
 * is visible and refuses is worse than one that was never offered, because it reads as broken
 * rather than as not-yours.
 */

export interface Member {
  userId: string;
  role: 'lead' | 'contributor';
  displayName: string;
  email?: string;
  isActive?: boolean;
}

interface Assignable {
  id: string;
  displayName: string;
}

export function ProjectTeam({ projectId }: { projectId: string }) {
  const { can } = useCan();
  const dialog = useDialog();
  const mayAssign = can('crm.projects.assign');

  const [members, setMembers] = useState<Member[]>();
  const [people, setPeople] = useState<Assignable[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Member[]>(`/crm/projects/${projectId}/members`)
      .then(setMembers)
      .catch((e: Error) => setError(e.message));
    // The names-only list, which any signed-in member may read. Failing quietly: without it the
    // picker has nothing to offer, but the team itself still reads fine.
    api.get<Assignable[]>('/core/users').then(setPeople).catch(() => undefined);
  }, [projectId]);

  const act = async (run: () => Promise<Member[]>) => {
    setBusy(true);
    setError(undefined);
    try {
      setMembers(await run());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (userId: string) =>
    act(() => api.put<Member[]>(`/crm/projects/${projectId}/members`, { userId }));

  const setLead = (m: Member) =>
    act(() =>
      api.put<Member[]>(`/crm/projects/${projectId}/members`, {
        userId: m.userId,
        // Promoting demotes the incumbent server-side, in one transaction. Doing it here as two
        // calls would leave a window with no lead, or two.
        role: 'lead',
      }),
    );

  /*
   * Removing somebody asks first.
   *
   * Not because it destroys anything — their hours and cards are untouched, and the copy says
   * so — but because it silently changes who a dozen other screens think is on this work, and
   * an accidental click has no visible consequence until somebody wonders why they stopped
   * appearing.
   */
  const remove = async (m: Member) => {
    const ok = await dialog.confirm({
      title: `Take ${m.displayName} off this project?`,
      body: 'The hours they logged and the cards assigned to them are untouched — this only changes who is on it from now on.',
      confirmLabel: 'Take them off',
      destructive: true,
    });
    if (!ok) return;
    await act(() => api.del<Member[]>(`/crm/projects/${projectId}/members/${m.userId}`));
  };

  const onIt = new Set((members ?? []).map((m) => m.userId));
  const available = people.filter((p) => !onIt.has(p.id));

  return (
    <div className="team">
      {error && <p className="error">{error}</p>}

      {members === undefined ? (
        <p className="muted">Loading…</p>
      ) : members.length === 0 ? (
        <Empty>
          {mayAssign
            ? 'Nobody is on this project yet. Adding somebody is how the board, the assignee pickers and their own page learn what they work on.'
            : 'Nobody has been put on this project yet.'}
        </Empty>
      ) : (
        <ul className="team-list">
          {members.map((m) => (
            <li key={m.userId}>
              <Avatar id={m.userId} name={m.displayName} size="sm" />
              <div className="team-who">
                <Link to={`/settings/people/${m.userId}`}>{m.displayName}</Link>
                {m.role === 'lead' && <span className="team-lead">leads it</span>}
              </div>
              {mayAssign && (
                <div className="team-actions">
                  {m.role !== 'lead' && (
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() => void setLead(m)}
                    >
                      make lead
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-button destructive"
                    disabled={busy}
                    onClick={() => void remove(m)}
                  >
                    remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {mayAssign && available.length > 0 && (
        <div className="team-add">
          <label className="label" htmlFor={`add-${projectId}`}>
            Put somebody on it
          </label>
          <div className="row">
            <select
              id={`add-${projectId}`}
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) void add(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">Choose somebody…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The same fact at a glance: faces, and how many.
 *
 * For a list row, where the question is "is anybody on this" rather than "who exactly". Capped
 * at three with the remainder counted — five faces in a table cell is a texture, not
 * information. Unassigned says so in words rather than rendering an empty space that reads as
 * a loading state that never finished.
 */
export function TeamGlance({ members }: { members?: Member[] }) {
  if (!members || members.length === 0) return <span className="muted">nobody yet</span>;
  const shown = members.slice(0, 3);
  const rest = members.length - shown.length;
  return (
    <span className="avatar-stack" title={members.map((m) => m.displayName).join(', ')}>
      {shown.map((m) => (
        <Avatar key={m.userId} id={m.userId} name={m.displayName} size="sm" />
      ))}
      {rest > 0 && (
        <span className="avatar avatar-sm avatar-rest" title={`${rest} more`}>
          +{rest}
        </span>
      )}
    </span>
  );
}
