import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import {
  ContractsService,
  type CreateContractInput,
  type RateCardLineInput,
} from './contracts.service.js';

@Controller('sales')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  // ── contracts ──

  @Get('contracts')
  list(
    @CurrentActor() actor: Actor,
    @Query('clientId') clientId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.contracts.list(actor, { clientId, type, status });
  }

  @Get('contracts/:id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.contracts.get(actor, id);
  }

  @Post('contracts')
  create(@CurrentActor() actor: Actor, @Body() body: CreateContractInput) {
    return this.contracts.create(actor, body);
  }

  @Patch('contracts/:id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: Partial<CreateContractInput>,
  ) {
    return this.contracts.update(actor, id, body);
  }

  /** Freezes the commercial terms — the dates a dispute would turn on. */
  @Post('contracts/:id/sign')
  sign(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.contracts.sign(actor, id);
  }

  @Post('contracts/:id/terminate')
  terminate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.contracts.terminate(actor, id, body?.reason);
  }

  @Delete('contracts/:id')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.contracts.remove(actor, id);
  }

  // ── rate cards ──

  @Get('rate-cards')
  listRateCards(@CurrentActor() actor: Actor, @Query('clientId') clientId?: string) {
    return this.contracts.listRateCards(actor, clientId);
  }

  @Get('rate-cards/:id')
  getRateCard(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.contracts.getRateCard(actor, id);
  }

  @Post('rate-cards')
  createRateCard(
    @CurrentActor() actor: Actor,
    @Body()
    body: { clientId?: string; contractId?: string; name: string; lines?: RateCardLineInput[] },
  ) {
    return this.contracts.createRateCard(actor, body);
  }

  /** Adding a rate is how an indexation is recorded; existing lines are never rewritten. */
  @Post('rate-cards/:id/rates')
  addRate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: RateCardLineInput,
  ) {
    return this.contracts.addRate(actor, id, body);
  }

  @Delete('rate-cards/:id/rates/:lineId')
  removeRate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.contracts.removeRate(actor, id, lineId);
  }

  /** The explicit act decision D1 chose over automatic date-based lookup. */
  @Post('rate-cards/:id/apply')
  apply(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { projectId: string; role: string; on?: string },
  ) {
    return this.contracts.applyRateToProject(actor, { ...body, rateCardId: id });
  }
}
