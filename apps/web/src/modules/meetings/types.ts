export interface AgendaItem {
  id: string;
  position: number;
  title: string;
  covered: boolean;
  coveredAt: string | null;
  notes: string | null;
}

export interface Attendee {
  id: string;
  name: string;
  email: string | null;
  contactId: string | null;
  consent: 'granted' | 'declined' | null;
  consentAt: string | null;
}

export interface ActionItem {
  id: string;
  text: string;
  assigneeId: string | null;
  dueOn: string | null;
  status: 'proposed' | 'accepted' | 'dismissed';
  taskId: string | null;
  /** Always visible where a suggestion came from. */
  source: 'typed' | 'ai';
}

export interface Note {
  id: string;
  title: string;
  clientId: string | null;
  projectId: string | null;
  meetingDate: string;
  body: string;
  template: string | null;
  status: 'draft' | 'final';
  transcribedAt: string | null;
  transcriptCostCents: number | null;
  finalisedAt: string | null;
}

export interface NoteDetail extends Note {
  agenda: AgendaItem[];
  attendees: Attendee[];
  actionItems: ActionItem[];
  /** True only when every attendee has granted; 6c will not record otherwise. */
  everyoneConsented: boolean;
}

export interface Template {
  name: string;
  label: string;
  description: string;
  agenda: string[];
}
