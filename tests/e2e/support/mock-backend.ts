import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { v2 } from '@codex-remote/codex-app-server-types';

type MockBackend = {
  apiBaseUrl: string;
  wsBaseUrl: string;
  close: () => Promise<void>;
};

export async function startMockBackend(): Promise<MockBackend> {
  const uploadedFiles = new Map<string, Buffer>();
  const threadSyncCountByThread = new Map<string, number>();
  const activeTurnByThread = new Map<string, {
    turnId: string;
    startedAt: number;
  }>();
  const threadPrefs = new Map<string, {
    model?: string;
    effort?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  }>();
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function toErrorMessage(prefix: string, detail: string): string {
    return `${prefix}: ${detail}`;
  }

  function later(delayMs: number, task: () => void) {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      task();
    }, delayMs);
    pendingTimers.add(timer);
  }

  function applyCors(request: http.IncomingMessage, response: http.ServerResponse) {
    const origin = request.headers.origin || '*';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-codex-remote-token, x-upload-filename');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    applyCors(request, response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/session') {
      const now = Date.now();
      response.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'codex_remote_session=mock-session.mock-secret; Path=/; HttpOnly; SameSite=Lax',
      });
      response.end(JSON.stringify({
        ok: true,
        session: {
          sessionId: 'mock-session',
          deviceName: 'Playwright',
          createdAt: now,
          lastSeenAt: now,
          expiresAt: now + 3600000,
          current: true,
          online: true,
        },
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/sessions') {
      const now = Date.now();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        sessions: [{
          sessionId: 'mock-session',
          deviceName: 'Playwright',
          createdAt: now,
          lastSeenAt: now,
          expiresAt: now + 3600000,
          current: true,
          online: true,
        }],
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'ok',
        tabs: 1,
        websocketClients: 1,
        uptimeSec: 12,
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/workspace/shortcuts') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        projectRoot: 'C:\\workspace',
        desktopPath: 'C:\\Users\\Administrator\\Desktop',
        lastUsedPath: 'C:\\workspace',
        preferredPath: 'C:\\workspace',
        roots: ['C:\\workspace'],
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/codex/options') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        models: [
          {
            id: 'gpt-5-codex',
            model: 'gpt-5-codex',
            displayName: 'GPT-5 Codex',
            description: 'Mock model for E2E',
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high'],
          },
          {
            id: 'gpt-5.5',
            model: 'gpt-5.5',
            displayName: 'GPT-5.5',
            description: 'Alternate mock model for E2E',
            isDefault: false,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high'],
          },
        ],
        defaults: {
          model: 'gpt-5-codex',
          reasoningEffort: 'medium',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
        },
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/workspace/list') {
      const targetPath = url.searchParams.get('path') || 'C:\\workspace';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        path: targetPath,
        parentPath: 'C:\\',
        entries: [
          { name: 'demo', path: 'C:\\workspace\\demo' },
          { name: 'docs', path: 'C:\\workspace\\docs' },
        ],
      }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/workspace/create-directory') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        path: `${payload.parentPath}\\${payload.folderName}`,
      }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/uploads/image') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const savedName = 'mock-upload.png';
      uploadedFiles.set(savedName, body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: savedName,
        name: 'demo.png',
        contentType: request.headers['content-type'] || 'image/png',
        filePath: `C:\\uploads\\${savedName}`,
        url: `/api/uploads/${savedName}`,
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/uploads/')) {
      const fileName = decodeURIComponent(url.pathname.split('/').pop() || '');
      const file = uploadedFiles.get(fileName);
      if (!file) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 'NOT_FOUND', message: '图片不存在' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(file);
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket) => {
    const followUpRequests: Array<Record<string, unknown>> = [
      {
        requestId: 'req-user-input',
        method: 'item/tool/requestUserInput',
        threadId: 'thread-1',
        turnId: 'turn-2',
        itemId: 'tool-user-input-1',
        kind: 'user_input',
        status: 'pending',
        createdAt: 5,
        questions: [
          {
            id: 'environment',
            header: 'Environment',
            question: 'Choose target environment',
            isOther: false,
            isSecret: false,
            options: [
              { label: 'staging', description: 'Deploy to staging' },
              { label: 'production', description: 'Deploy to production' },
            ],
          },
          {
            id: 'api_token',
            header: 'API Token',
            question: 'Provide API token',
            isOther: false,
            isSecret: true,
            options: [],
          },
        ],
      },
      {
        requestId: 'req-dynamic-tool',
        method: 'item/tool/call',
        threadId: 'thread-1',
        turnId: 'turn-2',
        itemId: 'tool-call-1',
        kind: 'dynamic_tool_call',
        status: 'pending',
        createdAt: 6,
        namespace: 'mock.math',
        tool: 'sum',
        arguments: {
          a: 1,
          b: 2,
        },
      },
      {
        requestId: 'req-mcp-form',
        method: 'mcpServer/elicitation/request',
        threadId: 'thread-1',
        turnId: 'turn-2',
        kind: 'mcp_server_elicitation',
        status: 'pending',
        createdAt: 7,
        serverName: 'mock-mcp',
        message: 'Collect deployment data',
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: {
            ticket: { type: 'string', title: 'Ticket' },
            urgent: { type: 'boolean', title: 'Urgent' },
            attempts: { type: 'integer', title: 'Attempts' },
          },
        },
        responseSchema: {
          type: 'object',
          properties: {
            ticket: { type: 'string', title: 'Ticket' },
            urgent: { type: 'boolean', title: 'Urgent' },
            attempts: { type: 'integer', title: 'Attempts' },
          },
        },
        meta: { source: 'mock-form' },
      },
      {
        requestId: 'req-mcp-url',
        method: 'mcpServer/elicitation/request',
        threadId: 'thread-1',
        turnId: 'turn-2',
        kind: 'mcp_server_elicitation',
        status: 'pending',
        createdAt: 8,
        serverName: 'mock-mcp',
        message: 'Authorize external service',
        mode: 'url',
        url: 'https://example.com/authorize',
        elicitationId: 'elicit-1',
        meta: { source: 'mock-url' },
      },
    ];
    let nextFollowUpIndex = 0;

    function sendApprovalRequest(request: Record<string, unknown>) {
      socket.send(JSON.stringify({
        type: 'server_request_required',
        request,
      }));
    }

    function sendResolvedRequest(requestId: string) {
      socket.send(JSON.stringify({
        type: 'server_request_resolved',
        requestId,
        threadId: 'thread-1',
      }));
    }

    function sendResponseError(message: string) {
      socket.send(JSON.stringify({
        type: 'error',
        threadId: 'thread-1',
        message,
      }));
    }

    function queueNextFollowUpRequest() {
      const request = followUpRequests[nextFollowUpIndex];
      nextFollowUpIndex += 1;
      if (!request) {
        return;
      }
      later(15, () => sendApprovalRequest(request));
    }

    function validateApprovalResponse(requestId: string, response: unknown): string | null {
      const record = isRecord(response) ? response : null;
      if (!record) {
        return toErrorMessage(requestId, 'response must be an object');
      }

      if (requestId === 'req-1') {
        return record.decision === 'accept'
          ? null
          : toErrorMessage(requestId, `expected decision=accept, got ${JSON.stringify(response)}`);
      }

      if (requestId === 'req-user-input') {
        const answers = isRecord(record.answers) ? record.answers : null;
        const environment = answers && isRecord(answers.environment) ? answers.environment as v2.ToolRequestUserInputResponse['answers'][string] : null;
        const apiToken = answers && isRecord(answers.api_token) ? answers.api_token as v2.ToolRequestUserInputResponse['answers'][string] : null;
        if (
          Array.isArray(environment?.answers)
          && environment.answers[0] === 'staging'
          && Array.isArray(apiToken?.answers)
          && apiToken.answers[0] === 'secret-value'
        ) {
          return null;
        }
        return toErrorMessage(requestId, `unexpected answers ${JSON.stringify(response)}`);
      }

      if (requestId === 'req-dynamic-tool') {
        const contentItems = Array.isArray(record.contentItems) ? record.contentItems : null;
        const first = contentItems?.[0];
        if (
          record.success === true
          && first
          && isRecord(first)
          && first.type === 'inputText'
          && first.text === 'ok from tool'
        ) {
          return null;
        }
        return toErrorMessage(requestId, `unexpected dynamic tool payload ${JSON.stringify(response)}`);
      }

      if (requestId === 'req-mcp-form') {
        const content = isRecord(record.content) ? record.content : null;
        const meta = isRecord(record._meta) ? record._meta : null;
        if (
          record.action === 'accept'
          && content?.ticket === 'ABC-123'
          && content?.urgent === true
          && content?.attempts === 2
          && meta?.source === 'mock-form'
        ) {
          return null;
        }
        return toErrorMessage(requestId, `unexpected MCP form payload ${JSON.stringify(response)}`);
      }

      if (requestId === 'req-mcp-url') {
        const meta = isRecord(record._meta) ? record._meta : null;
        if (
          record.action === 'accept'
          && record.content === null
          && meta?.source === 'mock-url'
        ) {
          return null;
        }
        return toErrorMessage(requestId, `unexpected MCP url payload ${JSON.stringify(response)}`);
      }

      return toErrorMessage(requestId, 'unknown request id');
    }

    socket.send(JSON.stringify({
      type: 'state',
      tabs: [{
        threadId: 'thread-1',
        name: 'Mock Session',
        cwd: 'C:\\workspace',
        status: 'idle',
        windowStatus: 'attached',
      }, {
        threadId: 'thread-closed',
        name: 'Closed Session',
        cwd: 'C:\\workspace\\docs',
        status: 'closed',
        windowStatus: 'detached',
      }],
      serverRequests: [{
        requestId: 'req-1',
        method: 'item/commandExecution/requestApproval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        kind: 'command_approval',
        command: 'npm test',
        cwd: 'C:\\workspace',
        status: 'pending',
        createdAt: 1,
      }],
      globalSupplementalItems: [],
    }));

    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));

      if (message.type === 'thread_sync') {
        const threadSyncCount = (threadSyncCountByThread.get(message.threadId) || 0) + 1;
        threadSyncCountByThread.set(message.threadId, threadSyncCount);
        const prefs = threadPrefs.get(message.threadId) || {};
        socket.send(JSON.stringify({
          type: 'tab_updated',
          tab: {
            threadId: message.threadId,
            name: message.threadId === 'thread-closed' ? 'Closed Session' : 'Mock Session',
            cwd: message.threadId === 'thread-closed' ? 'C:\\workspace\\docs' : 'C:\\workspace',
            status: message.threadId === 'thread-closed'
              ? 'closed'
              : activeTurnByThread.has(message.threadId)
                ? 'running'
                : 'idle',
            windowStatus: message.threadId === 'thread-closed' ? 'detached' : 'attached',
            model: prefs.model,
            reasoningEffort: prefs.effort,
            approvalPolicy: prefs.approvalPolicy,
            sandboxMode: prefs.sandboxMode,
          },
        }));
        socket.send(JSON.stringify({
          type: 'thread_sync',
          threadId: message.threadId,
          turns: [
            {
              id: 'turn-1',
              input: [{ type: 'text', text: 'hello from user' }],
              output: 'hello from assistant',
              status: 'completed',
              startedAt: 1_700_000_000,
              completedAt: 1_700_000_010,
              durationMs: 10_000,
            },
            ...(activeTurnByThread.has(message.threadId)
              ? [{
                id: activeTurnByThread.get(message.threadId)!.turnId,
                items: [],
                status: 'inProgress',
                startedAt: Math.floor(activeTurnByThread.get(message.threadId)!.startedAt / 1000),
                completedAt: null,
                durationMs: null,
              }]
              : []),
          ],
          supplementalItems: [],
          globalSupplementalItems: [{
            id: 'notice-1',
            type: '_warning',
            noticeKind: 'warning',
            text: 'Recovered warning',
            createdAt: 2,
          }],
          tokenUsage: {
            total: { totalTokens: 22 },
            last: { totalTokens: 22 },
            modelContextWindow: 100,
          },
          turnPlans: [{
            turnId: 'turn-1',
            explanation: 'Inspect and patch',
            plan: [{ step: 'Inspect', status: 'completed' }, { step: 'Patch', status: 'in_progress' }],
            updatedAt: 2,
          }],
          turnDiffs: [{
            turnId: 'turn-1',
            diff: '*** Begin Patch\n*** End Patch',
            updatedAt: 2,
          }],
        }));
        if (threadSyncCount > 1) {
          later(25, () => socket.send(JSON.stringify({
            type: 'notification',
            method: 'deprecationNotice',
            params: {
              summary: '弃用通知',
              details: 'persistExtendedHistory is deprecated and ignored',
            },
          })));
        }
        return;
      }

      if (message.type === 'tab_create') {
        socket.send(JSON.stringify({
          type: 'tab_created',
          threadId: 'thread-2',
          tab: {
            threadId: 'thread-2',
            name: message.name || 'New Session',
            cwd: message.cwd || 'C:\\workspace',
            status: 'idle',
            windowStatus: 'detached',
          },
        }));
        return;
      }

      if (message.type === 'turn_send') {
        if (message.threadId === 'thread-1') {
          const prefs = threadPrefs.get(message.threadId);
          if (
            prefs?.model !== 'gpt-5.5'
            || prefs?.effort !== 'high'
            || prefs?.approvalPolicy !== 'never'
            || prefs?.sandboxMode !== 'danger-full-access'
            || message.model !== 'gpt-5.5'
            || message.effort !== 'high'
            || message.approvalPolicy !== 'never'
            || message.sandboxMode !== 'danger-full-access'
          ) {
            socket.send(JSON.stringify({
              type: 'error',
              op: 'turn_send',
              threadId: message.threadId,
              clientMessageId: message.clientMessageId,
              message: `unexpected turn options: ${JSON.stringify({
                prefs,
                model: message.model,
                effort: message.effort,
                approvalPolicy: message.approvalPolicy,
                sandboxMode: message.sandboxMode,
              })}`,
            }));
            return;
          }
        }
        socket.send(JSON.stringify({
          type: 'turn_started',
          threadId: message.threadId,
          turnId: 'turn-2',
          startedAt: 3,
        }));
        activeTurnByThread.set(message.threadId, {
          turnId: 'turn-2',
          startedAt: Date.now(),
        });
        socket.send(JSON.stringify({
          type: 'item_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'reasoning-2',
          method: 'item/reasoning/textDelta',
          delta: 'Thinking through the patch',
          startedAt: 3,
        }));
        later(25, () => socket.send(JSON.stringify({
          type: 'plan_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'plan-2',
          delta: 'Run tests',
          startedAt: 3,
        })));
        later(35, () => socket.send(JSON.stringify({
          type: 'turn_plan_updated',
          threadId: message.threadId,
          turnId: 'turn-2',
          explanation: 'Inspect and patch',
          plan: [
            { step: 'Inspect', status: 'completed' },
            { step: 'Patch', status: 'in_progress' },
          ],
        })));
        later(50, () => socket.send(JSON.stringify({
          type: 'item_started',
          threadId: message.threadId,
          turnId: 'turn-2',
          item: {
            id: 'cmd-2',
            type: 'commandExecution',
            command: 'npm test',
            cwd: 'C:\\workspace',
            status: 'running',
          },
        })));
        later(75, () => socket.send(JSON.stringify({
          type: 'item_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'cmd-2',
          method: 'item/commandExecution/outputDelta',
          delta: 'All green',
          startedAt: 3,
        })));
        later(100, () => socket.send(JSON.stringify({
          type: 'item_started',
          threadId: message.threadId,
          turnId: 'turn-2',
          item: {
            id: 'file-2',
            type: 'fileChange',
            status: 'running',
          },
        })));
        later(125, () => socket.send(JSON.stringify({
          type: 'item_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'file-2',
          method: 'item/fileChange/patchUpdated',
          patch: '*** Begin Patch\n*** Update File: app.tsx\n@@ -2,2 +2,3 @@\n const oldValue = 1;\n-oldCall();\n+newCall();\n+extraCall();\n*** End Patch',
          changes: [{ path: 'app.tsx', kind: 'update' }],
          startedAt: 3,
        })));
        later(150, () => socket.send(JSON.stringify({
          type: 'server_request_updated',
          request: {
            requestId: 'req-1',
            method: 'item/commandExecution/requestApproval',
            threadId: message.threadId,
            turnId: 'turn-2',
            kind: 'command_approval',
            command: 'npm test',
            cwd: 'C:\\workspace',
            status: 'pending',
            createdAt: 4,
          },
        })));
        later(170, () => socket.send(JSON.stringify({
          type: 'notification',
          method: 'mcpServer/startupStatus/updated',
          params: {
            name: 'mock-mcp',
            status: 'ready',
            error: null,
          },
        })));
        later(180, () => socket.send(JSON.stringify({
          type: 'notification',
          method: 'guardianWarning',
          params: {
            threadId: message.threadId,
            message: 'Manual review recommended',
          },
        })));
        later(190, () => socket.send(JSON.stringify({
          type: 'notification',
          method: 'configWarning',
          params: {
            summary: 'config.toml contains deprecated field',
            details: 'Replace legacySandbox with sandboxMode',
            path: 'C:\\workspace\\config.toml',
          },
        })));
        later(200, () => socket.send(JSON.stringify({
          type: 'notification',
          method: 'account/rateLimits/updated',
          params: {
            rateLimits: {
              limitId: 'limit-1',
              limitName: 'GPT-5',
              primary: null,
              secondary: null,
              credits: null,
              planType: 'plus',
              rateLimitReachedType: 'soft',
            },
          },
        })));
        later(210, () => socket.send(JSON.stringify({
          type: 'notification',
          method: 'deprecationNotice',
          params: {
            summary: '弃用通知',
            details: 'persistExtendedHistory is deprecated and ignored',
          },
        })));
        later(5000, () => socket.send(JSON.stringify({
          type: 'turn_completed',
          threadId: message.threadId,
          turnId: 'turn-2',
        })));
        later(5000, () => activeTurnByThread.delete(message.threadId));
        return;
      }

      if (message.type === 'thread_options_update') {
        threadPrefs.set(message.threadId, {
          model: message.model,
          effort: message.effort,
          approvalPolicy: message.approvalPolicy,
          sandboxMode: message.sandboxMode,
        });
        socket.send(JSON.stringify({
          type: 'tab_updated',
          tab: {
            threadId: message.threadId,
            name: 'Mock Session',
            cwd: 'C:\\workspace',
            status: 'idle',
            windowStatus: 'attached',
            model: message.model,
            reasoningEffort: message.effort,
            approvalPolicy: message.approvalPolicy,
            sandboxMode: message.sandboxMode,
          },
        }));
        return;
      }

      if (message.type === 'server_request_respond') {
        const validationError = validateApprovalResponse(String(message.requestId), message.response);
        if (validationError) {
          sendResponseError(validationError);
          return;
        }
        sendResolvedRequest(String(message.requestId));
        if (
          message.requestId === 'req-1'
          || message.requestId === 'req-user-input'
          || message.requestId === 'req-dynamic-tool'
          || message.requestId === 'req-mcp-form'
        ) {
          queueNextFollowUpRequest();
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    wsBaseUrl: `ws://127.0.0.1:${address.port}/ws`,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      for (const timer of pendingTimers) {
        clearTimeout(timer);
      }
      pendingTimers.clear();
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
