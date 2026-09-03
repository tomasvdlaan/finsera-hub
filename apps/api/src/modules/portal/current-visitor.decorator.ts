import {
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isStaff, type PortalViewer, type PortalVisitor } from './portal.projection.js';

/**
 * The two factories, named and exported so the wiring can be asserted.
 *
 * A route's choice between them *is* the staff rule (P5), and nothing about reading the
 * file makes that visible — both decorators look alike at a call site, and picking the
 * wrong one on a new write route would work perfectly until an employee used it. So the
 * functions are exported, `portal.controller.spec.ts` reads which one each route asked
 * for, and the rule is checked rather than remembered.
 */
export function resolveViewer(_data: unknown, ctx: ExecutionContext): PortalViewer {
  const { viewer } = ctx.switchToHttp().getRequest<Request>();
  // Throws rather than returning undefined when it is missing. A route reachable without
  // the guard is a bug, and the difference between "throws" and "returns undefined" is the
  // difference between a 401 and a query built from `undefined.clientId` — which, depending
  // on how the query is written, may be an empty result or may be everything.
  if (!viewer) throw new UnauthorizedException('No portal session');
  return viewer;
}

export function resolveVisitor(_data: unknown, ctx: ExecutionContext): PortalVisitor {
  const viewer = resolveViewer(_data, ctx);
  if (isStaff(viewer)) throw new ForbiddenException('Dit kan alleen de klant zelf doen');
  return viewer;
}

/** Whoever the guard resolved — a client, or one of us looking at their portal. */
export const CurrentViewer = createParamDecorator(resolveViewer);

/**
 * The client, and only the client.
 *
 * The difference between this and `CurrentViewer` is where the staff rule lives: an
 * employee may read a client's portal and may not act as them, and rather than each write
 * route remembering to check, the routes that write ask for a type a staff session cannot
 * produce. Accepting a quote is a statement by the client about a price; a request is
 * their words. Neither is something we get to make on their behalf by opening their portal.
 */
export const CurrentVisitor = createParamDecorator(resolveVisitor);
