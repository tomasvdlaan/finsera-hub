import { Module, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { AiToolRegistry } from '../../core/llm/tool-registry.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { AuthModule } from '../../core/auth/auth.module.js';
import { WhiteboardController } from './whiteboard.controller.js';
import { BoardDocService } from './doc/board-doc.service.js';
import { BoardGateway } from './doc/board.gateway.js';
import { whiteboardManifest } from './whiteboard.manifest.js';
import { WhiteboardService } from './whiteboard.service.js';

/**
 * Whiteboards.
 *
 * Depends on nothing but core. A board names the meeting it was drawn in with a plain id and
 * never asks the meetings module about it, which is what keeps the two from becoming a cycle
 * when the meeting room grows a whiteboard tab.
 *
 * AuthModule is imported for the board socket, which verifies its own token.
 */
@Module({
  imports: [AuthModule],
  controllers: [WhiteboardController],
  providers: [WhiteboardService, BoardDocService, BoardGateway],
  exports: [WhiteboardService, BoardDocService],
})
export class WhiteboardModule implements OnModuleInit {
  constructor(
    private readonly manifests: ManifestRegistry,
    private readonly aiTools: AiToolRegistry,
    private readonly whiteboards: WhiteboardService,
    private readonly boardDocs: BoardDocService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.manifests.register(whiteboardManifest);
    await this.whiteboards.ensureReportingViews();

    /*
     * Where the scene authority reads and writes.
     *
     * Bound here rather than injected: WhiteboardService is what persists a board and the
     * authority is what writes through it, and asking Nest to resolve that circle with
     * forwardRef would work while making both harder to test. The AI tools below are wired
     * the same way, for the same reason — and MeetingsModule does exactly this for notes.
     */
    this.boardDocs.bind({
      load: (boardId: string) => this.whiteboards.loadScene(boardId),
      save: (boardId, changed, appState, actor) =>
        this.whiteboards.saveScene(boardId, changed, appState, actor),
    });

    this.aiTools.bind('whiteboard_list', (actor: Actor, input) =>
      this.whiteboards.listTool(actor, input as { meetingId?: string; limit?: number }),
    );
    this.aiTools.bind('whiteboard_read', (actor: Actor, input) =>
      this.whiteboards.readTool(actor, input as { boardId: string }),
    );
  }
}
