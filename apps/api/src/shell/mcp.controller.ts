import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import type { Response } from 'express';
import { CurrentActor } from '../core/auth/current-actor.decorator.js';
import {
  MCP_PROTOCOL_VERSION,
  McpService,
  McpUnknownToolError,
} from '../core/llm/mcp.service.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * The platform's tools as an MCP server (streamable HTTP, stateless, JSON responses).
 *
 * Authenticated like everything else: the global guard resolves the bearer token to an Actor,
 * and `McpService` offers that Actor what the hub assistant would offer it. This controller
 * is protocol plumbing and owns no tools — see `McpService` for why that matters.
 *
 * Stateless on purpose: no session id, no server-initiated messages, so there is nothing to
 * keep between requests and any instance can answer any call.
 */
@Controller('mcp')
export class McpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @CurrentActor() actor: Actor,
    @Body() body: JsonRpcRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return rpcError(body?.id ?? null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request.');
    }

    // A message without an id is a notification: acknowledged, never answered.
    if (body.id === undefined) {
      res.status(202);
      return;
    }

    switch (body.method) {
      case 'initialize':
        return rpcResult(body.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'finsera-platform', version: '1.0.0' },
        });
      case 'ping':
        return rpcResult(body.id, {});
      case 'tools/list':
        return rpcResult(body.id, { tools: await this.mcp.listTools(actor) });
      case 'tools/call': {
        const name = body.params?.name;
        if (typeof name !== 'string') {
          return rpcError(body.id, INVALID_PARAMS, 'tools/call needs a tool name.');
        }
        try {
          return rpcResult(body.id, await this.mcp.callTool(actor, name, body.params?.arguments));
        } catch (err) {
          if (err instanceof McpUnknownToolError) {
            return rpcError(body.id, INVALID_PARAMS, err.message);
          }
          throw err;
        }
      }
      default:
        return rpcError(body.id, METHOD_NOT_FOUND, `Method not found: ${body.method}`);
    }
  }

  /** No server-to-client stream: the spec lets a server say so with 405. */
  @Get()
  notOffered(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').end();
  }
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}
