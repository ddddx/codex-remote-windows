# Codex Remote Tabs

通过手机或 PC 远程控制本机 Codex，会话以多标签显示，并映射到本机多个 Codex 窗口。

## 功能

- 控制端新建标签 -> PC 创建新的 Codex thread，并尝试打开一个本地 Codex 窗口
- 控制端关闭标签 -> 关闭对应窗口并归档对应 thread
- 支持在控制端发送 prompt 到指定标签
- 支持流式查看 agent 输出（delta）
- 手机/PC 都可访问（响应式 Web UI）
- 左侧边栏标签管理，支持打开/隐藏
- Markdown 渲染（代码块、加粗、列表、标题）
- 发送后显示思考动画，流式回复实时显示
- WebSocket 断开自动重连
- 支持网页端处理命令批准、文件修改批准和 `request_user_input`

## 运行要求

- Windows
- Node.js 22+
- 已安装 Codex CLI（`codex.cmd` 需在 PATH 中，或通过 `CODEX_CMD` 环境变量指定路径）

## 快速启动

```bash
npm install
npm run remote:restart
```

Windows 下也可以直接双击：

```bash
start-codex-remote.bat
```

如果你只是调试某一层，再单独启动：

```bash
npm run remote         # 只启动，不主动清理旧进程
npm run remote:restart # 先杀旧进程再重启，推荐
npm run appserver   # 只启动 Codex app-server
npm run web         # 只启动 Web 控制端
```

默认地址：

- 本机：`http://localhost:8787`
- 局域网：`http://<本机IP>:8787`

## 配置

默认会优先读取项目根目录下的 `config.local.json`；如果同名环境变量已设置，则环境变量优先级更高。

可用配置项 / 环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8787` | Web 控制端端口 |
| `CODEX_HOME` | Codex 默认目录 | 可选；仅在你想强制切换到另一套 Codex 数据目录时设置 |
| `CODEX_CMD` | `codex.cmd` | Codex CLI 路径 |
| `CODEX_APP_SERVER_WS` | `ws://127.0.0.1:4792` | app-server WebSocket 地址 |
| `WS_TOKEN` | 空 | WebSocket 鉴权 token；设置后，控制端连接必须携带同值 |

本地配置文件示例：

```json
{
  "PORT": 8787,
  "CODEX_CMD": "codex.cmd",
  "CODEX_APP_SERVER_WS": "ws://127.0.0.1:4792",
  "WS_TOKEN": "your-secret-token"
}
```

默认不设置 `CODEX_HOME`，这样远程控制的就是你平时在本机直接使用的那套 Codex。只有需要强制隔离时，才额外加上 `CODEX_HOME`。

仓库里提供了模板文件 `config.local.example.json`，实际生效的是你本机的 `config.local.json`。

也可以继续使用环境变量覆盖：

```powershell
$env:CODEX_CMD='C:\path\to\codex.cmd'
$env:PORT='9000'
$env:WS_TOKEN='your-secret-token'
npm run remote:restart
```

如果设置了 `WS_TOKEN`，访问控制端时可直接带上查询参数：

```text
http://<本机IP>:8787/?token=your-secret-token
```

如果没有带上，或浏览器里缓存的是旧 token，页面右上角的 `Token` / `设置 Token` 按钮可直接更新并重连。

## 远程访问（手机）

1. 让手机和 PC 在同一局域网。
2. 在 PC 上放开 `8787` 端口（只对内网）。
3. 手机浏览器访问 `http://<PC局域网IP>:8787`。

如果要公网访问，建议反向代理 + HTTPS + 强认证，不要直接裸露端口。

## 项目结构

```
cc-workspace/
├── public/           # 前端静态文件
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/              # 后端源码
│   ├── server.js     # Web 服务器 + WebSocket
│   ├── codexAppServerClient.js  # Codex app-server 客户端
│   └── windowManager.js         # 窗口管理
├── start-all.js        # 同时拉起 app-server 和 Web 控制端
├── restart-codex-remote.js # 按当前配置先杀旧进程再启动
├── start-appserver.js  # 调试用：只启动 app-server
├── start-web.js        # 调试用：只启动 Web 控制端
├── start-codex-remote.bat # Windows 一键重启入口
└── package.json
```

## 当前限制

- 会话关闭是归档（`thread/archive`），不是物理删除。
- "本地窗口映射"依赖 Windows `Start-Process`；若权限策略限制，仍可远程控制 thread，但不会自动弹出本地窗口。
