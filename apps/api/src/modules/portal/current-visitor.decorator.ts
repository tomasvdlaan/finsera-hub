import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { PortalVisitor } from './portal.projection.js';

/**
 * The visitor `PortalAuthGuard` resolved for this request.
 *
 * Throws rather than returning undefined when it is missing. A route reachable without
 * the guard is a bug, and the difference between "throws" and "returns undefined" is the
 * difference between a 401 and a query built from `undefined.clientId` — which, depending
 * on how the query is written, may be an empty result or may be everything.
 */
export const CurrentVisitor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalVisitor => {
    const { visitor } = ctx.switchToHttp().getRequest<Request>();
    if (!visitor) throw new UnauthorizedException('No portal session');
    return visitor;
  },
);
