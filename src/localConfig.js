const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE_NAME = 'config.local.json';

function resolveConfigPath() {
  return process.env.LOCAL_CONFIG_PATH || path.join(process.cwd(), CONFIG_FILE_NAME);
}

function readLocalConfig() {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf8').trim();
  if (!raw) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse ${configPath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid config file ${configPath}: root value must be an object`);
  }

  return parsed;
}

function applyLocalConfig() {
  const config = readLocalConfig();

  for (const [key, value] of Object.entries(config)) {
    if (value == null || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = String(value);
  }

  return config;
}

module.exports = {
  CONFIG_FILE_NAME,
  applyLocalConfig,
  readLocalConfig,
  resolveConfigPath,
};
