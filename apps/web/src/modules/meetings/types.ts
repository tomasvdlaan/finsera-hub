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
  /** Set when the meeting bot actually saw this person in the call. */
  detectedAt: string | null;
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
  /** The earlier commitment this one repeats, when it was carried forward. */
  carriedFrom: string | null;
}

/**
 * Something an earlier meeting about this work agreed to and has not finished.
 *
 * Two kinds, told apart because they need different things. `undecided` was never accepted or
 * dismissed and needs a decision — it can be carried onto this meeting and settled here.
 * `undone` is already a card on the board and needs nothing from this note but to be said out
 * loud; carrying it would put the same work on the board twice.
 */
export interface Commitment {
  id: string;
  text: string;
  assigneeId: string | null;
  dueOn: string | null;
  noteId: string;
  noteTitle: string;
  meetingDate: string;
  state: 'undecided' | 'undone';
  taskId: string | null;
}

export interface Note {
  id: string;
  title: string;
  clientId: string | null;
  projectId: string | null;
  /** The sprint this ceremony was about, when it was about one. */
  sprintId: string | null;
  meetingDate: string;
  /**
   * When the room was actually open.
   *
   * Both null for a note written up afterwards rather than held in a room, which is a real
   * and ordinary case — so anything reading a length from these has to survive their absence
   * rather than render a confident zero.
   */
  startedAt: string | null;
  endedAt: string | null;
  body: string;
  template: string | null;
  status: 'draft' | 'final';
  transcribedAt: string | null;
  transcriptCostCents: number | null;
  finalisedAt: string | null;
}

/** A note as the hub lists it — the record, plus what it produced and who was there. */
export interface NoteRow extends Note {
  actionsOpen: number;
  actionsTotal: number;
  attendeeNames: string[];
}

export interface NoteDetail extends Note {
  agenda: AgendaItem[];
  attendees: Attendee[];
  actionItems: ActionItem[];
  /**
   * Still owed from earlier meetings about this work, computed by the server.
   *
   * Was assembled in the browser from `/meetings/open-actions`, which could only ever see the
   * undecided half — so a commitment accepted onto the board and then left there never came back
   * up in the conversation that would have noticed.
   */
  openBefore: Commitment[];
  /** True only when every attendee has granted; 6c will not record otherwise. */
  everyoneConsented: boolean;
  /** People the bot saw in the call who were never asked. */
  unconsentedPresent: Attendee[];
}

export interface Template {
  name: string;
  label: string;
  description: string;
  agenda: string[];
  /** How long the ceremony is meant to take. The room counts elapsed against it. */
  timeboxMinutes: number;
}
