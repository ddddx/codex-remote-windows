# Codex Remote Rebuild

用于远程控制本机 Codex 会话的 monorepo 项目。当前主运行链路是：

- `apps/server`：Fastify + WebSocket 服务端
- `apps/web`：React + Vite 控制台
- `packages/protocol`：前后端共享协议类型
- `packages/domain`：领域模型与接口定义
- `packages/adapters`：SQLite 与 legacy 导入适配层

服务端会在本机连接 Codex app-server，对外提供网页控制台、工作区接口、上传接口和 WebSocket 实时消息。

## 当前能力

- 会话列表、创建会话、关闭会话标签
- 线程同步与时间线展示
- reasoning / plan / command / file change / approval 语义渲染
- 内联审批与 `request_user_input` 响应
- 工作区浏览、目录选择、建目录
- 图片上传并作为附件发送
- SQLite 持久化
- legacy JSON 状态迁移
- WebSocket Token 鉴权

## 环境要求

- Windows
- Node.js 22+
- 已安装 Codex CLI

## 安装

```bash
npm install
```

## 启动方式

开发模式：

```bash
npm run dev:web
npm run dev:server
```

生产模式：

```bash
npm start
```

默认地址：

- web dev：`http://127.0.0.1:5173`
- server：`http://127.0.0.1:18637`

生产模式下，server 会直接托管 `apps/web/dist`。

## 本地配置

服务端启动时会优先读取仓库根目录的 `config.local.json`。

如果这个文件不存在，server 会自动生成一个，至少包含：

- `PORT`
- `WS_TOKEN`
- `CODEX_CMD`
- `CODEX_APP_SERVER_WS`

当前代码实际读取的环境变量有：

- `HOST`
- `PORT`
- `WS_TOKEN`
- `NODE_ENV`
- `MAX_IMAGE_UPLOAD_BYTES`
- `SQLITE_FILE`

说明：

- `WS_TOKEN` 用于 WebSocket 和部分 HTTP 接口鉴权
- `SQLITE_FILE` 默认是 `.codex-remote.sqlite`
- 图片上传目录默认在仓库根目录下的 `.codex-remote-uploads/`

## 常用命令

类型检查：

```bash
npm run typecheck
```

单元/工作区测试：

```bash
npm test
```

集成测试：

```bash
npm run test:integration
```

E2E：

```bash
npm run test:e2e
```

构建：

```bash
npm run build
```

legacy 状态迁移：

```bash
npm run migrate:legacy-state
```

可选参数：

```bash
npm run migrate:legacy-state -- --sqlite-file .codex-remote.sqlite --app-state .codex-remote-state.json --window-map .window-map.json
```

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
└── tests/
    ├── e2e/
    └── integration/
```

## 文档

- `docs/current-behavior.md`
- `docs/manual-regression-checklist.md`
- `docs/migration-runbook.md`
- `docs/implementation-roadmap.md`
- `docs/rebuild-plan.md`

## 友情链接

- [Linux.do](https://linux.do)
