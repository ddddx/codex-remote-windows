# codex-remote-windows

面向 Windows 的本机 Codex 网页控制台。

它的用途不是跨平台部署，也不是云端托管，而是在 Windows 机器上启动一个本地服务，用浏览器控制本机 Codex 会话。浏览器通过 HTTP + WebSocket 连接本地服务，再由服务端转接本机 Codex app-server。

## 快速开始

环境要求：

- Windows
- Node.js 22+
- 已安装 Codex CLI
- 建议使用 PowerShell

拉取项目：

```bash
git clone https://github.com/ddddx/codex-remote-windows.git
cd codex-remote-windows
```

安装依赖：

```bash
npm install
```

Windows 开发模式：

```bash
npm run dev:web
npm run dev:server
```

这两个命令需要分两个终端窗口运行。

Windows 本机启动：

```bash
npm start
```

重启已有服务：

```bash
npm run restart
```

停止已有服务：

```bash
npm stop
```

默认地址：

- web dev：`http://127.0.0.1:5173`
- server：`http://127.0.0.1:18637`

生产模式下，server 会直接托管 `apps/web/dist`，适合在 Windows 本机长期挂着使用。

## 配置

Windows 服务端启动时会读取仓库根目录的 `config.local.json`，并把其中的值填充到尚未设置的环境变量里。

优先级是：

- 当前 shell 已设置的环境变量
- 仓库根目录的 `config.local.json`
- 代码内置默认值

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
- `CODEX_CMD`
- `CODEX_APP_SERVER_WS`
- `CODEX_CONNECT_TIMEOUT`
- `CODEX_REQUEST_TIMEOUT`
- `WINDOW_MAP_FILE`

说明：

- `WS_TOKEN` 用于 WebSocket 和部分 HTTP 接口鉴权
- `SQLITE_FILE` 默认是 `.codex-remote.sqlite`
- 图片上传目录默认在仓库根目录下的 `.codex-remote-uploads/`
- `CODEX_CMD` 默认是 `codex.cmd`
- `CODEX_APP_SERVER_WS` 默认是 `ws://127.0.0.1:34792`

## 项目定位

- Windows 本机使用
- 本地浏览器控制本机 Codex 会话
- 服务端负责连接本机 Codex app-server
- 可配合 Tailscale 从外部设备远程访问这台 Windows 机器上的控制台
- 不主打 Linux / macOS / 云端部署场景

## 当前能力

- 会话列表、创建会话、关闭会话标签
- 会话同步与时间线展示
- reasoning / plan / command / file change / approval 语义渲染
- 内联审批与 `request_user_input` 响应
- 工作区浏览、目录选择、建目录
- 图片上传并作为附件发送
- SQLite 持久化
- legacy JSON 状态迁移
- WebSocket Token 鉴权

## 常用命令

类型检查：

```bash
npm run typecheck
```

全部测试工作区：

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

## 仓库结构

当前主运行链路是：

- `apps/server`：Fastify + WebSocket 服务端
- `apps/web`：React + Vite 控制台
- `packages/protocol`：前后端共享协议类型
- `packages/domain`：领域模型与接口定义
- `packages/adapters`：SQLite 与 legacy 导入适配层

服务端会在本机连接 Codex app-server，对外提供网页控制台、工作区接口、上传接口和 WebSocket 实时消息。

```text
cc-workspace/
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   ├── adapters/
│   ├── domain/
│   └── protocol/
├── scripts/
├── test/
└── tests/
    ├── e2e/
    └── integration/
```

## 友情链接

- [Linux.do](https://linux.do)
