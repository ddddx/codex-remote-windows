# Codex Remote Rebuild

用于远程控制本机 Codex 会话的新架构版本。当前主链路已经切到 monorepo：

- `apps/server`: Fastify + WebSocket server
- `apps/web`: React + Vite 控制台
- `packages/protocol`: shared HTTP / WS types 与 schemas
- `packages/domain`: domain entities / factories / repositories
- `packages/adapters`: SQLite 与 legacy import adapters

运行时已经完全切到新 `server + web` 链路，不再依赖旧兼容层。

## 能力

- 会话列表、会话创建、线程同步
- prompt 发送与实时 timeline
- turn 分组、reasoning / plan / command / file change 语义展示
- 内联审批与 inspector 审批面板
- workspace 浏览与建目录
- 图片上传与附件发送
- SQLite 持久化
- legacy JSON 状态导入

## 环境

- Windows
- Node.js 22+
- 已安装 Codex CLI

## 安装

```bash
npm install
```

## 启动

开发模式:

```bash
npm run dev:web
npm run dev:server
```

生产模式:

```bash
npm start
```

默认地址:

- dev web: `http://127.0.0.1:5173`
- server: `http://127.0.0.1:18637`

## 关键命令

类型检查:

```bash
npm run typecheck
```

workspace tests:

```bash
npm test
```

integration:

```bash
npm run test:integration
```

e2e:

```bash
npm run test:e2e
```

legacy state migration:

```bash
npm run migrate:legacy-state
```

可选参数:

```bash
npm run migrate:legacy-state -- --sqlite-file .codex-remote.sqlite --app-state .codex-remote-state.json --window-map .window-map.json
```

## 配置

server 读取这些变量:

- `HOST`
- `PORT`
- `WS_TOKEN`
- `NODE_ENV`
- `MAX_IMAGE_UPLOAD_BYTES`
- `SQLITE_FILE`
- `CODEX_CMD`
- `CODEX_HOME`
- `CODEX_CONNECT_TIMEOUT`
- `CODEX_REQUEST_TIMEOUT`

`config.local.json` 固定放在仓库根目录，仅作为新 server 的本地环境文件来源。

## 项目结构

```text
cc-workspace/
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   ├── adapters/
│   ├── domain/
│   └── protocol/
├── docs/
├── scripts/
├── test/
├── tests/
│   ├── e2e/
│   └── integration/
```

## 迁移与切换

执行顺序:

1. `npm run typecheck`
2. `npm test`
3. `npm run test:integration`
4. `npm run test:e2e`
5. `npm run migrate:legacy-state`

详细执行文档见:

- `docs/migration-runbook.md`
- `docs/implementation-roadmap.md`
- `docs/rebuild-plan.md`

## 当前状态

当前 rebuild 已完成以下验证:

- workspace typecheck 通过
- package tests 通过
- integration tests 通过
- Playwright E2E 通过
