import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { UploadImageResponse } from '@codex-remote/protocol';
import { uploadFileParamsSchema } from '@codex-remote/protocol';
import { createUploadRecord } from '@codex-remote/domain';
import type { FastifyInstance } from 'fastify';
import { resolveRepoPath } from '../../runtime-paths.js';

const IMAGE_CONTENT_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/bmp', '.bmp'],
]);

const UPLOAD_ROOT = resolveRepoPath('.codex-remote-uploads');

function normalizeImageContentType(value: string | undefined): string {
  const contentType = String(value || '').trim().toLowerCase();
  if (!IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error('不支持的图片类型');
  }
  return contentType;
}

function decodeUploadFileName(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return '';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function buildUploadFileName(originalName: string, contentType: string): string {
  const extension = IMAGE_CONTENT_TYPES.get(contentType) || '.bin';
  const safeBase = path.basename(originalName || 'upload', path.extname(originalName || 'upload'))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'upload';
  return `${Date.now()}-${safeBase}${extension}`;
}

function resolveUploadedFile(fileName: string): string {
  const params = uploadFileParamsSchema.parse({ fileName });
  const normalized = path.basename(params.fileName).trim();
  if (!normalized) {
    throw new Error('图片文件名无效');
  }
  return path.join(UPLOAD_ROOT, normalized);
}

export type UploadService = ReturnType<typeof createUploadService>;

export function createUploadService(app: FastifyInstance) {
  return {
    async saveImage(input: {
      contentTypeHeader: string | undefined;
      originalNameHeader: string | string[] | undefined;
      body: unknown;
    }): Promise<UploadImageResponse> {
      const contentType = normalizeImageContentType(input.contentTypeHeader);
      const originalName = decodeUploadFileName(input.originalNameHeader);
      const savedName = buildUploadFileName(originalName, contentType);
      const filePath = path.join(UPLOAD_ROOT, savedName);
      const body = Buffer.isBuffer(input.body) ? input.body : Buffer.alloc(0);

      if (!body.length) {
        throw new Error('图片内容为空');
      }

      if (body.length > app.config.maxImageUploadBytes) {
        throw new Error('图片大小超出限制');
      }

      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
      await fsp.writeFile(filePath, body);
      app.repositories.uploads.upsertUpload(createUploadRecord({
        id: savedName,
        savedName,
        originalName: originalName || savedName,
        contentType,
        filePath,
        createdAt: Date.now(),
      }));

      return {
        id: savedName,
        name: originalName || savedName,
        contentType,
        filePath,
        url: `/api/uploads/${encodeURIComponent(savedName)}`,
      };
    },

    resolveFilePath(fileName: string): string {
      return resolveUploadedFile(fileName);
    },
  };
}
