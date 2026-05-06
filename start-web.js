const { applyLocalConfig } = require('./src/localConfig');

applyLocalConfig();

process.env.CODEX_APP_SERVER_WS = process.env.CODEX_APP_SERVER_WS || 'ws://127.0.0.1:4792';
process.env.PORT = process.env.PORT || '8787';
require('./src/server.js');
