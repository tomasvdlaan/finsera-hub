import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { AuthModule } from '../../core/auth/auth.module.js';
import { DocsModule } from '../docs/docs.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { ScrumModule } from '../scrum/scrum.module.js';
import { MeetingsController } from './meetings.controller.js';
import { meetingsManifest } from './meetings.manifest.js';
import { MeetingsService } from './meetings.service.js';
import { LiveGateway } from './live/live.gateway.js';
import { RecallGateway } from './live/recall.gateway.js';
import { LiveService } from './live/live.service.js';
import { LiveRunner } from './live/live-runner.service.js';
import { LiveRegistry } from './live/live-registry.service.js';
import { RecallProvider } from './live/capture/recall.provider.js';
import { ConversationService } from './live/conversation.service.js';
import { BehaviourRegistry } from './live/behaviours/behaviour.registry.js';
import { WakeWordBehaviour } from './live/behaviours/wake-word.behaviour.js';
import { AgendaDriftBehaviour } from './live/behaviours/agenda-drift.behaviour.js';
import { ContextFinderBehaviour } from './live/behaviours/context-finder.behaviour.js';
import { NoteTakerBehaviour } from './live/behaviours/note-taker.behaviour.js';
import { NoteDocService } from './doc/note-doc.service.js';
import { DocGateway } from './doc/doc.gateway.js';

/**
 * Meeting Notes. Depends on CRM (the client a meeting is with) and SCRUM (where an
 * accepted action point becomes a task) — both through their services, both one-way.
 */
@Module({
  imports: [AuthModule, CrmModule, DocsModule, ScrumModule],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
    NoteDocService,
    DocGateway,
    LiveService,
    LiveGateway,
    RecallGateway,
    LiveRunner,
    LiveRegistry,
    RecallProvider,
    ConversationService,
    BehaviourRegistry,
    WakeWordBehaviour,
    AgendaDriftBehaviour,
    NoteTakerBehaviour,
    ContextFinderBehaviour,
  ],
  exports: [MeetingsService, NoteDocService],
})
export class MeetingsModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly meetings: MeetingsService,
    private readonly noteDocs: NoteDocService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(meetingsManifest);
    await this.meetings.ensureReportingViews();

    /*
     * Where the document authority reads and writes bodies.
     *
     * Bound here rather than injected, because MeetingsService is what persists a note and
     * NoteDocService is what MeetingsService now writes through — asking Nest to resolve that
     * circle with forwardRef would work and would make both harder to test. The AI tools below
     * are wired the same way, for the same reason.
     */
    this.noteDocs.bind({
      load: (noteId: string) => this.meetings.bodyOf(noteId),
      save: async (noteId: string, markdown: string, actor: Actor) => {
        // fromDocument: this text *is* the open document, so it must not be pushed back
        // into it as a replacement — see MeetingsService.update.
        await this.meetings.update(actor, noteId, { body: markdown }, { fromDocument: true });
      },
    });

    this.aiTools.bind('meetings_search', (actor: Actor, input) => {
      const i = input as { query: string; limit?: number };
      return this.meetings.search(actor, i.query, i.limit ?? 10);
    });
    this.aiTools.bind('meetings_list_notes', (actor: Actor, input) =>
      this.meetings.list(actor, input as { clientId?: string; projectId?: string }),
    );
    this.aiTools.bind('meetings_note_outline', (actor: Actor, input) =>
      this.meetings.noteOutline(actor, (input as { noteId: string }).noteId),
    );
    this.aiTools.bind('meetings_write_note', (actor: Actor, input) =>
      this.meetings.writeIntoNote(
        actor,
        input as { noteId: string; markdown: string; section?: string | null },
        // Every note the assistant writes is stamped as its own, so a body that reads as
        // yours can always be traced back to whoever actually wrote it.
        { aiInitiated: true },
      ),
    );
    this.aiTools.bind('meetings_propose_action_items', async (actor: Actor, input) => {
      const i = input as { noteId: string; items: Array<{ text: string; dueOn?: string }> };
      let note;
      for (const item of i.items) {
        note = await this.meetings.addActionItem(actor, i.noteId, {
          text: item.text,
          dueOn: item.dueOn,
          source: 'ai', // always visible where a suggestion came from
        });
      }
      return note;
    });
  }
}
