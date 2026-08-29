import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { CrmModule } from '../crm/crm.module.js';
import { TimeModule } from '../time/time.module.js';
import { ScrumController } from './scrum.controller.js';
import { scrumManifest } from './scrum.manifest.js';
import {
  ScrumService,
  type CreateTaskInput,
  type UpdateTaskToolInput,
} from './scrum.service.js';

/**
 * Task and progress tracking.
 *
 * Depends on CRM (tasks belong to projects) and Time (start a timer from a task). Time
 * does NOT depend on this module — a time entry references a task by registry id, which
 * is what keeps the graph acyclic and both modules replaceable (Master §10).
 */
@Module({
  imports: [CrmModule, TimeModule],
  controllers: [ScrumController],
  providers: [ScrumService],
  exports: [ScrumService],
})
export class ScrumModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly scrum: ScrumService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(scrumManifest);
    await this.scrum.ensureReportingViews();

    this.aiTools.bind('scrum_list_tasks', (actor: Actor, input) =>
      this.scrum.listTasksTool(actor, input as { projectId?: string; status?: string }),
    );
    this.aiTools.bind('scrum_task_detail', (actor: Actor, input) =>
      this.scrum.getTask(actor, (input as { taskId: string }).taskId),
    );
    this.aiTools.bind('scrum_create_task', (actor: Actor, input) =>
      this.scrum.createTaskTool(actor, input as CreateTaskInput),
    );
    this.aiTools.bind('scrum_update_task', (actor: Actor, input) =>
      this.scrum.updateTaskTool(actor, input as UpdateTaskToolInput),
    );
    this.aiTools.bind('scrum_move_task', (actor: Actor, input) =>
      this.scrum.moveTaskTool(actor, input as { taskId: string; status: string }),
    );
    this.aiTools.bind('scrum_sprint_status', (actor: Actor, input) =>
      this.scrum.sprintStatusTool(actor, input as { projectId: string }),
    );
    this.aiTools.bind('scrum_flow_metrics', (actor: Actor, input) =>
      this.scrum.flowTool(actor, input as { projectId: string }),
    );
  }
}
