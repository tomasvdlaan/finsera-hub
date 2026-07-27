import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import type { Request } from 'express';

/** Injects the authenticated Actor. Every service call that touches data takes one. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.actor!;
});
