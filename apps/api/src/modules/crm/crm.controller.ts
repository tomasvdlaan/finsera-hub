import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import {
  CrmService,
  type CreateClientInput,
  type CreateContactInput,
  type CreateProjectInput,
} from './crm.service.js';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // ── clients ──
  @Get('clients')
  listClients(
    @CurrentActor() actor: Actor,
    @Query('query') query?: string,
    @Query('status') status?: string,
  ) {
    return this.crm.listClients(actor, { query, status: status as never });
  }

  @Post('clients')
  createClient(@CurrentActor() actor: Actor, @Body() body: CreateClientInput) {
    return this.crm.createClient(actor, body);
  }

  @Get('clients/:id')
  getClient(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.crm.getClient(actor, id);
  }

  @Get('clients/:id/overview')
  overview(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.crm.getClientOverview(actor, id);
  }

  @Patch('clients/:id')
  updateClient(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateClientInput>,
  ) {
    return this.crm.updateClient(actor, id, body);
  }

  @Delete('clients/:id')
  async archiveClient(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.crm.archiveClient(actor, id);
    return { archived: true };
  }

  // ── contacts ──
  @Get('clients/:id/contacts')
  listContacts(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.crm.listContacts(actor, id);
  }

  @Post('contacts')
  createContact(@CurrentActor() actor: Actor, @Body() body: CreateContactInput) {
    return this.crm.createContact(actor, body);
  }

  @Delete('contacts/:id')
  async archiveContact(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.crm.archiveContact(actor, id);
    return { archived: true };
  }

  // ── projects ──
  @Get('projects')
  listProjects(
    @CurrentActor() actor: Actor,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    /** Opt-in, so callers that only want the projects keep paying for only the projects. */
    @Query('withMembers') withMembers?: string,
  ) {
    return this.crm.listProjects(actor, { clientId, status, withMembers: withMembers === 'true' });
  }

  @Post('projects')
  createProject(@CurrentActor() actor: Actor, @Body() body: CreateProjectInput) {
    return this.crm.createProject(actor, body);
  }

  @Get('projects/:id')
  getProject(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.crm.getProject(actor, id);
  }

  /* ── Who is on a project ── Reading is open to anyone who can see the project; changing it
   * takes `crm.projects.assign`, which is admin-only. See crm.manifest.ts. */

  @Get('projects/:id/members')
  listMembers(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.crm.listMembers(actor, id);
  }

  @Put('projects/:id/members')
  addMember(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { userId: string; role?: 'lead' | 'contributor' },
  ) {
    return this.crm.addMember(actor, id, body);
  }

  @Delete('projects/:id/members/:userId')
  removeMember(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.crm.removeMember(actor, id, userId);
  }

  /** Every project one person is on — the other direction of the same table. */
  @Get('people/:userId/projects')
  projectsFor(@CurrentActor() actor: Actor, @Param('userId') userId: string) {
    return this.crm.projectsFor(actor, userId);
  }

  @Patch('projects/:id')
  updateProject(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateProjectInput>,
  ) {
    return this.crm.updateProject(actor, id, body);
  }
}
