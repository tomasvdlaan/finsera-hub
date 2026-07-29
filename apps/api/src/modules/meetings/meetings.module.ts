import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
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

/**
 * Meeting Notes. Depends on CRM (the client a meeting is with) and SCRUM (where an
 * accepted action point becomes a task) — both through their services, both one-way.
 */
@Module({
  imports: [CrmModule, ScrumModule],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
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
  ],
  exports: [MeetingsService],
})
export class MeetingsModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly meetings: MeetingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(meetingsManifest);
    await this.meetings.ensureReportingViews();

    this.aiTools.bind('meetings_search', (actor: Actor, input) => {
      const i = input as { query: string; limit?: number };
      return this.meetings.search(actor, i.query, i.limit ?? 10);
    });
    this.aiTools.bind('meetings_list_notes', (actor: Actor, input) =>
      this.meetings.list(actor, input as { clientId?: string; projectId?: string }),
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
