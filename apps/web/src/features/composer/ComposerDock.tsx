import type { CodexOptionModel } from '@codex-remote/protocol';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TokenUsageDisplay } from '../../app/view-helpers.js';
import { useAppStore, type AttachmentItem } from '../../store/appStore.js';
import { uploadImage } from '../../transport/http/uploads.js';

type ComposerPrefs = {
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
  sandboxMode: string;
};

type ComposerDockProps = {
  draft: string;
  setDraft: (value: string) => void;
  submit: () => void;
  resetSignal: number;
  busy: boolean;
  composerError: string;
  tokenReady: boolean;
  activeSessionId: string | null;
  controlsOpen: boolean;
  setControlsOpen: (value: boolean) => void;
  prefs: ComposerPrefs;
  composerControlsSummary: string;
  onPrefsChange: (next: Partial<ComposerPrefs>) => void;
  onPresetChange: (value: string) => void;
  permissionPresetValue: string;
  effectivePermissionPresetValue: string;
  modelOptions: CodexOptionModel[];
  defaults: ComposerPrefs;
  optionsStatus: 'idle' | 'loading' | 'ready' | 'error';
  tokenUsage: TokenUsageDisplay;
  theme: string;
  themeOptions: Array<{ value: string; label: string }>;
  onThemeChange: (value: string) => void;
  connectionStatus: string;
  connectionTone: 'connected' | 'waiting' | 'error';
};

const REASONING_OPTIONS = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PRESET_OPTIONS = ['', 'read-only', 'auto', 'full-access'];
const MIN_TEXTAREA_HEIGHT = 42;
const MAX_TEXTAREA_HEIGHT = 88;
const EMPTY_ATTACHMENTS: AttachmentItem[] = [];

type SlashCommandItem = {
  command: string;
  aliases?: string[];
  description: string;
  args?: string;
  executable: boolean;
};

const SLASH_COMMANDS: SlashCommandItem[] = [
  { command: 'goal', description: 'set or view the goal for a long-running task', args: '[objective | clear | pause | resume | complete]', executable: true },
  { command: 'compact', description: 'summarize conversation to prevent hitting the context limit', executable: true },
  { command: 'rename', description: 'rename the current thread', args: '<name>', executable: true },
  { command: 'stop', aliases: ['clean'], description: 'stop all background terminals', executable: true },
  { command: 'review', description: 'review my current changes and find issues', executable: false },
  { command: 'plan', description: 'switch to Plan mode', executable: false },
  { command: 'diff', description: 'show git diff (including untracked files)', executable: false },
  { command: 'status', description: 'show current session configuration and token usage', executable: false },
  { command: 'model', description: 'choose what model and reasoning effort to use', executable: false },
  { command: 'permissions', description: 'choose what Codex is allowed to do', executable: false },
  { command: 'new', description: 'start a new chat during a conversation', executable: false },
  { command: 'resume', description: 'resume a saved chat', executable: false },
  { command: 'fork', description: 'fork the current chat', executable: false },
  { command: 'init', description: 'create an AGENTS.md file with instructions for Codex', executable: false },
  { command: 'copy', description: 'copy last response as markdown', executable: false },
  { command: 'mention', description: 'mention a file', executable: false },
  { command: 'skills', description: 'use skills to improve how Codex performs specific tasks', executable: false },
  { command: 'mcp', description: 'list configured MCP tools; use /mcp verbose for details', executable: false },
  { command: 'apps', description: 'manage apps', executable: false },
  { command: 'plugins', description: 'browse plugins', executable: false },
  { command: 'logout', description: 'log out of Codex', executable: false },
  { command: 'quit', aliases: ['exit'], description: 'exit Codex', executable: false },
];

function getSlashQuery(value: string): string | null {
  if (!value.startsWith('/') || value.includes('\n')) {
    return null;
  }
  const body = value.slice(1);
  if (body.includes(' ')) {
    return null;
  }
  return body.toLowerCase();
}

function getSlashMatches(query: string): SlashCommandItem[] {
  return SLASH_COMMANDS
    .filter((item) => item.command.startsWith(query) || item.aliases?.some((alias) => alias.startsWith(query)))
    .slice(0, 9);
}

function completeSlashCommand(current: string, command: SlashCommandItem): string {
  const suffix = command.args ? ' ' : '';
  return `/${command.command}${suffix || (current === `/${command.command}` ? '' : ' ')}`;
}

function formatReasoningLabel(value: string): string {
  if (!value) {
    return '未设置';
  }
  if (value === 'none') {
    return '关闭';
  }
  if (value === 'minimal') {
    return '极低';
  }
  if (value === 'low') {
    return '低';
  }
  if (value === 'medium') {
    return '中';
  }
  if (value === 'high') {
    return '高';
  }
  if (value === 'xhigh') {
    return '超高';
  }
  return value;
}

function formatApprovalLabel(value: string): string {
  if (!value) {
    return '未设置';
  }
  if (value === 'untrusted') {
    return '仅不受信命令需批准';
  }
  if (value === 'on-request') {
    return '按需批准';
  }
  if (value === 'never') {
    return '从不询问';
  }
  if (value === 'on-failure') {
    return '失败后询问';
  }
  return value;
}

function formatSandboxLabel(value: string): string {
  if (!value) {
    return '未设置';
  }
  if (value === 'read-only') {
    return '只读';
  }
  if (value === 'workspace-write') {
    return '工作区可写';
  }
  if (value === 'danger-full-access') {
    return '完全权限';
  }
  return value;
}

function formatPresetLabel(value: string): string {
  if (!value) {
    return '未设置';
  }
  if (value === 'read-only') {
    return 'Read Only';
  }
  if (value === 'auto') {
    return 'Default';
  }
  if (value === 'full-access') {
    return 'Full Access';
  }
  return value;
}

function formatPresetDisplayLabel(value: string, approvalPolicy: string, sandboxMode: string): string {
  if (value) {
    return formatPresetLabel(value);
  }
  if (approvalPolicy && sandboxMode) {
    return `${formatApprovalLabel(approvalPolicy)} / ${formatSandboxLabel(sandboxMode)}`;
  }
  return '未设置';
}

function syncTextareaHeight(textarea: HTMLTextAreaElement, value: string) {
  const normalized = value.trim();
  textarea.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
  if (!normalized) {
    textarea.style.overflowY = 'hidden';
    textarea.scrollTop = 0;
    return;
  }
  textarea.style.height = 'auto';
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = nextHeight >= MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
}

function UsageRingVisual({ percentRemaining }: { percentRemaining: number | null }) {
  return (
    <svg className="context-usage-ring-visual" viewBox="0 0 28 28" aria-hidden="true">
      <circle className="context-usage-ring-track" cx="14" cy="14" r="10" />
      {percentRemaining !== null ? (
        <circle
          className="context-usage-ring-progress"
          cx="14"
          cy="14"
          r="10"
          pathLength="100"
          style={{ ['--usage-ring-value' as string]: `${percentRemaining}` }}
        />
      ) : null}
    </svg>
  );
}

function formatPercentRemaining(value: number | null): string {
  return value === null ? '未统计' : `${value}%`;
}

function UsagePopoverContent({ tokenUsage }: { tokenUsage: TokenUsageDisplay }) {
  return (
    <>
      <strong>{tokenUsage.label}</strong>
      {tokenUsage.percentRemaining !== null ? (
        <span className="context-usage-percent">余量 {formatPercentRemaining(tokenUsage.percentRemaining)}</span>
      ) : null}
      <span>{tokenUsage.detail}</span>
    </>
  );
}

export function ComposerDock(props: ComposerDockProps) {
  const {
    draft,
    setDraft,
    submit,
    resetSignal,
    busy,
    composerError,
    tokenReady,
    activeSessionId,
    controlsOpen,
    setControlsOpen,
    prefs,
    composerControlsSummary,
    onPrefsChange,
    onPresetChange,
    permissionPresetValue,
    effectivePermissionPresetValue,
    modelOptions,
    defaults,
    optionsStatus,
    tokenUsage,
    theme,
    themeOptions,
    onThemeChange,
    connectionStatus,
    connectionTone,
  } = props;

  const effectiveModel = prefs.model || defaults.model;
  const effectiveReasoningEffort = prefs.reasoningEffort || defaults.reasoningEffort;
  const effectiveApprovalPolicy = prefs.approvalPolicy || defaults.approvalPolicy;
  const effectiveSandboxMode = prefs.sandboxMode || defaults.sandboxMode;
  const resolvedPermissionPresetValue = permissionPresetValue || effectivePermissionPresetValue;
  const resolvedPermissionPresetLabel = formatPresetDisplayLabel(
    resolvedPermissionPresetValue,
    effectiveApprovalPolicy,
    effectiveSandboxMode,
  );

  const attachmentSessionKey = activeSessionId || '__new__';
  const attachments = useAppStore((state) => state.composer.attachmentsBySessionId[attachmentSessionKey] || EMPTY_ATTACHMENTS);
  const addAttachment = useAppStore((state) => state.addAttachment);
  const removeAttachment = useAppStore((state) => state.removeAttachment);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileUsageAnchorRef = useRef<HTMLDivElement | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mobileUsageOpen, setMobileUsageOpen] = useState(false);
  const slashQuery = getSlashQuery(draft);
  const slashMatches = useMemo(() => slashQuery === null ? [] : getSlashMatches(slashQuery), [slashQuery]);
  const slashMenuOpen = slashQuery !== null && slashMatches.length > 0;
  const selectedSlashIndex = slashMatches.length ? Math.min(slashIndex, slashMatches.length - 1) : 0;

  function applySlashCompletion(command: SlashCommandItem) {
    const nextDraft = completeSlashCommand(draft, command);
    setDraft(nextDraft);
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    syncTextareaHeight(textarea, draft);
  }, [draft]);

  useLayoutEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMobileUsageOpen(false);
  }, [activeSessionId, controlsOpen]);

  useEffect(() => {
    if (!mobileUsageOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!mobileUsageAnchorRef.current?.contains(target)) {
        setMobileUsageOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileUsageOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileUsageOpen]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
    textarea.style.overflowY = 'hidden';
    textarea.scrollTop = 0;
  }, [resetSignal]);

  if (!activeSessionId) {
    return (
      <div className="composer composer-empty">
        <div className="composer-empty-hint">选择一个会话，或从左侧新建会话。</div>
        {composerError ? <div className="status error">{composerError}</div> : null}
      </div>
    );
  }

  return (
    <form
      id="composer"
      className={`composer${controlsOpen ? ' mobile-controls-open' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="composer-mobile-toggle-row">
        <button
          id="composerControlsToggle"
          className="btn btn-secondary composer-mobile-toggle"
          type="button"
          aria-expanded={controlsOpen ? 'true' : 'false'}
          onClick={() => {
            setMobileUsageOpen(false);
            setControlsOpen(!controlsOpen);
          }}
        >
          <span className="composer-mobile-toggle-title">会话参数</span>
          <span id="composerControlsSummary" className="composer-mobile-toggle-summary">{composerControlsSummary}</span>
        </button>
        <div ref={mobileUsageAnchorRef} className="context-usage-anchor composer-mobile-toggle-usage-anchor">
          <button
            id="composerMobileUsageToggle"
            type="button"
            className={`context-usage-ring composer-mobile-toggle-usage${tokenUsage.percentRemaining === null ? ' is-empty' : ''}`}
            aria-label={`${tokenUsage.label}：${tokenUsage.detail}`}
            aria-controls="composerMobileUsagePopover"
            aria-expanded={mobileUsageOpen ? 'true' : 'false'}
            title={`${tokenUsage.label}：${tokenUsage.detail}`}
            onClick={() => setMobileUsageOpen((value) => !value)}
          >
            <UsageRingVisual percentRemaining={tokenUsage.percentRemaining} />
          </button>
          <div id="composerMobileUsagePopover" className={`context-usage-popover${mobileUsageOpen ? ' is-open' : ''}`}>
            <UsagePopoverContent tokenUsage={tokenUsage} />
          </div>
        </div>
      </div>

      <div className="composer-controls">
        <label className="composer-select-group">
          <span>模型</span>
          <select
            id="modelSelect"
            value={prefs.model || effectiveModel}
            disabled={optionsStatus === 'loading'}
            onChange={(event) => onPrefsChange({ model: event.target.value })}
          >
            <option value="">{effectiveModel || '未设置'}</option>
            {modelOptions.map((item) => (
              <option key={item.id || item.model} value={item.model}>{item.model || item.displayName}</option>
            ))}
          </select>
        </label>

        <label className="composer-select-group">
          <span>思考等级</span>
          <select
            id="reasoningEffortSelect"
            value={prefs.reasoningEffort || effectiveReasoningEffort}
            onChange={(event) => onPrefsChange({ reasoningEffort: event.target.value })}
          >
            {REASONING_OPTIONS.map((value) => (
              <option key={value || 'default'} value={value}>
                {value ? formatReasoningLabel(value) : formatReasoningLabel(effectiveReasoningEffort)}
              </option>
            ))}
          </select>
        </label>

        <label className="composer-select-group">
          <span>权限预设</span>
          <select
            id="permissionPresetSelect"
            value={permissionPresetValue || resolvedPermissionPresetValue}
            onChange={(event) => onPresetChange(event.target.value)}
          >
            {PRESET_OPTIONS.map((value) => (
              <option key={value || 'default'} value={value}>
                {value ? formatPresetLabel(value) : resolvedPermissionPresetLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="composer-select-group composer-select-group-theme" htmlFor="themeSelect">
          <span>主题</span>
          <select
            id="themeSelect"
            aria-label="主题"
            value={theme}
            onChange={(event) => onThemeChange(event.target.value)}
          >
            {themeOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <div className="composer-select-group composer-select-group-status">
          <span>连接</span>
          <div className="composer-connection-indicator">
            <span
              id="activeStatus"
              className={`status-badge status-badge-dot ${connectionTone === 'connected' ? '' : connectionTone === 'error' ? ' error' : ' waiting'}`}
              aria-label={connectionStatus}
              title={connectionStatus}
            />
          </div>
        </div>

        <div className="composer-controls-usage">
          <div className="context-usage-anchor">
            <button
              type="button"
              className={`context-usage-ring${tokenUsage.percentRemaining === null ? ' is-empty' : ''}`}
              aria-label={`${tokenUsage.label}：${tokenUsage.detail}`}
              title={`${tokenUsage.label}：${tokenUsage.detail}`}
            >
              <UsageRingVisual percentRemaining={tokenUsage.percentRemaining} />
            </button>
            <div className="context-usage-popover">
              <UsagePopoverContent tokenUsage={tokenUsage} />
            </div>
          </div>
        </div>
      </div>

      <div className="composer-input-row">
        <label className="btn btn-secondary composer-attach-btn">
          图片
          <input
            id="imageInput"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              const targetThreadId = attachmentSessionKey;
              void uploadImage(file).then((result) => {
                addAttachment(targetThreadId, {
                  ...result,
                  previewUrl: URL.createObjectURL(file),
                });
              });
              event.currentTarget.value = '';
            }}
          />
        </label>

        <div className="prompt-stack">
          <div id="composerAttachmentList" className="composer-attachment-list" hidden={!attachments.length}>
            {attachments.map((attachment) => (
              <article key={attachment.id} className="composer-attachment-card">
                <img src={attachment.previewUrl} alt={attachment.name} className="composer-attachment-thumb" />
                <div className="composer-attachment-meta">
                  <span className="composer-attachment-name">{attachment.name}</span>
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    onClick={() => removeAttachment(attachmentSessionKey, attachment.id)}
                  >
                    移除
                  </button>
                </div>
              </article>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            id="promptInput"
            placeholder="给当前会话发送指令..."
            rows={1}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              syncTextareaHeight(event.currentTarget, event.target.value);
            }}
            onKeyDown={(event) => {
              if (slashMenuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setSlashIndex((index) => {
                  const offset = event.key === 'ArrowDown' ? 1 : -1;
                  return (index + offset + slashMatches.length) % slashMatches.length;
                });
                return;
              }
              if (slashMenuOpen && (event.key === 'Tab' || event.key === 'Enter')) {
                event.preventDefault();
                applySlashCompletion(slashMatches[selectedSlashIndex]);
                return;
              }
              if (slashMenuOpen && event.key === 'Escape') {
                event.preventDefault();
                setDraft('');
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div id="slashMenu" className="slash-menu" hidden={!slashMenuOpen}>
            {slashMatches.map((command, index) => (
              <button
                key={command.command}
                type="button"
                className={`slash-menu-item${index === selectedSlashIndex ? ' active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySlashCompletion(command);
                }}
              >
                <span className="slash-menu-command">/{command.command}</span>
                {command.args ? <span className="slash-menu-args">{command.args}</span> : null}
                <span className="slash-menu-description">{command.description}</span>
                {!command.executable ? <span className="slash-menu-badge">提示</span> : null}
              </button>
            ))}
            <div className="slash-menu-hint">`!命令` 会作为用户 shell 命令执行。</div>
          </div>
        </div>

        <button type="submit" className="btn" disabled={busy || (!draft.trim() && !attachments.length) || !tokenReady}>
          {busy ? '发送中…' : '发送'}
        </button>
      </div>
      {composerError ? <div className="status error">{composerError}</div> : null}
    </form>
  );
}
