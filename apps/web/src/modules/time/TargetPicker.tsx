export interface Target {
  projectId?: string | null;
  clientId?: string | null;
}

export interface PickerProject {
  id: string;
  name: string;
  clientName?: string | null;
}

export interface PickerClient {
  id: string;
  name: string;
}

/** `p:<id>` / `c:<id>` / `''`. One value, so a native select can carry all three shapes. */
export const encodeTarget = (t: Target): string =>
  t.projectId ? `p:${t.projectId}` : t.clientId ? `c:${t.clientId}` : '';

export function decodeTarget(value: string): Target {
  if (value.startsWith('p:')) return { projectId: value.slice(2), clientId: null };
  if (value.startsWith('c:')) return { projectId: null, clientId: value.slice(2) };
  return { projectId: null, clientId: null };
}

/**
 * What an hour is against: a project, a client, or neither.
 *
 * It was a list of projects, which meant every hour had to belong to a billable project of a
 * paying customer — so internal work got logged against a customer record Finsera had created
 * for itself, on a time-and-materials project that will never be invoiced. The picker was
 * asking a question the business could not always answer, and the answer it forced put fake
 * sales in the pipeline.
 *
 * A native select with option groups rather than a bespoke popover: three groups is not enough
 * content to justify one, and the browser's own control is already searchable by typing,
 * keyboard-navigable and correct on a phone. The prefixed value is what lets one `<select>`
 * express two different kinds of id and the absence of both.
 */
export function TargetPicker({
  value,
  projects,
  clients,
  onChange,
  label = 'What is this against?',
  id,
}: {
  value: Target;
  projects: PickerProject[];
  clients: PickerClient[];
  onChange: (target: Target) => void;
  label?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={encodeTarget(value)}
      onChange={(e) => onChange(decodeTarget(e.target.value))}
    >
      {/*
        First, and deliberately not called "None".

        Building this platform is not the absence of work — it is work with nobody to bill,
        which is a different thing and the commonest thing a small consultancy does between
        engagements.
      */}
      <option value="">Internal — no client</option>

      {projects.length > 0 && (
        <optgroup label="Projects">
          {projects.map((p) => (
            <option key={p.id} value={`p:${p.id}`}>
              {p.clientName ? `${p.name} — ${p.clientName}` : p.name}
            </option>
          ))}
        </optgroup>
      )}

      {clients.length > 0 && (
        <optgroup label="Clients — no project yet">
          {clients.map((c) => (
            <option key={c.id} value={`c:${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
