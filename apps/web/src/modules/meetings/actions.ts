import { api } from '../../lib/api.js';

/**
 * Everything you can do to a note, in one place.
 *
 * Thin on purpose — these are one-line calls. They are collected here because the note page
 * and the room both offer the same decisions, and two components each spelling out
 * `POST /meetings/:id/actions/:itemId/accept` is how they end up disagreeing about what
 * accepting means. The server already learned that lesson: the bot and the microphone
 * assembled the note body separately and drifted until one function replaced both.
 *
 * Nothing here decides anything. Accepting an action point is a decision the operator makes;
 * these are the verbs, not the policy.
 */
export const noteActions = {
  /** Record a new action point. Proposed, never a task — that stays a separate decision. */
  add: (noteId: string, text: string) => api.post(`/meetings/${noteId}/actions`, { text }),

  /** Owner and due date, settable only while it is still a proposal. */
  update: (
    noteId: string,
    itemId: string,
    patch: { assigneeId?: string | null; dueOn?: string | null },
  ) => api.patch(`/meetings/${noteId}/actions/${itemId}`, patch),

  /** Becomes a real task on the board. Refused by the server unless the note has a project. */
  accept: (noteId: string, itemId: string) =>
    api.post(`/meetings/${noteId}/actions/${itemId}/accept`, {}),

  dismiss: (noteId: string, itemId: string) =>
    api.post(`/meetings/${noteId}/actions/${itemId}/dismiss`, {}),

  setCovered: (noteId: string, itemId: string, covered: boolean) =>
    api.post(`/meetings/${noteId}/agenda/${itemId}/covered`, { covered }),

  addAgendaItem: (noteId: string, title: string) =>
    api.post(`/meetings/${noteId}/agenda`, { title }),

  /** Linking a project is what lets an action point become a task at all. */
  setProject: (noteId: string, projectId: string | null) =>
    api.patch(`/meetings/${noteId}`, { projectId }),

  finalise: (noteId: string) => api.post(`/meetings/${noteId}/finalise`, {}),

  addAttendee: (noteId: string, name: string) =>
    api.post(`/meetings/${noteId}/attendees`, { name }),

  setConsent: (noteId: string, attendeeId: string, consent: 'granted' | 'declined') =>
    api.post(`/meetings/${noteId}/attendees/${attendeeId}/consent`, { consent }),
};
