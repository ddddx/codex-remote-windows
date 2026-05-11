import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

type MockBackend = {
  apiBaseUrl: string;
  wsBaseUrl: string;
  close: () => Promise<void>;
};

export async function startMockBackend(): Promise<MockBackend> {
  const uploadedFiles = new Map<string, Buffer>();

  function applyCors(response: http.ServerResponse) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-codex-remote-token, x-upload-filename');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    applyCors(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
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
    socket.send(JSON.stringify({
      type: 'state',
      tabs: [{
        threadId: 'thread-1',
        name: 'Mock Session',
        cwd: 'C:\\workspace',
        status: 'idle',
        windowStatus: 'detached',
      }],
      serverRequests: [{
        requestId: 'req-1',
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
        socket.send(JSON.stringify({
          type: 'thread_sync',
          threadId: message.threadId,
          turns: [{
            id: 'turn-1',
            input: [{ type: 'text', text: 'hello from user' }],
            output: 'hello from assistant',
          }],
          supplementalItems: [],
          globalSupplementalItems: [{
            id: 'notice-1',
            type: '_warning',
            noticeKind: 'warning',
            text: 'Recovered warning',
            createdAt: 2,
          }],
          tokenUsage: { totalTokens: 22 },
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
        socket.send(JSON.stringify({
          type: 'turn_started',
          threadId: message.threadId,
          turnId: 'turn-2',
          startedAt: 3,
        }));
        socket.send(JSON.stringify({
          type: 'item_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'reasoning-2',
          method: 'item/reasoning/textDelta',
          delta: 'Thinking through the patch',
          startedAt: 3,
        }));
        socket.send(JSON.stringify({
          type: 'plan_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'plan-2',
          delta: 'Run tests',
          startedAt: 3,
        }));
        socket.send(JSON.stringify({
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
        }));
        socket.send(JSON.stringify({
          type: 'item_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'cmd-2',
          method: 'item/commandExecution/outputDelta',
          delta: 'All green',
          startedAt: 3,
        }));
        socket.send(JSON.stringify({
          type: 'item_started',
          threadId: message.threadId,
          turnId: 'turn-2',
          item: {
            id: 'file-2',
            type: 'fileChange',
            status: 'running',
          },
        }));
        socket.send(JSON.stringify({
          type: 'item_delta',
          threadId: message.threadId,
          turnId: 'turn-2',
          itemId: 'file-2',
          method: 'item/fileChange/patchUpdated',
          patch: '*** Begin Patch\n*** Update File: app.tsx\n*** End Patch',
          changes: [{ path: 'app.tsx', kind: 'update' }],
          startedAt: 3,
        }));
        socket.send(JSON.stringify({
          type: 'server_request_updated',
          request: {
            requestId: 'req-1',
            threadId: message.threadId,
            turnId: 'turn-2',
            kind: 'command_approval',
            command: 'npm test',
            cwd: 'C:\\workspace',
            status: 'pending',
            createdAt: 4,
          },
        }));
        socket.send(JSON.stringify({
          type: 'turn_completed',
          threadId: message.threadId,
          turnId: 'turn-2',
        }));
        return;
      }

      if (message.type === 'server_request_respond') {
        socket.send(JSON.stringify({
          type: 'server_request_resolved',
          requestId: message.requestId,
          threadId: 'thread-1',
        }));
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
