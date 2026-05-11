import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { startMockBackend } from './support/mock-backend.js';

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('vite startup timeout');
}

test('web app handles session timeline approvals workspace and uploads', async ({ page }) => {
  const backend = await startMockBackend();
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  const web = spawn(process.execPath, [
    path.resolve('node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
  ], {
    cwd: path.resolve(process.cwd(), 'apps/web'),
    env: {
      ...process.env,
      VITE_API_BASE_URL: backend.apiBaseUrl,
      VITE_WS_URL: backend.wsBaseUrl,
    },
    stdio: 'pipe',
  });

  try {
    await waitForServer('http://127.0.0.1:4173', 30000);

    page.on('console', (message) => {
      process.stdout.write(`[browser:${message.type()}] ${message.text()}\n`);
    });
    page.on('pageerror', (error) => {
      process.stdout.write(`[pageerror] ${error.stack || error.message}\n`);
    });

    await page.goto('http://127.0.0.1:4173');
    process.stdout.write(`[body] ${await page.locator('body').innerText()}\n`);
    await expect(page.getByRole('heading', { name: 'Codex Remote Console' })).toBeVisible();

    await page.getByPlaceholder('WebSocket token').fill('secret-token');
    await expect(page.locator('.inspector-card').filter({ hasText: 'Tokenconfigured' })).toBeVisible();
    await expect(page.locator('.status-chip.small').filter({ hasText: 'connected' })).toBeVisible();

    await expect(page.getByText('Mock Session')).toBeVisible();
    await expect(page.getByText('Recovered warning')).toBeVisible();
    await expect(page.getByText('Execution Plan')).toBeVisible();
    await expect(page.locator('.approval-summary').filter({ hasText: 'npm test' })).toBeVisible();

    await page.getByPlaceholder('Type a prompt…').fill('Ship the refactor');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Thinking through the patch')).toBeVisible();
    await expect(page.getByText('Run tests')).toBeVisible();
    await expect(page.locator('.timeline-chip').filter({ hasText: 'update: app.tsx' })).toBeVisible();

    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.getByText('No pending approvals')).toBeVisible();

    await page.locator('.workspace-entry').filter({ hasText: 'demo' }).click();
    await expect(page.locator('.workspace-path')).toHaveText('C:\\workspace\\demo');

    await page.getByPlaceholder('New folder name').fill('next-folder');
    await page.getByRole('button', { name: 'Create folder' }).click();
    await expect(page.locator('.workspace-path')).toHaveText('C:\\workspace\\demo\\next-folder');

    await page.setInputFiles('input[type="file"]', {
      name: 'demo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71]),
    });
    await expect(page.getByText('demo.png')).toBeVisible();
  } finally {
    web.kill();
    await backend.close();
  }
});
