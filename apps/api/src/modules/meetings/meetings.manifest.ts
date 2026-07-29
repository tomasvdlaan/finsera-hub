import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

export const meetingsManifest = defineManifest({
  name: 'meetings',
  version: '0.1.0',

  entities: [
    { type: 'meeting_note', displayTemplate: '{title}', urlPattern: '/meetings/:id' },
  ],

  structuralRefs: [
    { from: 'meeting_note', toType: 'client', required: false },
    { from: 'meeting_note', toType: 'project', required: false },
  ],

  publishes: [
    { name: 'meeting_note.created', description: 'A meeting note was started.' },
    { name: 'meeting_note.finalised', description: 'A meeting note was marked done.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'meetings.read', description: 'Read meeting notes.' },
    { capability: 'meetings.write', description: 'Write notes, agendas and action points.' },
  ],

  navigation: [{ label: 'Meetings', path: '/meetings', icon: 'users', section: 'work', order: 2 }],
  widgets: [{ slot: 'entity-page', component: 'meetings:client-notes' }],
  chatWidgets: [{ entityType: 'meeting_note', component: 'meetings:note-card' }],

  /**
   * What the live agent does during a meeting.
   *
   * Declared here for the same reason tools are: the platform page is generated from the
   * manifests, so a behaviour that exists is visible without anyone maintaining a second
   * list. Adding one means writing the class and adding a line here.
   */
  meetingBehaviours: [
    {
      name: 'wake_word',
      description:
        'Answers when addressed by name, using the same tools the chat assistant has — quotes, invoices, contracts, hours, past notes.',
      trigger: 'utterance',
      speaks: true,
    },
    {
      name: 'note_taker',
      description:
        'Writes structured notes into the document as the meeting happens, revising them rather than appending.',
      trigger: 'interval',
      speaks: false,
    },
    {
      name: 'agenda_drift',
      description:
        'Watches whether the meeting is still on its agenda and proposes which items have been covered.',
      trigger: 'interval',
      speaks: true,
    },
  ],

  reportingViews: [
    {
      view: 'meetings.v_notes',
      description: 'Meeting notes with action counts and transcription cost.',
    },
  ],

  portalExposure: [],

  aiTools: [
    {
      name: 'meetings_search',
      description:
        'Search meeting notes by keyword and meaning. Use this to answer questions about what was discussed or decided with a client.',
      inputSchema: z.object({ query: z.string(), limit: z.number().int().optional() }),
      outputSchema: z.object({}),
      permission: 'meetings.read',
      riskClass: 'read',
      handler: 'search',
    },
    {
      name: 'meetings_list_notes',
      description: 'List meeting notes, optionally for one client or project.',
      inputSchema: z.object({
        clientId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'meetings.read',
      riskClass: 'read',
      handler: 'list',
    },
    {
      name: 'meetings_propose_action_items',
      description:
        'Propose action points from a meeting note. They are recorded as PROPOSED and become tasks only when the user accepts them. Only propose things actually stated in the note — never invent an owner or a deadline that was not mentioned.',
      inputSchema: z.object({
        noteId: z.string().uuid(),
        items: z
          .array(
            z.object({
              text: z.string(),
              dueOn: z.string().optional().describe('ISO date, only if one was stated'),
            }),
          )
          .min(1),
      }),
      outputSchema: z.object({}),
      permission: 'meetings.write',
      riskClass: 'write:draft',
      handler: 'proposeActionItems',
    },
  ],
});
