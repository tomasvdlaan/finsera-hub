import { Injectable } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { asSchema } from 'ai';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { AiToolRegistry } from './tool-registry.service.js';

/** MCP clients reject tool names outside this shape, so a name outside it is unreachable. */
const MCP_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
}

export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
}

/** A tool the caller may not have, or one that does not exist — deliberately the same answer. */
export class McpUnknownToolError extends Error {}

/**
 * The Model Context Protocol face of the AI tool registry.
 *
 * THERE IS NO TOOL LIST HERE. Everything this class offers is derived, per request, from
 * `AiToolRegistry.buildToolSet` — the same call the hub assistant and the live meeting agent
 * make. That is the whole parity guarantee: a tool cannot exist for the assistant and not
 * for MCP (or the reverse), because neither surface has a list of its own to fall out of
 * date. A new `aiTools` declaration is on both the moment it is bound.
 *
 * It follows that the MCP client is the actor it authenticates as — a Zitadel machine user
 * with a role — and that role, not a code-level allowlist, decides which tools it sees. An
 * allowlist here would be precisely the second list this class exists to avoid.
 *
 * Risk classes come along unchanged: `restricted` tools are never offered, and a
 * `write:commit` tool answers `awaiting_confirmation` because nobody on this surface can
 * confirm it.
 */
@Injectable()
export class McpService {
  constructor(
    private readonly tools: AiToolRegistry,
    private readonly manifests: ManifestRegistry,
  ) {}

  async listTools(actor: Actor): Promise<McpToolDescriptor[]> {
    const { tools } = await this.tools.buildToolSet(actor);
    const declared = this.declaredByName();
    const out: McpToolDescriptor[] = [];
    for (const [name, def] of Object.entries(tools)) {
      out.push({
        name,
        // From the declaration: on the SDK's tool object a description may be a function.
        description: declared.get(name)?.description ?? '',
        inputSchema: await this.jsonSchemaOf(def.inputSchema),
        annotations: { readOnlyHint: declared.get(name)?.riskClass === 'read' },
      });
    }
    return out;
  }

  async callTool(actor: Actor, name: string, args: unknown): Promise<McpCallResult> {
    const { tools } = await this.tools.buildToolSet(actor);
    const def = tools[name];
    if (!def) throw new McpUnknownToolError(`Unknown tool: ${name}`);

    // The AI SDK validates tool input before `execute` when it drives the call; here nothing
    // does, so the declared schema is applied by hand. Its parsed output — defaults filled,
    // unknown keys stripped — is what the executor receives, as it would from the model.
    const schema = def.inputSchema as { safeParse?: (v: unknown) => SafeParse };
    const parsed = schema.safeParse?.(args ?? {});
    if (parsed && !parsed.success) {
      return text(`Invalid arguments for ${name}: ${parsed.error?.message ?? 'rejected'}`, true);
    }

    try {
      const result = await (def.execute as (input: unknown) => Promise<unknown>)(
        parsed ? parsed.data : (args ?? {}),
      );
      const awaiting =
        typeof result === 'object' &&
        result !== null &&
        (result as { status?: unknown }).status === 'awaiting_confirmation';
      return text(JSON.stringify(result ?? null), awaiting);
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }

  /**
   * Throws if any declared tool could not be offered over MCP.
   *
   * Run at bootstrap, next to the "declared but never bound" check, so the two together say:
   * every non-restricted tool is bound, and every bound tool is expressible here. Without
   * it a tool with an unusable name or a schema that will not convert would simply be
   * missing from MCP — the silent half-parity this class is meant to rule out.
   */
  async assertEveryToolExposable(): Promise<void> {
    const problems: string[] = [];
    for (const t of this.manifests.aiTools()) {
      if (t.riskClass === 'restricted') continue;
      if (!MCP_TOOL_NAME.test(t.name)) {
        problems.push(`${t.name} (${t.module}): name is not a valid MCP tool name`);
        continue;
      }
      try {
        await this.jsonSchemaOf(t.inputSchema);
      } catch (err) {
        problems.push(
          `${t.name} (${t.module}): input schema has no JSON Schema form (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `AI tools that cannot be offered over MCP: ${problems.join('; ')}. ` +
          'The hub assistant and MCP share one tool list — fix the declaration.',
      );
    }
  }

  private declaredByName() {
    return new Map(this.manifests.aiTools().map((t) => [t.name, t]));
  }

  private async jsonSchemaOf(schema: unknown): Promise<Record<string, unknown>> {
    const converted = asSchema(schema as Parameters<typeof asSchema>[0]);
    return (await converted.jsonSchema) as Record<string, unknown>;
  }
}

type SafeParse =
  | { success: true; data: unknown; error?: undefined }
  | { success: false; error?: { message: string }; data?: undefined };

function text(body: string, isError: boolean): McpCallResult {
  return { content: [{ type: 'text', text: body }], isError };
}
