import type { CodexOptionModel } from '@codex-remote/protocol';
import { useLayoutEffect, useMemo, useRef } from 'react';
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
};

const REASONING_OPTIONS = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PRESET_OPTIONS = ['', 'read-only', 'auto', 'full-access'];
const MIN_TEXTAREA_HEIGHT = 42;
const MAX_TEXTAREA_HEIGHT = 88;
const EMPTY_ATTACHMENTS: AttachmentItem[] = [];

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

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    syncTextareaHeight(textarea, draft);
  }, [draft]);

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
      <button
        id="composerControlsToggle"
        className="btn btn-secondary composer-mobile-toggle"
        type="button"
        aria-expanded={controlsOpen ? 'true' : 'false'}
        onClick={() => setControlsOpen(!controlsOpen)}
      >
        <span className="composer-mobile-toggle-title">会话参数</span>
        <span id="composerControlsSummary" className="composer-mobile-toggle-summary">{composerControlsSummary}</span>
        <span
          className={`composer-mobile-toggle-usage${tokenUsage.percentRemaining === null ? ' is-empty' : ''}`}
          aria-label={`${tokenUsage.label}：${tokenUsage.detail}`}
          title={`${tokenUsage.label}：${tokenUsage.detail}`}
        >
          <UsageRingVisual percentRemaining={tokenUsage.percentRemaining} />
        </span>
      </button>

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
              <strong>{tokenUsage.label}</strong>
              <span>{tokenUsage.detail}</span>
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
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div id="slashMenu" className="slash-menu" hidden></div>
        </div>

        <button type="submit" className="btn" disabled={busy || (!draft.trim() && !attachments.length) || !tokenReady}>
          {busy ? '发送中…' : '发送'}
        </button>
      </div>
      {composerError ? <div className="status error">{composerError}</div> : null}
    </form>
  );
}
