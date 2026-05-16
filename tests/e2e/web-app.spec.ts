import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { startMockBackend } from './support/mock-backend.js';

test.setTimeout(120000);

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

test('web app matches current shell and conversation flow', async ({ page }) => {
  const backend = await startMockBackend();
  await page.setViewportSize({ width: 1400, height: 1000 });
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

    await page.goto('http://127.0.0.1:4173');

    await expect(page.locator('#activeTitle')).toHaveText('codex-remote-windows');
    await expect(page.locator('#activeStatus')).toHaveAttribute('aria-label', 'idle');
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.locator('#tokenBtn').click();
    await page.locator('#tokenInput').fill('secret-token');
    await page.getByRole('button', { name: '保存并登录' }).click();

    await expect(page.locator('#activeStatus')).toHaveAttribute('aria-label', 'connected');
    await expect(page.locator('#tabList')).toContainText('Mock Session');
    await page.locator('#sidebarClose').click();
    await expect(page.locator('.sidebar')).toBeVisible();
    await page.locator('#menuBtn').click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/hidden/);
    await page.locator('.tab-item-main').filter({ hasText: 'Mock Session' }).click();
    await expect(page.locator('#activeTitle')).toHaveText('Mock Session');
    await expect(page.locator('.context-usage-ring')).toHaveAttribute('aria-label', /上下文余量/);
    await expect(page.locator('.context-usage-popover')).toContainText('剩余 78 / 100 tokens');
    await expect.poll(async () => page.locator('#messages').evaluate((element) => {
      const node = element as HTMLDivElement;
      return node.scrollTop + node.clientHeight >= node.scrollHeight - 4;
    })).toBe(true);
    await page.locator('#sidebarClose').click();
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.locator('#promptInput').fill('Ship the refactor');
    await page.locator('#promptInput').press('Enter');

    await expect(page.locator('.messages')).toContainText('Ship the refactor');
    await expect(page.locator('.messages')).toContainText('npm test');
    await expect(page.locator('.messages')).toContainText('文件变更');
    await expect(page.locator('.messages')).toContainText('app.tsx');
    await expect(page.locator('.messages')).not.toContainText('Run tests');

    const commandCard = page.locator('.timeline-event').filter({ hasText: 'npm test' }).first();
    await expect(commandCard).toBeVisible();
    await expect(commandCard).not.toContainText('All green');
    await commandCard.locator('.timeline-process-summary').click();
    await expect(commandCard).toContainText('All green');

    const fileCard = page.locator('.timeline-event').filter({ hasText: 'app.tsx' }).first();
    await expect(fileCard).toBeVisible();
    let fileDetails = fileCard.locator('.timeline-inline-detail-body');
    if (!await fileDetails.isVisible()) {
      await fileCard.locator('.timeline-process-summary').click();
      fileDetails = fileCard.locator('.timeline-inline-detail-body');
    }
    await expect(fileDetails).toContainText('*** Update File: app.tsx');

    await expect(page.locator('.approval-banner')).toContainText('npm test');
    await page.getByRole('button', { name: '批准' }).first().click();
    await expect(page.locator('.approval-banner')).toHaveCount(0);

    await page.locator('#imageInput').setInputFiles({
      name: 'demo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71]),
    });
    await expect(page.locator('#composerAttachmentList')).toContainText('demo.png');

    await page.locator('#menuBtn').click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/hidden/);
    await page.locator('#newTabBtn').click();
    await expect(page.locator('#sessionModalTitle')).toHaveText('新建会话');
    await expect(page.locator('.workspace-browser-path')).toContainText('C:\\workspace');
    await page.locator('.workspace-browser-item').filter({ hasText: 'demo' }).click();
    await expect(page.locator('.workspace-browser-path')).toContainText('C:\\workspace\\demo');
    const sessionModal = page.locator('.session-modal-card');
    await sessionModal.getByPlaceholder('新文件夹名称').fill('next-folder');
    await sessionModal.locator('.session-workspace-actions').last().getByRole('button', { name: '新建文件夹' }).click();
    await expect(page.locator('.workspace-browser-path')).toContainText('C:\\workspace\\demo\\next-folder');
  } finally {
    web.kill('SIGKILL');
    await Promise.race([
      once(web, 'exit').then(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await Promise.race([
      backend.close(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
});
