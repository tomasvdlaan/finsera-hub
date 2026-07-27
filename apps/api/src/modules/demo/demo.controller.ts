import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { CurrentActor } from '../../core/auth/current-actor.decorator.js';
import { DemoService } from './demo.service.js';

@Controller('demo/items')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query('limit') limit?: string) {
    return this.demo.listItems(actor, limit ? Number(limit) : 10);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() body: { title: string; note?: string }) {
    return this.demo.createItem(actor, body);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.demo.getItem(actor, id);
  }
}
