import { EntityPicker, type PickerClient, type PickerProject } from '../../shell/ui/EntityPicker.js';

export interface Target {
  projectId?: string | null;
  clientId?: string | null;
}

export type { PickerProject, PickerClient } from '../../shell/ui/EntityPicker.js';

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
 * for itself. The first row is therefore "Internal — no client", deliberately not "None":
 * building this platform is not the absence of work, it is work with nobody to bill.
 *
 * The list itself is the shared `EntityPicker`; this only fixes the question it asks.
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
    <EntityPicker
      id={id}
      label={label}
      value={value}
      projects={projects}
      clients={clients}
      onChange={onChange}
    />
  );
}
