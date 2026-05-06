const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

class WorkspaceManager {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.stateFile = options.stateFile || path.join(this.projectRoot, '.codex-remote-state.json');
    this.state = this.loadState();
  }

  getShortcuts() {
    return {
      projectRoot: this.projectRoot,
      desktopPath: this.normalizeExistingDirectory(path.join(os.homedir(), 'Desktop')),
      lastUsedPath: this.getLastUsedPath(),
      preferredPath: this.getPreferredPath(),
      roots: this.getRoots(),
    };
  }

  getLastUsedPath() {
    return this.normalizeExistingDirectory(this.state.lastWorkspacePath || '');
  }

  getPreferredPath() {
    return this.getLastUsedPath() || this.projectRoot;
  }

  resolveWorkspacePath(inputPath) {
    const raw = typeof inputPath === 'string' ? inputPath.trim() : '';
    if (!raw) {
      return this.projectRoot;
    }

    const resolved = path.resolve(this.projectRoot, raw);
    if (!fs.existsSync(resolved)) {
      throw new Error(`工作区目录不存在：${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`工作区不是目录：${resolved}`);
    }

    return resolved;
  }

  rememberPath(workspacePath) {
    const normalized = this.resolveWorkspacePath(workspacePath);
    this.state.lastWorkspacePath = normalized;
    this.saveState();
    return normalized;
  }

  createDirectory(parentPath, folderName) {
    const parent = this.resolveWorkspacePath(parentPath || this.getPreferredPath());
    const sanitizedFolderName = sanitizeFolderName(folderName);
    const nextPath = path.join(parent, sanitizedFolderName);

    if (fs.existsSync(nextPath)) {
      throw new Error(`目录已存在：${nextPath}`);
    }

    fs.mkdirSync(nextPath, { recursive: false });
    this.rememberPath(nextPath);
    return nextPath;
  }

  listDirectory(inputPath) {
    const targetPath = this.resolveWorkspacePath(inputPath || this.getPreferredPath());
    const entries = fs.readdirSync(targetPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(targetPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));

    return {
      path: targetPath,
      parentPath: this.getParentPath(targetPath),
      entries,
    };
  }

  getParentPath(inputPath) {
    const targetPath = this.resolveWorkspacePath(inputPath);
    const parsed = path.parse(targetPath);
    const normalizedRoot = parsed.root.replace(/[\\/]+$/, '').toLowerCase();
    const normalizedTarget = targetPath.replace(/[\\/]+$/, '').toLowerCase();
    if (normalizedRoot === normalizedTarget) {
      return '';
    }

    const parentPath = path.dirname(targetPath);
    return parentPath === targetPath ? '' : parentPath;
  }

  getRoots() {
    const roots = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) {
        roots.push(drive);
      }
    }
    return roots;
  }

  normalizeExistingDirectory(inputPath) {
    const raw = typeof inputPath === 'string' ? inputPath.trim() : '';
    if (!raw) {
      return '';
    }

    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved)) {
      return '';
    }

    try {
      if (!fs.statSync(resolved).isDirectory()) {
        return '';
      }
    } catch (_error) {
      return '';
    }

    return resolved;
  }

  loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return {};
      }

      const raw = fs.readFileSync(this.stateFile, 'utf8').trim();
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return parsed;
    } catch (_error) {
      return {};
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      console.log(`[workspace] failed to save state: ${error.message}`);
    }
  }
}

function sanitizeFolderName(folderName) {
  const normalized = typeof folderName === 'string' ? folderName.trim() : '';
  if (!normalized) {
    throw new Error('文件夹名称不能为空');
  }
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(normalized)) {
    throw new Error('文件夹名称包含非法字符');
  }
  if (normalized === '.' || normalized === '..') {
    throw new Error('文件夹名称非法');
  }
  return normalized;
}

module.exports = { WorkspaceManager };
