import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { ScrumService, type CreateTaskInput } from './scrum.service.js';
import type { BoardColumn } from './scrum.schema.js';

@Controller('scrum')
export class ScrumController {
  constructor(private readonly scrum: ScrumService) {}

  @Get('boards/:projectId')
  board(@CurrentActor() actor: Actor, @Param('projectId') projectId: string) {
    return this.scrum.getBoard(actor, projectId);
  }

  @Patch('boards/:projectId')
  updateBoard(
    @CurrentActor() actor: Actor,
    @Param('projectId') projectId: string,
    @Body() body: { columns?: BoardColumn[]; usesSprints?: boolean },
  ) {
    return this.scrum.updateBoard(actor, projectId, body);
  }

  @Get('tasks')
  list(
    @CurrentActor() actor: Actor,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    return this.scrum.listTasks(actor, { projectId, status, assigneeId });
  }

  @Post('tasks')
  create(@CurrentActor() actor: Actor, @Body() body: CreateTaskInput) {
    return this.scrum.createTask(actor, body);
  }

  @Get('tasks/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.scrum.getTask(actor, id);
  }

  @Patch('tasks/:id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateTaskInput>,
  ) {
    return this.scrum.updateTask(actor, id, body);
  }

  /** Drag-and-drop lands here: new column plus the neighbours it was dropped between. */
  @Post('tasks/:id/move')
  move(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { status: string; beforeTaskId?: string | null; afterTaskId?: string | null },
  ) {
    return this.scrum.moveTask(actor, id, body);
  }

  /** Start a timer on this task (Master §3.5). */
  @Post('tasks/:id/start-timer')
  startTimer(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.scrum.startTimer(actor, id);
  }

  @Delete('tasks/:id')
  async archive(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.scrum.archiveTask(actor, id);
    return { archived: true };
  }
}
