export const CONTEXT_BASELINE_TOKENS = 12000;

export function formatTokenCountCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  const absolute = Math.abs(numeric);
  if (absolute >= 1_000_000) {
    const scaled = absolute / 1_000_000;
    const precision = scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(Number.isInteger(scaled) ? 0 : precision).replace(/\.?0+$/, '')}M`;
  }
  if (absolute >= 1_000) {
    const scaled = absolute / 1_000;
    const precision = scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(Number.isInteger(scaled) ? 0 : precision).replace(/\.?0+$/, '')}K`;
  }
  return Math.round(absolute).toLocaleString();
}

export function formatTokenCountFull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return Math.round(numeric).toLocaleString();
}

function getUsageBucket(usage, bucket) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  return usage[bucket] || usage[bucket.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] || null;
}

function getUsageValue(usage, bucket, field) {
  const source = getUsageBucket(usage, bucket);
  if (!source || typeof source !== 'object') {
    return 0;
  }
  const snakeField = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const value = Number(source[field] ?? source[snakeField] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function getTokenUsageInput(usage) {
  return getUsageValue(usage, 'total', 'inputTokens');
}

export function getTokenUsageCachedInput(usage) {
  return getUsageValue(usage, 'total', 'cachedInputTokens');
}

export function getTokenUsageOutput(usage) {
  return getUsageValue(usage, 'total', 'outputTokens');
}

export function getTokenUsageReasoning(usage) {
  return getUsageValue(usage, 'total', 'reasoningOutputTokens');
}

export function getTokenUsageContextTokens(usage) {
  return getUsageValue(usage, 'last', 'totalTokens');
}

export function getTokenUsageContextWindow(usage) {
  const value = Number(usage?.modelContextWindow ?? usage?.model_context_window ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function getTokenUsageNonCachedInput(usage) {
  return Math.max(0, getTokenUsageInput(usage) - getTokenUsageCachedInput(usage));
}

export function getTokenUsageBlendedTotal(usage) {
  return Math.max(0, getTokenUsageNonCachedInput(usage) + Math.max(0, getTokenUsageOutput(usage)));
}

export function getContextPercentRemaining(usage) {
  const contextWindow = getTokenUsageContextWindow(usage);
  if (contextWindow <= CONTEXT_BASELINE_TOKENS) {
    return null;
  }
  const effectiveWindow = contextWindow - CONTEXT_BASELINE_TOKENS;
  const used = Math.max(0, getTokenUsageContextTokens(usage) - CONTEXT_BASELINE_TOKENS);
  const remaining = Math.max(0, effectiveWindow - used);
  return Math.round(Math.min(100, Math.max(0, (remaining / effectiveWindow) * 100)));
}

export function closeContextUsagePopover(contextUsageEl) {
  if (!contextUsageEl) {
    return;
  }
  contextUsageEl.classList.remove('is-open');
  const button = contextUsageEl.querySelector('.context-usage-btn');
  if (button) {
    button.setAttribute('aria-expanded', 'false');
  }
}

export function renderContextUsage(contextUsageEl, state) {
  if (!contextUsageEl) {
    return;
  }

  const threadId = state.activeThreadId;
  const usage = threadId ? state.tokenUsageByThread.get(threadId) : null;
  const contextWindow = getTokenUsageContextWindow(usage);
  const percentRemaining = getContextPercentRemaining(usage);
  if (!threadId || !usage || !contextWindow || percentRemaining === null) {
    closeContextUsagePopover(contextUsageEl);
    contextUsageEl.hidden = true;
    contextUsageEl.innerHTML = '';
    return;
  }

  const contextTokens = getTokenUsageContextTokens(usage);
  const blendedTotal = getTokenUsageBlendedTotal(usage);
  const nonCachedInput = getTokenUsageNonCachedInput(usage);
  const cachedInput = getTokenUsageCachedInput(usage);
  const outputTokens = getTokenUsageOutput(usage);
  const reasoningTokens = getTokenUsageReasoning(usage);
  const isOpen = contextUsageEl.classList.contains('is-open');

  contextUsageEl.hidden = false;
  contextUsageEl.innerHTML = `
    <button class="context-usage-btn" type="button" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="查看上下文剩余">
      <span class="context-usage-ring" style="--context-percent:${percentRemaining}"></span>
      <span class="context-usage-copy">
        <span class="context-usage-value">${percentRemaining}%</span>
        <span class="context-usage-label">上下文剩余</span>
      </span>
    </button>
    <div class="context-usage-popover">
      <p class="context-usage-title">上下文剩余 ${percentRemaining}%</p>
      <p class="context-usage-subtitle">${formatTokenCountCompact(contextTokens)} used / ${formatTokenCountCompact(contextWindow)}</p>
      <div class="context-usage-grid">
        <div class="context-usage-stat">
          <span class="context-usage-stat-label">当前上下文</span>
          <span class="context-usage-stat-value">${formatTokenCountFull(contextTokens)}</span>
        </div>
        <div class="context-usage-stat">
          <span class="context-usage-stat-label">窗口上限</span>
          <span class="context-usage-stat-value">${formatTokenCountFull(contextWindow)}</span>
        </div>
        <div class="context-usage-stat">
          <span class="context-usage-stat-label">累计总量</span>
          <span class="context-usage-stat-value">${formatTokenCountFull(blendedTotal)}</span>
        </div>
        <div class="context-usage-stat">
          <span class="context-usage-stat-label">输入 / 输出</span>
          <span class="context-usage-stat-value">${formatTokenCountFull(nonCachedInput)} / ${formatTokenCountFull(outputTokens)}</span>
        </div>
      </div>
      <p class="context-usage-note">显示的是与 Codex 一致的上下文剩余比例。${cachedInput > 0 ? ` 已缓存输入 ${formatTokenCountFull(cachedInput)}。` : ''}${reasoningTokens > 0 ? ` 推理输出 ${formatTokenCountFull(reasoningTokens)}。` : ''}</p>
    </div>
  `;

  const button = contextUsageEl.querySelector('.context-usage-btn');
  if (!button) {
    return;
  }
  button.addEventListener('click', (event) => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }
    event.preventDefault();
    contextUsageEl.classList.toggle('is-open');
    button.setAttribute('aria-expanded', contextUsageEl.classList.contains('is-open') ? 'true' : 'false');
  });
}

export function renderHeaderStatus(activeStatusEl, tab, state, helpers) {
  const { hasPendingServerRequest, normalizeTabStatus } = helpers;

  if (state.authFailed) {
    activeStatusEl.hidden = false;
    activeStatusEl.textContent = '鉴权失败';
    activeStatusEl.className = 'status-badge failed';
    return;
  }

  if (state.creatingTab) {
    activeStatusEl.hidden = false;
    activeStatusEl.textContent = '创建中';
    activeStatusEl.className = 'status-badge running';
    return;
  }

  if (tab && hasPendingServerRequest(tab.threadId)) {
    activeStatusEl.hidden = false;
    activeStatusEl.textContent = '待批准';
    activeStatusEl.className = 'status-badge waiting';
    return;
  }

  if (tab?.windowStatus === 'closed') {
    activeStatusEl.hidden = false;
    activeStatusEl.textContent = '窗口已关闭';
    activeStatusEl.className = 'status-badge closed';
    return;
  }

  if (tab?.windowStatus === 'detached') {
    activeStatusEl.hidden = false;
    activeStatusEl.textContent = '窗口未打开';
    activeStatusEl.className = 'status-badge closed';
    return;
  }

  const status = tab ? normalizeTabStatus(tab.status) : '';
  if (status === 'failed' || status === 'systemError') {
    activeStatusEl.hidden = false;
    activeStatusEl.textContent = '失败';
    activeStatusEl.className = 'status-badge failed';
    return;
  }

  activeStatusEl.hidden = true;
  activeStatusEl.textContent = '';
  activeStatusEl.className = 'status-badge';
}
