import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildApprovalDecisionResponse,
  buildApprovalSummary,
  describeTimelineType,
  formatApprovalKind,
  formatHealthStatus,
  formatTimelineLabel,
  getDecisionLabel,
  normalizeSchemaFieldValue,
  summarizeTimelineEntry,
  buildUserInputResponse,
} from '../../app/view-helpers.js';
import { useAppStore, type ServerRequestItem, type TimelineEntry } from '../../store/appStore.js';
import { buildTimelineGroups } from './model.js';

type TimelineWorkspaceProps = {
  onRespondApproval: (request: ServerRequestItem, response: unknown) => void;
};

type TaskStep = {
  id: string;
  status: string;
  text: string;
};

type FooterStatus = {
  tone: string;
  label: string;
  active: boolean;
};

type TimelineRenderable =
  | { kind: 'entry'; createdAt: number; id: string; entry: TimelineEntry }
  | { kind: 'approval'; createdAt: number; id: string; request: ServerRequestItem };

type RenderableFileChange = {
  path?: string;
  kind?: string;
  addedLines?: number;
  deletedLines?: number;
};

type ExpandableTimelineRowProps = {
  title: React.ReactNode;
  summary?: React.ReactNode;
  details?: React.ReactNode;
  className?: string;
};

function ExpandableTimelineRow(props: ExpandableTimelineRowProps) {
  const { title, summary, details, className = '' } = props;
  const [open, setOpen] = useState(false);
  const expandable = Boolean(details);

  return (
    <div className={`timeline-process-row ${className}${expandable ? ' is-expandable' : ''}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`timeline-process-summary${expandable ? ' is-expandable' : ''}`}
        onClick={() => {
          if (!expandable) {
            return;
          }
          setOpen((value) => !value);
        }}
      >
        <div className="timeline-inline-title">{title}</div>
        {summary ? <div className="timeline-inline-meta timeline-inline-summary">{summary}</div> : null}
      </button>
      {expandable && open ? <div className="timeline-inline-detail-body">{details}</div> : null}
    </div>
  );
}

function ExpandableFileChangeRow({
  title,
  summary,
  details,
  className = '',
}: ExpandableTimelineRowProps) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(details);

  return (
    <div className={`timeline-process-row ${className}${expandable ? ' is-expandable' : ''}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`timeline-process-summary timeline-process-summary-file${expandable ? ' is-expandable' : ''}`}
        onClick={() => {
          if (!expandable) {
            return;
          }
          setOpen((value) => !value);
        }}
      >
        <div className="timeline-inline-title">{title}</div>
        {summary ? <div className="timeline-inline-meta timeline-inline-summary">{summary}</div> : null}
      </button>
      {expandable && open ? <div className="timeline-inline-detail-body">{details}</div> : null}
    </div>
  );
}

function normalizePlanStepStatus(status: string | undefined): string {
  const normalized = (status || '').replace(/[\s_-]/g, '').toLowerCase();
  if (normalized === 'completed' || normalized === 'done' || normalized === 'success') {
    return 'completed';
  }
  if (normalized === 'inprogress' || normalized === 'running' || normalized === 'active') {
    return 'inProgress';
  }
  return 'pending';
}

function formatPlanStepStatus(status: string | undefined): string {
  const normalized = normalizePlanStepStatus(status);
  if (normalized === 'completed') {
    return '已完成';
  }
  if (normalized === 'inProgress') {
    return '进行中';
  }
  return '待处理';
}

function buildTaskSteps(entry: TimelineEntry): TaskStep[] {
  const details = entry.details && typeof entry.details === 'object'
    ? entry.details as Record<string, unknown>
    : null;
  const plan = Array.isArray(details?.plan) ? details.plan : [];
  const structuredSteps = plan
    .map((step, index) => {
      const record = step && typeof step === 'object' ? step as Record<string, unknown> : null;
      const text = typeof record?.step === 'string' ? record.step.trim() : '';
      if (!text) {
        return null;
      }
      return {
        id: `${entry.id}:step:${index}`,
        status: typeof record?.status === 'string' ? record.status : '',
        text,
      };
    })
    .filter((step): step is TaskStep => Boolean(step));
  if (structuredSteps.length) {
    return structuredSteps;
  }

  return (entry.meta || [])
    .map((line, index) => {
      const text = String(line || '').trim();
      if (!text) {
        return null;
      }
      const separatorIndex = text.indexOf(':');
      if (separatorIndex > 0) {
        return {
          id: `${entry.id}:meta:${index}`,
          status: text.slice(0, separatorIndex).trim(),
          text: text.slice(separatorIndex + 1).trim(),
        };
      }
      return {
        id: `${entry.id}:meta:${index}`,
        status: entry.status || '',
        text,
      };
    })
    .filter((step): step is TaskStep => Boolean(step?.text));
}

function buildTaskPanelModel(entries: TimelineEntry[]) {
  const taskEntries = entries
    .filter((entry) => entry.type === 'plan' || entry.type === 'turn_plan')
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
  if (!taskEntries.length) {
    return null;
  }

  const latest = taskEntries[taskEntries.length - 1];
  const latestStructured = [...taskEntries].reverse().find((entry) => buildTaskSteps(entry).length > 0) || latest;
  const steps = buildTaskSteps(latestStructured);
  const draftEntry = [...taskEntries].reverse().find((entry) => entry.type === 'plan' && (entry.partial || entry.status === 'running'));

  return {
    summary: latestStructured.text || latest.text || '任务列表',
    steps,
    draftText: draftEntry?.text || '',
    running: Boolean(draftEntry) || steps.some((step) => normalizePlanStepStatus(step.status) === 'inProgress'),
    updatedAt: latest.createdAt || 0,
  };
}

function buildTimelineKind(entry: TimelineEntry): string {
  if (entry.type === 'reasoning' || entry.type === 'plan' || entry.type === 'turn_plan') {
    return 'thinking';
  }
  if (entry.type === 'command' || entry.type === 'mcp_tool' || entry.type === 'dynamic_tool' || entry.type === 'web_search') {
    return 'command';
  }
  if (entry.type === 'file_change' || entry.type === 'turn_diff') {
    return 'fileChange';
  }
  if (entry.status === 'error') {
    return '_error';
  }
  if (entry.status === 'warning') {
    return '_warning';
  }
  return entry.type || 'generic';
}

function formatExecutionStatus(status: string | undefined): string {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'success' || normalized === 'succeeded') {
    return '已完成';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return '失败';
  }
  if (normalized === 'declined' || normalized === 'cancelled' || normalized === 'aborted') {
    return '已中断';
  }
  if (normalized === 'pendingapproval' || normalized === 'pending_approval') {
    return '待批准';
  }
  return '进行中';
}

function buildStatusTone(status: string | undefined): string {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'success' || normalized === 'succeeded') {
    return 'success';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'error';
  }
  if (normalized === 'declined' || normalized === 'cancelled' || normalized === 'aborted') {
    return 'warning';
  }
  if (normalized === 'pendingapproval' || normalized === 'pending_approval') {
    return 'warning';
  }
  return 'running';
}

function buildTimelineStateClass(entry: TimelineEntry): string {
  if (entry.partial || entry.status === 'running') {
    return 'state-running';
  }
  const tone = buildStatusTone(entry.status);
  if (tone === 'success') {
    return 'state-success';
  }
  if (tone === 'warning') {
    return 'state-warning';
  }
  if (tone === 'error') {
    return 'state-error';
  }
  return 'state-idle';
}

function getCommandDetails(entry: TimelineEntry): { command: string; cwd: string; output: string } {
  const details = entry.details && typeof entry.details === 'object'
    ? entry.details as Record<string, unknown>
    : {};
  const command = typeof details.command === 'string'
    ? details.command
    : typeof details.input === 'string'
      ? details.input
      : entry.text || '';
  const cwd = typeof details.cwd === 'string' ? details.cwd : '';
  const output = typeof details.output === 'string'
    ? details.output
    : typeof details.aggregatedOutput === 'string'
      ? details.aggregatedOutput
      : '';
  return { command, cwd, output };
}

function classifyDiffLine(line: string): string {
  if (line.startsWith('+++ ') || line.startsWith('--- ')) {
    return 'file';
  }
  if (line.startsWith('*** Add File:') || line.startsWith('*** Delete File:') || line.startsWith('*** Update File:')) {
    return 'file';
  }
  if (line.startsWith('diff --git ')) {
    return 'file';
  }
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  if (line.startsWith('+')) {
    return 'add';
  }
  if (line.startsWith('-')) {
    return 'delete';
  }
  return 'context';
}

function renderDiffBlock(text: string) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  return (
    <div className="timeline-inline-diff">
      {lines.map((line, index) => (
        <div key={`diff-${index}`} className={`timeline-diff-line kind-${classifyDiffLine(line)}`}>
          {line || ' '}
        </div>
      ))}
    </div>
  );
}

function parsePatchChangeSummary(patch: string | undefined): Array<{
  path: string;
  kind: string;
  addedLines: number;
  deletedLines: number;
}> {
  const lines = String(patch || '').replace(/\r\n/g, '\n').split('\n');
  const changes: Array<{ path: string; kind: string; addedLines: number; deletedLines: number }> = [];
  let current: { path: string; kind: string; addedLines: number; deletedLines: number } | null = null;

  const flush = () => {
    if (!current?.path) {
      return;
    }
    changes.push(current);
  };

  for (const line of lines) {
    const addMatch = line.match(/^\*\*\* Add File:\s+(.+)$/);
    const deleteMatch = line.match(/^\*\*\* Delete File:\s+(.+)$/);
    const updateMatch = line.match(/^\*\*\* Update File:\s+(.+)$/);
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const plusPlusMatch = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    const minusMinusMatch = line.match(/^---\s+(?:a\/)?(.+)$/);

    if (addMatch || deleteMatch || updateMatch || gitMatch) {
      flush();
      current = {
        path: (addMatch?.[1] || deleteMatch?.[1] || updateMatch?.[1] || gitMatch?.[2] || plusPlusMatch?.[1] || minusMinusMatch?.[1] || '').trim(),
        kind: addMatch ? 'add' : deleteMatch ? 'delete' : 'update',
        addedLines: 0,
        deletedLines: 0,
      };
      continue;
    }

    if ((plusPlusMatch || minusMinusMatch) && !current) {
      current = {
        path: (plusPlusMatch?.[1] || minusMinusMatch?.[1] || '').trim(),
        kind: 'update',
        addedLines: 0,
        deletedLines: 0,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.addedLines += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletedLines += 1;
    }
  }

  flush();
  return changes;
}

function basenameLike(path: string | undefined): string {
  const value = typeof path === 'string' ? path.trim() : '';
  if (!value) {
    return '未命名文件';
  }
  const normalized = value.replace(/[\\/]+$/, '');
  if (!normalized) {
    return value;
  }
  const segments = normalized.split(/[/\\]+/).filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function buildRenderableChangesFromSource(source: {
  changes?: Array<{ path?: string; kind?: string; addedLines?: number; deletedLines?: number }>;
  patch?: string;
}): RenderableFileChange[] {
  const explicit = Array.isArray(source.changes) ? source.changes : [];
  const derived = parsePatchChangeSummary(source.patch);
  if (!explicit.length) {
    return derived;
  }
  if (!derived.length) {
    return explicit;
  }

  const derivedByPath = new Map(derived.map((change) => [change.path, change]));
  const merged = explicit.map((change) => {
    const fallback = change.path ? derivedByPath.get(change.path) : null;
    return {
      ...change,
      kind: change.kind || fallback?.kind,
      addedLines: typeof change.addedLines === 'number' ? change.addedLines : fallback?.addedLines,
      deletedLines: typeof change.deletedLines === 'number' ? change.deletedLines : fallback?.deletedLines,
    };
  });

  for (const change of derived) {
    if (!merged.some((item) => item.path === change.path)) {
      merged.push(change);
    }
  }

  return merged;
}

function buildRenderableChanges(entry: TimelineEntry): RenderableFileChange[] {
  return buildRenderableChangesFromSource(entry);
}

function formatFileChangePrefix(kind: string | undefined): string {
  const normalized = (kind || '').trim().toLowerCase();
  if (normalized === 'add') {
    return '+ 新增';
  }
  if (normalized === 'delete') {
    return '- 删除';
  }
  return '~ 修改';
}

function buildProcessHeadline(entry: TimelineEntry): string {
  const label = formatTimelineLabel(entry);
  if (entry.partial) {
    return `${label} · ${formatExecutionStatus('running')}`;
  }
  if (entry.status && !['completed', 'success', 'succeeded'].includes(entry.status)) {
    return `${label} · ${formatExecutionStatus(entry.status)}`;
  }
  return label;
}

function buildProcessPreview(entry: TimelineEntry): string {
  if (entry.type === 'command') {
    const details = getCommandDetails(entry);
    return (details.command || entry.text || '执行命令').replace(/\s+/g, ' ').trim();
  }

  if (entry.type === 'file_change' || entry.type === 'turn_diff') {
    const changes = buildRenderableChanges(entry);
    if (changes.length) {
      const preview = changes
        .slice(0, 2)
        .map((change) => {
          const statsText = typeof change.addedLines === 'number' || typeof change.deletedLines === 'number'
            ? ` (+${Math.max(0, Number(change.addedLines) || 0)} / -${Math.max(0, Number(change.deletedLines) || 0)})`
            : '';
          return `${formatFileChangePrefix(change.kind)} ${basenameLike(change.path)}${statsText}`.trim();
        })
        .join(' · ');
      return changes.length > 2 ? `${preview} 等 ${changes.length} 项` : preview;
    }
  }

  return summarizeTimelineEntry(entry).replace(/\s+/g, ' ').trim();
}

function renderFileChangeStats(change: { addedLines?: number; deletedLines?: number }) {
  const addedLines = Math.max(0, Number(change.addedLines) || 0);
  const deletedLines = Math.max(0, Number(change.deletedLines) || 0);
  if (!addedLines && !deletedLines) {
    return null;
  }
  return (
    <span className="file-change-line-stats">
      <span className="file-change-line-stats-add">+{addedLines}</span>
      <span className="file-change-line-stats-delete">-{deletedLines}</span>
    </span>
  );
}

function renderFileChangeList(changes: RenderableFileChange[], keyPrefix: string) {
  if (!changes.length) {
    return null;
  }

  return (
    <div className="file-change-list">
      {changes.map((change, index) => (
        <div key={`${keyPrefix}-change-${index}`} className={`file-change-entry kind-${(change.kind || 'update').toLowerCase()}`}>
          <span className="file-change-entry-path" title={change.path || '未命名文件'}>{`${formatFileChangePrefix(change.kind)} ${change.path || '未命名文件'}`}</span>
          {renderFileChangeStats(change)}
        </div>
      ))}
    </div>
  );
}

function buildTurnActivityStatus(
  entries: TimelineEntry[],
  turnState: { active?: boolean; turnId?: string } | undefined,
  approvals: ServerRequestItem[],
): FooterStatus | null {
  function withDetail(prefix: string, detail: string): string {
    const compact = detail.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return prefix;
    }
    return `${prefix} · ${compact.slice(0, 42)}`;
  }

  const turnId = turnState?.turnId;
  if (!turnId) {
    return null;
  }

  const pendingApproval = approvals.find((item) => item.turnId === turnId && item.status !== 'submitting');
  if (pendingApproval) {
    return { tone: 'warning', label: '等待批准', active: false };
  }

  const runningEntries = [...entries]
    .filter((entry) => entry.turnId === turnId && (entry.partial || entry.status === 'running'))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  const reasoningEntry = runningEntries.find((entry) => entry.type === 'reasoning');
  if (reasoningEntry) {
    return { tone: 'thinking', label: withDetail('思考中', summarizeTimelineEntry(reasoningEntry)), active: true };
  }

  const commandEntry = runningEntries.find((entry) => entry.type === 'command');
  if (commandEntry) {
    return { tone: 'command', label: withDetail('执行命令中', buildProcessPreview(commandEntry)), active: true };
  }

  const fileChangeEntry = runningEntries.find((entry) => entry.type === 'file_change');
  if (fileChangeEntry) {
    return { tone: 'file', label: withDetail('修改文件中', buildProcessPreview(fileChangeEntry)), active: true };
  }

  const toolEntry = runningEntries.find((entry) => (
    entry.type === 'mcp_tool' || entry.type === 'dynamic_tool' || entry.type === 'web_search'
  ));
  if (toolEntry) {
    return { tone: 'command', label: withDetail('工具处理中', buildProcessPreview(toolEntry)), active: true };
  }

  const planEntry = runningEntries.find((entry) => entry.type === 'plan' || entry.type === 'turn_plan');
  if (planEntry) {
    return { tone: 'thinking', label: withDetail('规划中', summarizeTimelineEntry(planEntry)), active: true };
  }

  if (turnState?.active) {
    return { tone: 'thinking', label: '等待响应中', active: true };
  }

  return null;
}

function buildLatestGroupStatus(
  groups: Array<{ status: string; label: string }>,
): FooterStatus | null {
  const latest = groups[groups.length - 1];
  if (!latest) {
    return null;
  }
  if (latest.status === 'pending') {
    return { tone: 'warning', label: `等待处理 · ${latest.label}`, active: false };
  }
  if (latest.status === 'running') {
    return { tone: 'command', label: `处理中 · ${latest.label}`, active: true };
  }
  return { tone: 'success', label: `已完成 · ${latest.label}`, active: false };
}

function buildRenderableTimeline(
  entries: TimelineEntry[],
  approvals: ServerRequestItem[],
): TimelineRenderable[] {
  return [
    ...entries.map((entry) => ({
      kind: 'entry' as const,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
      id: `entry:${entry.id}`,
      entry,
    })),
    ...approvals.map((request) => ({
      kind: 'approval' as const,
      createdAt: typeof request.createdAt === 'number' ? request.createdAt : 0,
      id: `approval:${request.requestId}`,
      request,
    })),
  ].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.id.localeCompare(right.id);
  });
}

function buildTimelineMarkerSymbol(entry: TimelineEntry): string {
  const stateClass = buildTimelineStateClass(entry);
  if (stateClass === 'state-success') {
    return '✓';
  }
  if (stateClass === 'state-error') {
    return '×';
  }
  if (stateClass === 'state-warning') {
    return '!';
  }
  if (stateClass === 'state-running') {
    return '…';
  }
  if (entry.type === 'command' || entry.type === 'mcp_tool' || entry.type === 'dynamic_tool' || entry.type === 'web_search') {
    return '›';
  }
  if (entry.type === 'file_change' || entry.type === 'turn_diff') {
    return '+';
  }
  if (entry.type === 'reasoning' || entry.type === 'plan' || entry.type === 'turn_plan') {
    return '~';
  }
  return '·';
}

function TimelineEntryCard({ entry }: { entry: TimelineEntry }) {
  if (entry.role === 'user' || entry.role === 'assistant') {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const bubbleClass = role === 'user'
      ? 'msg-bubble msg-bubble-user'
      : entry.type === 'reasoning'
        ? 'msg-bubble msg-bubble-commentary'
        : 'msg-bubble msg-bubble-assistant';
    const renderableChanges = buildRenderableChanges(entry);
    return (
      <div className={`transcript-row transcript-row-${role}`}>
        <div className="transcript-row-body">
          <article className={`message ${role} ${bubbleClass}`}>
            {entry.role === 'assistant' && entry.type === 'reasoning' ? (
              <div className="item-phase">思考</div>
            ) : null}
            <div className="message-body">
              <div className={entry.role === 'user' ? 'user-message-text' : 'timeline-entry-text'}>
                {summarizeTimelineEntry(entry)}
                {entry.partial ? <span className="cursor">▌</span> : null}
              </div>
              {entry.meta?.length ? (
                <div className="timeline-entry-meta">
                  {entry.meta.map((line, index) => <span key={`${entry.id}-meta-${index}`}>{line}</span>)}
                </div>
              ) : null}
              {entry.patch ? <pre className="cmd-output">{entry.patch}</pre> : null}
              {renderableChanges.length ? (
                <div className="tool-calls-banner">
                  {renderableChanges.map((change, index) => (
                    <span key={`${entry.id}-change-${index}`} className="tool-chip">
                      {[change.kind, change.path].filter(Boolean).join(': ')}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        </div>
      </div>
    );
  }

  if (entry.role !== 'user' && entry.role !== 'assistant') {
    const kind = buildTimelineKind(entry);
    const renderableChanges = buildRenderableChanges(entry);
    if (entry.type === 'command') {
      const details = getCommandDetails(entry);
      return (
        <div className={`timeline-event kind-${kind} ${buildTimelineStateClass(entry)}`}>
          <div className="timeline-marker"><span className="timeline-marker-state" aria-hidden="true">{buildTimelineMarkerSymbol(entry)}</span></div>
          <div className="timeline-content">
            <ExpandableTimelineRow
              className={`timeline-card-${kind}`}
              title={buildProcessHeadline(entry)}
              summary={buildProcessPreview(entry)}
              details={
                <>
                  <div className="timeline-inline-meta">
                    {describeTimelineType(entry)}
                    {entry.status && !['completed', 'success', 'succeeded'].includes(entry.status)
                      ? ` · ${formatExecutionStatus(entry.status)}`
                      : ''}
                  </div>
                  <pre className="timeline-inline-pre timeline-inline-pre-shell">{details.command || entry.text || '执行命令'}</pre>
                  {details.cwd ? <div className="timeline-inline-meta timeline-inline-meta-code">cwd: {details.cwd}</div> : null}
                  {details.output ? <pre className="timeline-inline-pre timeline-inline-pre-output">{details.output}</pre> : null}
                </>
              }
            />
          </div>
        </div>
      );
    }
    if (entry.type === 'file_change' || entry.type === 'turn_diff') {
      return (
        <div className={`timeline-event kind-${kind} ${buildTimelineStateClass(entry)}`}>
          <div className="timeline-marker"><span className="timeline-marker-state" aria-hidden="true">{buildTimelineMarkerSymbol(entry)}</span></div>
          <div className="timeline-content">
            <ExpandableFileChangeRow
              className={`timeline-card-${kind}`}
              title={buildProcessHeadline(entry)}
              summary={buildProcessPreview(entry) || describeTimelineType(entry)}
              details={(
                <>
                  <div className="timeline-inline-meta">
                    {describeTimelineType(entry)}
                    {entry.status && !['completed', 'success', 'succeeded'].includes(entry.status)
                      ? ` · ${formatExecutionStatus(entry.status)}`
                      : ''}
                  </div>
                  {renderFileChangeList(renderableChanges, entry.id)}
                  {entry.meta?.length ? (
                    <div className="timeline-inline-meta timeline-inline-meta-code">
                      {entry.meta.join('\n')}
                    </div>
                  ) : null}
                  {entry.patch ? renderDiffBlock(entry.patch) : null}
                </>
              )}
            />
          </div>
        </div>
      );
    }
    return (
      <div className={`timeline-event kind-${kind} ${buildTimelineStateClass(entry)}`}>
        <div className="timeline-marker"><span className="timeline-marker-state" aria-hidden="true">{buildTimelineMarkerSymbol(entry)}</span></div>
        <div className="timeline-content">
          <ExpandableTimelineRow
            className={`timeline-card-${kind}`}
            title={buildProcessHeadline(entry)}
            summary={buildProcessPreview(entry) || describeTimelineType(entry)}
            details={(entry.meta?.length || entry.patch || entry.changes?.length) ? (
              <>
                <div className="timeline-inline-meta">
                  {describeTimelineType(entry)}
                  {entry.status && !['completed', 'success', 'succeeded'].includes(entry.status)
                    ? ` · ${formatExecutionStatus(entry.status)}`
                    : ''}
                </div>
                {entry.meta?.length ? (
                  <div className="timeline-inline-meta timeline-inline-meta-code">
                    {entry.meta.join('\n')}
                  </div>
                ) : null}
                {renderFileChangeList(renderableChanges, entry.id)}
                {entry.patch ? renderDiffBlock(entry.patch) : null}
              </>
            ) : null}
          />
        </div>
      </div>
    );
  }
  return null;
}

function ApprovalCard({
  request,
  onRespond,
}: {
  request: ServerRequestItem;
  onRespond: (request: ServerRequestItem, response: unknown) => void;
}) {
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [dynamicToolValue, setDynamicToolValue] = useState('');
  const [dynamicToolSuccess, setDynamicToolSuccess] = useState(true);
  const [mcpValues, setMcpValues] = useState<Record<string, string>>({});
  const renderableChanges = buildRenderableChangesFromSource({
    changes: request.changes,
    patch: request.patch,
  });

  return (
    <div className="timeline-event kind-serverRequest">
      <div className="timeline-marker"><span className="timeline-marker-state" aria-hidden="true">!</span></div>
      <div className="timeline-content">
        <article className="approval-banner">
          <div className="item-label">{formatApprovalKind(request.kind)}</div>
          <div className="timeline-inline-title">{buildApprovalSummary(request)}</div>
          <div className="approval-meta">
            {[request.threadId || '全局', request.requestId, request.command || '', request.cwd || ''].filter(Boolean).join(' · ')}
          </div>
          {renderFileChangeList(renderableChanges, request.requestId)}
          {request.patch ? renderDiffBlock(request.patch) : null}

          {request.kind === 'user_input' && request.questions?.length ? (
            <div className="approval-form">
              {request.questions.map((question) => {
                const questionId = question.id || '';
                const options = Array.isArray(question.options) ? question.options : [];
                const currentValue = questionAnswers[questionId] || '';
                return (
                  <div key={questionId} className="approval-question">
                    <div className="approval-question-header">{question.header || question.question || questionId}</div>
                    {options.length ? (
                      <div className="approval-options approval-options-stacked">
                        {options.map((option) => {
                          const label = option.label || '';
                          return (
                            <label key={label} className="approval-option">
                              <input
                                type="radio"
                                name={`${request.requestId}:${questionId}`}
                                value={label}
                                checked={currentValue === label}
                                onChange={(event) => setQuestionAnswers((state) => ({ ...state, [questionId]: event.target.value }))}
                              />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                    {(question.isOther || question.isSecret || !options.length) ? (
                      question.isSecret ? (
                        <input
                          className="approval-text-input"
                          type="password"
                          value={currentValue}
                          onChange={(event) => setQuestionAnswers((state) => ({ ...state, [questionId]: event.target.value }))}
                        />
                      ) : (
                        <textarea
                          className="approval-text-input"
                          value={currentValue}
                          onChange={(event) => setQuestionAnswers((state) => ({ ...state, [questionId]: event.target.value }))}
                        />
                      )
                    ) : null}
                  </div>
                );
              })}
                <div className="approval-actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={request.status === 'submitting'}
                    onClick={() => onRespond(request, buildUserInputResponse(request, questionAnswers))}
                  >
                    提交回答
                </button>
              </div>
            </div>
          ) : null}

          {request.kind === 'dynamic_tool_call' ? (
            <div className="approval-form">
              <textarea
                className="approval-text-input"
                placeholder='填写 JSON 数组，例如 [{"type":"inputText","text":"ok"}]'
                value={dynamicToolValue}
                onChange={(event) => setDynamicToolValue(event.target.value)}
              />
              <label className="approval-option">
                <input type="checkbox" checked={dynamicToolSuccess} onChange={(event) => setDynamicToolSuccess(event.target.checked)} />
                <span>标记为成功</span>
              </label>
                <div className="approval-actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={request.status === 'submitting'}
                    onClick={() => {
                      let contentItems: unknown[] = [];
                      if (dynamicToolValue.trim()) {
                      try {
                        const parsed = JSON.parse(dynamicToolValue);
                        if (!Array.isArray(parsed)) {
                          throw new Error('contentItems 必须是数组');
                        }
                        contentItems = parsed;
                      } catch (error) {
                        onRespond(request, { error: error instanceof Error ? error.message : 'JSON 无效' });
                        return;
                      }
                    }
                    onRespond(request, { contentItems, success: dynamicToolSuccess });
                  }}
                >
                  提交结果
                </button>
              </div>
            </div>
          ) : null}

          {request.kind === 'mcp_server_elicitation' ? (
            <div className="approval-form">
              {request.mode === 'url' && request.url ? (
                <a className="approval-link" href={request.url} target="_blank" rel="noreferrer">{request.url}</a>
              ) : null}
              {request.mode !== 'url' && request.responseSchema && typeof request.responseSchema === 'object' ? (
                <div className="approval-question">
                  {Object.entries((((request.responseSchema as any)?.properties || {}) as Record<string, Record<string, unknown>>)).map(([fieldKey, fieldSpec]) => (
                    <label key={fieldKey} className="modal-label">
                      <span>{typeof fieldSpec?.title === 'string' ? fieldSpec.title : fieldKey}</span>
                      <input
                        className="approval-text-input"
                        value={mcpValues[fieldKey] || ''}
                        onChange={(event) => setMcpValues((state) => ({ ...state, [fieldKey]: event.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
                <div className="approval-actions">
                  {request.mode === 'url' ? (
                    <>
                      <button className="btn" type="button" disabled={request.status === 'submitting'} onClick={() => onRespond(request, { action: 'accept', content: null, _meta: request.meta })}>允许</button>
                      <button className="btn btn-secondary" type="button" disabled={request.status === 'submitting'} onClick={() => onRespond(request, { action: 'decline', content: null })}>拒绝</button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn"
                        type="button"
                        disabled={request.status === 'submitting'}
                        onClick={() => {
                          const properties = (((request.responseSchema as any)?.properties || {}) as Record<string, Record<string, unknown>>);
                          const content = Object.fromEntries(
                          Object.entries(properties).map(([fieldKey, fieldSpec]) => [fieldKey, normalizeSchemaFieldValue(mcpValues[fieldKey] || '', fieldSpec)]),
                        );
                        onRespond(request, { action: 'accept', content, _meta: request.meta });
                      }}
                        >
                        提交
                      </button>
                      <button className="btn btn-secondary" type="button" disabled={request.status === 'submitting'} onClick={() => onRespond(request, { action: 'decline', content: null })}>拒绝</button>
                    </>
                  )}
                </div>
            </div>
          ) : null}

          {request.kind !== 'user_input' && request.kind !== 'dynamic_tool_call' && request.kind !== 'mcp_server_elicitation' ? (
            <div className="approval-actions">
              {(request.availableDecisions?.length ? request.availableDecisions : ['accept', 'decline']).map((decision, index) => {
                const key = typeof decision === 'string' ? decision : JSON.stringify(decision);
                const response = buildApprovalDecisionResponse(decision);
                return (
                    <button
                      key={key}
                      className={index === 0 ? 'btn' : 'btn btn-secondary'}
                      type="button"
                      disabled={request.status === 'submitting'}
                      onClick={() => onRespond(request, response)}
                    >
                      {getDecisionLabel(decision)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}

export function TimelineWorkspace({ onRespondApproval }: TimelineWorkspaceProps) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastSignatureRef = useRef('');
  const lastSessionIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(true);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const entriesBySessionId = useAppStore((state) => state.timeline.entriesBySessionId);
  const health = useAppStore((state) => state.health.data);
  const error = useAppStore((state) => state.health.error || state.connection.error || '');
  const turnState = useAppStore((state) => activeSessionId ? state.turns.activeBySessionId[activeSessionId] : undefined);
  const approvalItems = useAppStore((state) => state.approvals.items);

  const entries = useMemo(
    () => activeSessionId ? (entriesBySessionId[activeSessionId] || []) : [],
    [activeSessionId, entriesBySessionId],
  );
  const visibleEntries = useMemo(
    () => entries.filter((entry) => entry.type !== 'reasoning'),
    [entries],
  );
  const approvals = useMemo(
    () => activeSessionId ? approvalItems.filter((item) => item.threadId === activeSessionId) : approvalItems,
    [activeSessionId, approvalItems],
  );
  const activeTurnStatus = useMemo(
    () => buildTurnActivityStatus(entries, turnState, approvals),
    [entries, turnState, approvals],
  );
  const taskPanel = useMemo(
    () => buildTaskPanelModel(entries),
    [entries],
  );

  const groups = useMemo(
    () => buildTimelineGroups(visibleEntries.filter((entry) => entry.type !== 'plan' && entry.type !== 'turn_plan'), approvals, turnState),
    [approvals, visibleEntries, turnState],
  );
  const renderables = useMemo(
    () => buildRenderableTimeline(visibleEntries.filter((entry) => entry.type !== 'plan' && entry.type !== 'turn_plan'), approvals),
    [approvals, visibleEntries],
  );

  const contentSignature = useMemo(
    () => JSON.stringify(renderables.map((item) => (
      item.kind === 'entry'
        ? {
          kind: item.kind,
          id: item.entry.id,
          text: item.entry.text,
          status: item.entry.status,
          partial: item.entry.partial,
          createdAt: item.entry.createdAt,
        }
        : {
          kind: item.kind,
          id: item.request.requestId,
          status: item.request.status,
          createdAt: item.request.createdAt,
        }
    ))),
    [renderables],
  );

  const footerStatus = useMemo(
    () => activeTurnStatus || buildLatestGroupStatus(groups),
    [activeTurnStatus, groups],
  );

  useEffect(() => {
    const body = messagesRef.current;
    if (!body) {
      return;
    }
    if (lastSessionIdRef.current !== activeSessionId) {
      lastSessionIdRef.current = activeSessionId;
      lastSignatureRef.current = '';
      window.requestAnimationFrame(() => {
        const currentBody = messagesRef.current;
        if (!currentBody) {
          return;
        }
        stickToBottomRef.current = true;
        currentBody.scrollTop = currentBody.scrollHeight;
        setShowJumpToBottom(false);
        setHasUnreadBelow(false);
      });
      return;
    }
    const previousSignature = lastSignatureRef.current;
    const hasContentChanged = previousSignature !== contentSignature;
    if (!previousSignature || (stickToBottomRef.current && hasContentChanged)) {
      body.scrollTop = body.scrollHeight;
      setShowJumpToBottom(false);
      setHasUnreadBelow(false);
    } else if (hasContentChanged) {
      setShowJumpToBottom(true);
      setHasUnreadBelow(true);
    }
    lastSignatureRef.current = contentSignature;
  }, [activeSessionId, contentSignature]);

  useEffect(() => {
    const body = messagesRef.current;
    if (!body || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) {
        return;
      }
      body.scrollTop = body.scrollHeight;
      setShowJumpToBottom(false);
      setHasUnreadBelow(false);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="timeline-shell">
      <div id="messages" ref={messagesRef} className="messages" onScroll={() => {
        const body = messagesRef.current;
        if (!body) {
          return;
        }
        const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 96;
        stickToBottomRef.current = nearBottom;
        setShowJumpToBottom(!nearBottom);
        if (nearBottom) {
          setHasUnreadBelow(false);
        }
      }}>
        {activeSessionId ? (
          <div className="timeline-toolbar">
            <div className={`status-chip${turnState?.active ? ' running' : ''}`}>
              {turnState?.active ? '运行中' : '空闲'}
            </div>
          </div>
        ) : null}

        {error ? <div className="status error">{error}</div> : null}
        {!error && !health ? <div className="status">正在加载服务状态…</div> : null}

        {activeSessionId && renderables.length ? renderables.map((item) => (
          item.kind === 'entry'
            ? <TimelineEntryCard key={item.id} entry={item.entry} />
            : <ApprovalCard key={item.id} request={item.request} onRespond={onRespondApproval} />
        )) : null}

        {activeSessionId && !renderables.length ? (
          <div className="empty-state">
            <strong>还没有时间线记录</strong>
            <span>发送第一条消息后，这个会话的过程会显示在这里。</span>
          </div>
        ) : null}

        {!activeSessionId && health ? (
          <div className="health-grid">
            <div className="health-card">
              <span className="label">状态</span>
              <strong>{formatHealthStatus(health.status)}</strong>
            </div>
            <div className="health-card">
              <span className="label">会话数</span>
              <strong>{health.tabs}</strong>
            </div>
            <div className="health-card">
              <span className="label">连接数</span>
              <strong>{health.websocketClients}</strong>
            </div>
            <div className="health-card">
              <span className="label">运行时长</span>
              <strong>{health.uptimeSec} 秒</strong>
            </div>
          </div>
        ) : null}
      </div>

      <button
        id="jumpToBottomBtn"
        className="jump-to-bottom-btn"
        type="button"
        hidden={!showJumpToBottom}
        onClick={() => {
          const body = messagesRef.current;
          if (!body) {
            return;
          }
          body.scrollTop = body.scrollHeight;
          setShowJumpToBottom(false);
          setHasUnreadBelow(false);
        }}
        >
        {hasUnreadBelow ? '新消息 ︾' : '回到底部'}
      </button>

      {(taskPanel || footerStatus) ? (
        <div className="timeline-status-dock">
          {footerStatus ? (
            <div className={`thinking-indicator tone-${footerStatus.tone}`} aria-live="polite">
              <span className={`thinking-indicator-dot${footerStatus.active ? ' is-running' : ''}`}></span>
              <span className="thinking-indicator-text">{footerStatus.label}</span>
            </div>
          ) : null}
          {taskPanel ? (
            <div className={`task-panel${taskPanelOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="task-panel-toggle"
                onClick={() => setTaskPanelOpen((value) => !value)}
              >
                <span className={`task-panel-dot${taskPanel.running ? ' is-running' : ''}`} aria-hidden="true"></span>
                <span className="task-panel-toggle-text">任务列表</span>
                {taskPanel.steps.length ? <span className="task-panel-toggle-count">{taskPanel.steps.length}</span> : null}
              </button>
              {taskPanelOpen ? (
                <div className="task-panel-body">
                  {taskPanel.summary ? <div className="task-panel-summary">{taskPanel.summary}</div> : null}
                  {taskPanel.steps.length ? (
                    <div className="task-step-list">
                      {taskPanel.steps.map((step) => {
                        const normalizedStatus = normalizePlanStepStatus(step.status);
                        return (
                          <div key={step.id} className={`task-step status-${normalizedStatus}`}>
                            <span className="task-step-badge">{formatPlanStepStatus(step.status)}</span>
                            <span className="task-step-text">{step.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {taskPanel.draftText ? (
                    <div className="task-panel-draft">
                      <span className="task-panel-draft-label">规划中</span>
                      <span className="task-panel-draft-text">{taskPanel.draftText}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
