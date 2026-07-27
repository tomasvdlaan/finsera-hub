import { Injectable, Logger } from '@nestjs/common';
import type { Actor, RiskClass } from '@platform/contracts';
import type { ToolSet } from 'ai';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';

export type ToolExecutor = (actor: Actor, input: unknown) => Promise<unknown>;

export interface ToolInvocation {
  toolName: string;
  module: string;
  riskClass: RiskClass;
  input: unknown;
  result?: unknown;
  /** True when the tool ran; false when it was withheld pending confirmation. */
  executed: boolean;
  /** Set when execution was refused or deferred. */
  reason?: string;
}

/**
 * Turns manifest `aiTools` declarations into an AI SDK tool set (AI plan §3.1).
 *
 * Two rules are enforced HERE, in code, rather than left to the model's judgement:
 *
 *  1. THE ASSISTANT IS THE USER — the tool set is assembled per conversation from the
 *     modules the *user* may access, and every execution runs under that same Actor.
 *     There is no privileged AI service account.
 *  2. RISK CLASS GOVERNS EXECUTION — `read` runs silently, `write:draft` runs and
 *     surfaces a draft, `write:commit` requires prior confirmation, `restricted` never
 *     executes. A model instructed by a malicious document still cannot escalate,
 *     because the ceiling is set by the declaration, not the conversation.
 */
@Injectable()
export class AiToolRegistry {
  private readonly logger = new Logger(AiToolRegistry.name);
  private readonly executors = new Map<string, ToolExecutor>();

  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly permissions: PermissionService,
  ) {}

  /** Modules bind their declared tools to real functions at bootstrap. */
  bind(toolName: string, executor: ToolExecutor): void {
    if (this.executors.has(toolName)) {
      throw new Error(`AI tool '${toolName}' is already bound.`);
    }
    this.executors.set(toolName, executor);
  }

  /**
   * Build the tool set for one conversation.
   *
   * @param confirmed names of `write:commit` tools the user has already approved
   */
  async buildToolSet(
    actor: Actor,
    options: { confirmed?: Set<string> } = {},
  ): Promise<{ tools: ToolSet; invocations: ToolInvocation[] }> {
    const invocations: ToolInvocation[] = [];
    const tools: ToolSet = {};

    for (const declared of this.manifests.aiTools()) {
      // Filter by the USER's permissions — never widened.
      if (!(await this.permissions.can(actor, declared.permission))) continue;

      // Restricted tools are not offered at all: the model cannot call what it
      // cannot see, which is stronger than refusing after the fact.
      if (declared.riskClass === 'restricted') continue;

      const executor = this.executors.get(declared.name);
      if (!executor) {
        this.logger.warn(`AI tool '${declared.name}' declared but not bound — skipping.`);
        continue;
      }

      // Built as a plain object rather than via the SDK's tool() helper: that helper
      // exists only to infer types from a concrete schema, and inferring from the
      // manifest's generic ZodTypeAny recurses without bound (TS2589). Runtime shape
      // is identical.
      const definition = {
        description: declared.description,
        inputSchema: declared.inputSchema,
        execute: async (input: unknown) => {
          const invocation: ToolInvocation = {
            toolName: declared.name,
            module: declared.module,
            riskClass: declared.riskClass,
            input,
            executed: false,
          };

          if (declared.riskClass === 'write:commit' && !options.confirmed?.has(declared.name)) {
            invocation.reason = 'awaiting confirmation';
            invocations.push(invocation);
            return {
              status: 'awaiting_confirmation',
              message: `'${declared.name}' needs explicit user confirmation before it runs.`,
            };
          }

          const result = await executor(actor, input);
          invocation.executed = true;
          invocation.result = result;
          invocations.push(invocation);
          return result;
        },
      };

      tools[declared.name] = definition as unknown as ToolSet[string];
    }

    return { tools, invocations };
  }

  /** What the assistant could do for this actor — used by the debug endpoint. */
  async availableFor(actor: Actor) {
    const available = [];
    for (const t of this.manifests.aiTools()) {
      if (t.riskClass === 'restricted') continue;
      if (!(await this.permissions.can(actor, t.permission))) continue;
      available.push({ name: t.name, module: t.module, riskClass: t.riskClass });
    }
    return available;
  }
}
