import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

export const whiteboardManifest = defineManifest({
  name: 'whiteboard',
  version: '0.1.0',

  entities: [
    {
      type: 'whiteboard',
      displayTemplate: '{title}',
      urlPattern: '/whiteboards/:id',
      readPermission: 'whiteboard.read',
    },
  ],

  /*
   * A board hangs off a meeting, optionally.
   *
   * Optional because the other half of why this exists is sketching something that was not a
   * meeting. Client and project anchoring are deliberately out of v1 — a board reaches them
   * through the meeting it was drawn in, which is where they were being drawn anyway.
   */
  structuralRefs: [{ from: 'whiteboard', toType: 'meeting_note', required: false }],

  publishes: [
    { name: 'whiteboard.created', description: 'A whiteboard was started.' },
    { name: 'whiteboard.archived', description: 'A whiteboard was archived.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'whiteboard.read', description: 'Open and export whiteboards.' },
    { capability: 'whiteboard.write', description: 'Create whiteboards and draw on them.' },
    { capability: 'whiteboard.delete', description: 'Archive whiteboards.' },
  ],

  /*
   * Work, after Meetings and the SCRUM board.
   *
   * A whiteboard is a working surface, not a filed record, so it does not belong in Record
   * next to Documents. Labelled "Whiteboards" rather than "Boards" because SCRUM already has
   * a "Board" in this same section, and two of them would be a coin flip every time.
   */
  navigation: [
    { label: 'Whiteboards', path: '/whiteboards', icon: 'pencil', section: 'work', order: 4 },
  ],

  widgets: [
    { slot: 'dashboard', component: 'whiteboard:recent' },
    /*
     * The meeting room's whiteboard tab.
     *
     * Declared as a slot rather than imported by the meetings module, so the room can offer a
     * whiteboard without meetings knowing this module exists — and so the editor stays in its
     * own lazily-loaded chunk instead of joining the room's.
     */
    { slot: 'meeting-room', component: 'whiteboard:meeting-board' },
  ],

  chatWidgets: [{ entityType: 'whiteboard', component: 'whiteboard:board-card' }],

  meetingBehaviours: [],

  reportingViews: [
    {
      view: 'whiteboard.v_boards',
      description: 'Boards with their element counts and when they were last drawn on.',
    },
  ],

  portalExposure: [],

  /*
   * Read only, and that is a decision rather than an omission.
   *
   * There are no write tools because an assistant placing elements on a live shared canvas has
   * to choose coordinates, and a shape landing on top of somebody's diagram mid-meeting is not
   * a draft you can decline — it is vandalism you have to undo. The same argument Documents
   * makes about filing, only stronger.
   *
   * Zero tools would be wrong the other way: a board drawn in a meeting is exactly the kind of
   * thing "what did we decide about the migration?" should be able to reach, and its text is
   * plain strings sitting in rows.
   */
  aiTools: [
    {
      name: 'whiteboard_list',
      description:
        'List whiteboards, most recently drawn on first, optionally only those from one ' +
        'meeting. Use to answer "which board did we sketch the architecture on?".',
      inputSchema: z.object({
        meetingId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'whiteboard.read',
      riskClass: 'read',
      handler: 'listTool',
    },
    {
      name: 'whiteboard_read',
      description:
        'Read the text on a whiteboard: every text and sticky-note label in reading order, ' +
        'top to bottom and left to right, with the labels of any arrows joining them. Shapes ' +
        'and drawings are NOT returned — this reads what was written, not what was drawn.',
      inputSchema: z.object({ boardId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'whiteboard.read',
      riskClass: 'read',
      handler: 'readTool',
    },
  ],
});
