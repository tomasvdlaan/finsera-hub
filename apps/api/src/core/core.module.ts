import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CommentService } from './comments/comment.service.js';
import { MentionService } from './comments/mention.service.js';
import { DbModule } from './db/db.module.js';
import { EventBus } from './events/event-bus.service.js';
import { EventDispatcher } from './events/event-dispatcher.service.js';
import { EventHandlerRegistry } from './events/event-handler.registry.js';
import { FileTypeRegistry } from './files/file-type.registry.js';
import { LinkService } from './links/link.service.js';
import { EmbeddingService } from './llm/embedding.service.js';
import { LlmService } from './llm/llm.service.js';
import { OrchestratorService } from './llm/orchestrator.service.js';
import { AiToolRegistry } from './llm/tool-registry.service.js';
import { ManifestRegistry } from './manifest/manifest.registry.js';
import { PermissionService } from './permissions/permission.service.js';
import { RegistryService } from './registry/registry.service.js';
import { DbIntegrityService } from './db/integrity.service.js';
import { SettingsService } from './settings/settings.service.js';
import { TtsService } from './llm/tts.service.js';
import { UsageService } from './usage/usage.service.js';
import { ModelConfigService } from './usage/model-config.service.js';
import { OpenRouterService } from './usage/openrouter.service.js';
import { StorageService } from './storage/storage.service.js';

/**
 * Layer 1 — the platform core. Owns identity and relationships; has no business logic.
 *
 * Complete as of Phase 0: identity, links, events, permissions, audit, and the AI
 * provider seam. The orchestrator that drives these tools arrives in Phase 2.
 */
const services = [
  CommentService,
  MentionService,
  ManifestRegistry,
  RegistryService,
  AuditService,
  PermissionService,
  LinkService,
  EventBus,
  EventHandlerRegistry,
  EventDispatcher,
  LlmService,
  EmbeddingService,
  AiToolRegistry,
  OrchestratorService,
  StorageService,
  FileTypeRegistry,
  SettingsService,
  DbIntegrityService,
  TtsService,
  UsageService,
  ModelConfigService,
  OpenRouterService,
];

@Global()
@Module({
  imports: [DbModule, AuthModule],
  providers: services,
  exports: [DbModule, AuthModule, ...services],
})
export class CoreModule {}
