import { useMemo, useState } from 'react';
import {
  buildApprovalDecisionResponse,
  buildApprovalSummary,
  buildUserInputResponse,
  formatApprovalMethodLabel,
  getDecisionLabel,
  getMcpSchemaProperties,
  isDynamicToolApproval,
  isMcpElicitationApproval,
  isUserInputApproval,
  normalizeSchemaFieldValue,
} from '../../app/view-helpers.js';
import { useAppStore, type ServerRequestItem } from '../../store/appStore.js';

type InspectorPanelProps = {
  onRespond: (request: ServerRequestItem, response: unknown) => void;
};

export function InspectorPanel({ onRespond }: InspectorPanelProps) {
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const approvals = useAppStore((state) => state.approvals.items);

  const visibleApprovals = useMemo(
    () => activeSessionId
      ? approvals.filter((item) => item.threadId === activeSessionId)
      : approvals,
    [activeSessionId, approvals],
  );
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [dynamicToolValues, setDynamicToolValues] = useState<Record<string, string>>({});
  const [dynamicToolSuccess, setDynamicToolSuccess] = useState<Record<string, boolean>>({});
  const [mcpFormValues, setMcpFormValues] = useState<Record<string, string>>({});

  return (
    <aside className="panel inspector-panel">
      <div className="panel-title">审批面板</div>
      <div className="panel-body inspector-body">
        <div className="inspector-summary">
          <div className="status-chip">{activeSessionId ? '当前会话' : '全部会话'}</div>
          <div className={`badge${visibleApprovals.length ? ' warning' : ''}`}>
            {visibleApprovals.length} 条待处理
          </div>
        </div>
        <div className="approval-section">
          <div className="section-head">
            <strong>待处理审批</strong>
            <span className="muted">{activeSessionId ? '当前会话' : '全部会话'}</span>
          </div>
          {visibleApprovals.length ? (
            <div className="approval-list">
              {visibleApprovals.map((request) => (
                <article key={request.requestId} className="approval-item">
                  <div className="approval-item-row">
                    <strong>{formatApprovalMethodLabel(request.method, request.kind)}</strong>
                    <span className={`badge${request.status === 'submitting' ? '' : ' warning'}`}>
                      {request.status === 'submitting' ? '提交中' : '待处理'}
                    </span>
                  </div>
                  <div className="approval-summary">{buildApprovalSummary(request)}</div>
                  <div className="approval-meta">
                    <span>{request.threadId || '全局'}</span>
                    <span>{request.requestId}</span>
                  </div>
                  {isUserInputApproval(request) && request.questions?.length ? (
                    <div className="approval-question-list">
                      {request.questions.map((question) => {
                        const questionId = question.id || '';
                        const options = Array.isArray(question.options) ? question.options : [];
                        const stateKey = `${request.requestId}:${questionId}`;
                        const fallbackOption = options.find((option) => !(question.isOther || question.isSecret))?.label || '';
                        const currentValue = questionAnswers[stateKey] || fallbackOption;
                        return (
                          <div key={stateKey} className="approval-question-card">
                            <strong>{question.header || question.question || questionId}</strong>
                            {question.question && question.header !== question.question ? <span className="muted">{question.question}</span> : null}
                            {options.length ? (
                              <div className="approval-option-list">
                                {options.map((option) => {
                                  const label = option.label || '';
                                  return (
                                    <label key={`${stateKey}:${label}`} className="approval-option-row">
                                      <input
                                        type="radio"
                                        name={stateKey}
                                        value={label}
                                        checked={currentValue === label}
                                        disabled={request.status === 'submitting'}
                                        onChange={(event) => setQuestionAnswers((state) => ({
                                          ...state,
                                          [stateKey]: event.target.value,
                                        }))}
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
                                  type="password"
                                  className="token-input"
                                  placeholder="填写回答"
                                  value={currentValue}
                                  disabled={request.status === 'submitting'}
                                  onChange={(event) => setQuestionAnswers((state) => ({
                                    ...state,
                                    [stateKey]: event.target.value,
                                  }))}
                                />
                              ) : (
                                <textarea
                                  className="composer-input approval-textarea"
                                  placeholder="填写回答"
                                  value={currentValue}
                                  disabled={request.status === 'submitting'}
                                  onChange={(event) => setQuestionAnswers((state) => ({
                                    ...state,
                                    [stateKey]: event.target.value,
                                  }))}
                                />
                              )
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {isDynamicToolApproval(request) ? (
                    <div className="approval-question-list">
                      <div className="approval-question-card">
                        <strong>{request.namespace ? `${request.namespace}.${request.tool || ''}` : request.tool || '动态工具'}</strong>
                        {request.arguments ? <pre className="timeline-entry-pre">{JSON.stringify(request.arguments, null, 2)}</pre> : null}
                        <textarea
                          className="composer-input approval-textarea"
                          placeholder='填写 JSON 数组，例如 [{"type":"inputText","text":"ok"}]'
                          value={dynamicToolValues[request.requestId] || ''}
                          disabled={request.status === 'submitting'}
                          onChange={(event) => setDynamicToolValues((state) => ({
                            ...state,
                            [request.requestId]: event.target.value,
                          }))}
                        />
                        <label className="approval-option-row">
                          <input
                            type="checkbox"
                            checked={dynamicToolSuccess[request.requestId] ?? true}
                            disabled={request.status === 'submitting'}
                            onChange={(event) => setDynamicToolSuccess((state) => ({
                              ...state,
                              [request.requestId]: event.target.checked,
                            }))}
                          />
                          <span>标记为成功</span>
                        </label>
                      </div>
                    </div>
                  ) : null}
                  {isMcpElicitationApproval(request) ? (
                    <div className="approval-question-list">
                      <div className="approval-question-card">
                        {request.serverName ? <strong>MCP: {request.serverName}</strong> : null}
                        {request.message ? <span className="muted">{request.message}</span> : null}
                        {request.mode === 'url' && request.url ? (
                          <a href={request.url} target="_blank" rel="noreferrer" className="workspace-path">
                            {request.url}
                          </a>
                        ) : null}
                        {request.mode !== 'url' && Object.keys(getMcpSchemaProperties(request)).length ? (
                          <div className="approval-question-list">
                            {Object.entries(getMcpSchemaProperties(request)).map(([fieldKey, fieldSpec]) => {
                              const stateKey = `${request.requestId}:${fieldKey}`;
                              const fieldTitle = typeof fieldSpec?.title === 'string' ? fieldSpec.title : fieldKey;
                              const fieldDescription = typeof fieldSpec?.description === 'string' ? fieldSpec.description : '';
                              return (
                                <label key={stateKey} className="approval-question-card">
                                  <strong>{fieldTitle}</strong>
                                  {fieldDescription ? <span className="muted">{fieldDescription}</span> : null}
                                  <input
                                    className="token-input"
                                    value={mcpFormValues[stateKey] || ''}
                                    disabled={request.status === 'submitting'}
                                    onChange={(event) => setMcpFormValues((state) => ({
                                      ...state,
                                      [stateKey]: event.target.value,
                                    }))}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="approval-actions">
                    {isUserInputApproval(request) && request.questions?.length ? (
                      <button
                        type="button"
                        className="primary-button small"
                        disabled={request.status === 'submitting'}
                        onClick={() => {
                          const stateForRequest = Object.fromEntries(
                            Object.entries(questionAnswers)
                              .filter(([key]) => key.startsWith(`${request.requestId}:`))
                              .map(([key, value]) => [key.slice(request.requestId.length + 1), value]),
                          );
                          onRespond(request, buildUserInputResponse(request, stateForRequest));
                        }}
                      >
                        提交回答
                      </button>
                    ) : null}
                    {isDynamicToolApproval(request) ? (
                      <button
                        type="button"
                        className="primary-button small"
                        disabled={request.status === 'submitting'}
                        onClick={() => {
                          let contentItems: unknown[] = [];
                          const raw = (dynamicToolValues[request.requestId] || '').trim();
                          if (raw) {
                            try {
                              const parsed = JSON.parse(raw);
                              if (!Array.isArray(parsed)) {
                                throw new Error('contentItems 必须是数组');
                              }
                              contentItems = parsed;
                            } catch (error) {
                              onRespond(request, { error: error instanceof Error ? error.message : 'JSON 无效' });
                              return;
                            }
                          }
                          onRespond(request, {
                            contentItems,
                            success: dynamicToolSuccess[request.requestId] ?? true,
                          });
                        }}
                      >
                        提交结果
                      </button>
                    ) : null}
                    {isMcpElicitationApproval(request) ? (
                      request.mode === 'url' ? (
                        <>
                          <button
                            type="button"
                            className="primary-button small"
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, { action: 'accept', content: null, _meta: request.meta })}
                          >
                            允许
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, { action: 'decline', content: null })}
                          >
                            拒绝
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, { action: 'cancel', content: null })}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="primary-button small"
                            disabled={request.status === 'submitting'}
                            onClick={() => {
                              const properties = getMcpSchemaProperties(request);
                              const content = Object.fromEntries(
                                Object.entries(properties).map(([fieldKey, fieldSpec]) => {
                                  const stateKey = `${request.requestId}:${fieldKey}`;
                                  return [fieldKey, normalizeSchemaFieldValue(mcpFormValues[stateKey] || '', fieldSpec)];
                                }),
                              );
                              onRespond(request, { action: 'accept', content, _meta: request.meta });
                            }}
                          >
                            提交
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, { action: 'decline', content: null })}
                          >
                            拒绝
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, { action: 'cancel', content: null })}
                          >
                            取消
                          </button>
                        </>
                      )
                    ) : null}
                    {!isUserInputApproval(request) && !isDynamicToolApproval(request) && !isMcpElicitationApproval(request) ? (request.availableDecisions?.length
                      ? request.availableDecisions
                      : ['accept', 'decline']).map((decision, index) => {
                        const key = typeof decision === 'string' ? decision : JSON.stringify(decision);
                        const isPrimary = index === 0;
                        const response = buildApprovalDecisionResponse(decision);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={isPrimary ? 'primary-button small' : 'secondary-button'}
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, response)}
                          >
                            {getDecisionLabel(decision)}
                          </button>
                        );
                    }) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>当前没有待处理审批</strong>
              <span>服务端发来的请求会显示在这里。</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
