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

  // First in Work. The platform's stated core is keeping track of SCRUM, and the
  // ceremonies are where that starts; it used to sit below the board.
  navigation: [{ label: 'Meetings', path: '/meetings', icon: 'users', section: 'work', order: 1 }],
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
    {
      name: 'context_finder',
      description:
        'Looks up documents that bear on what was just proposed, without being asked — the ' +
        'assistant can already be asked to search, but nobody thinks to ask mid-meeting.',
      trigger: 'interval',
      speaks: false,
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
      name: 'meetings_write_note',
      description:
        'Write Markdown into a meeting note. Appends to the end by default. Pass `section` to ' +
        'replace everything under that heading instead — use it only for a section you are ' +
        'maintaining, never to rewrite something the user wrote. Prefer appending: a note has ' +
        'no version history, so replacing text destroys it permanently. Use meetings_note_outline ' +
        'first if you need to know which headings exist.',
      inputSchema: z.object({
        noteId: z.string().uuid(),
        markdown: z.string().describe(
          [
            'Markdown, and only the following. Anything else is not rendered:',
            '`##`/`###` headings, `-` bullets, `1.` numbered lists, `- [ ]` task items,',
            '`>` quotes, ``` fenced code, tables, images, links,',
            '**bold**, *italic*, ~~strikethrough~~, `code` and ==highlight==.',
            '',
            'There is no colour and no underline: the note is stored as Markdown, which cannot',
            'express either, so asking for them is not a limitation of the editor. Use',
            '==highlight== to draw the eye and **bold** for emphasis.',
            '',
            'Raw HTML is refused rather than rendered — a <span> would be stored as visible',
            'angle brackets in the middle of the sentence.',
          ].join('\n'),
        ),
        section: z
          .string()
          .optional()
          .describe('A heading to replace the contents of, e.g. "Decisions". Omit to append.'),
      }),
      outputSchema: z.object({}),
      permission: 'meetings.write',
      riskClass: 'write:draft',
      handler: 'writeIntoNoteTool',
    },
    {
      name: 'meetings_note_outline',
      description:
        "A note's title, its headings and its current text — what to read before writing into it.",
      inputSchema: z.object({ noteId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'meetings.read',
      riskClass: 'read',
      handler: 'noteOutline',
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
