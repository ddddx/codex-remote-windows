import type { FastifyInstance } from 'fastify';
import { createApprovalService, type ApprovalService } from './approval-service.js';
import { createAuthService, type AuthService } from './auth-service.js';
import { createCodexOptionsService, type CodexOptionsService } from './codex-options-service.js';
import { createCommandService, type CommandService } from './command-service.js';
import { createSessionService, type SessionService } from './session-service.js';
import { createTurnService, type TurnService } from './turn-service.js';
import { createUploadService, type UploadService } from './upload-service.js';
import { createWorkspaceService, type WorkspaceService } from './workspace-service.js';

export type AppServices = {
  approvals: ApprovalService;
  auth: AuthService;
  codexOptions: CodexOptionsService;
  commands: CommandService;
  sessions: SessionService;
  turns: TurnService;
  uploads: UploadService;
  workspace: WorkspaceService;
};

export function createAppServices(app: FastifyInstance): AppServices {
  return {
    approvals: createApprovalService(app),
    auth: createAuthService(app),
    codexOptions: createCodexOptionsService(app),
    commands: createCommandService(app),
    sessions: createSessionService(app),
    turns: createTurnService(app),
    uploads: createUploadService(app),
    workspace: createWorkspaceService(app),
  };
}
