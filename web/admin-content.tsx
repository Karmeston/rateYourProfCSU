import { useRef, useState } from 'react';
import {
  actionLabels,
  statusLabels,
  type AdminItem,
  type AdminQueue,
  type ModerationKind,
} from '../shared/admin';
import { reportReasons, supplementKinds } from '../shared/community';
import { useData } from './use-data';
import { AdminFailure, AdminRequestError, adminRequest } from './admin-api';
import { ContextLine } from './community-forms';

export function AdminContent({ kind, relogin }: { kind: ModerationKind; relogin: () => void }) {
  const [status, setStatus] = useState(kind === 'report' ? 'open' : 'pending'),
    [offset, setOffset] = useState(0),
    [input, setInput] = useState(''),
    [q, setQ] = useState('');
  const query = new URLSearchParams({ kind, status, offset: String(offset), q });
  const result = useData<AdminQueue>(`/api/admin/content?${query}`);
  const statuses =
    kind === 'report' ? ['open', 'resolved', 'dismissed'] : ['pending', 'published', 'rejected'];
  return (
    <section>
      <div className="admin-toolbar">
        <label>
          状态{' '}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
          >
            {['all', ...statuses].map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? '全部状态' : statusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setQ(input.trim());
            setOffset(0);
          }}
        >
          <input
            aria-label="搜索管理内容"
            value={input}
            maxLength={100}
            onChange={(event) => setInput(event.target.value)}
            placeholder="课程名或内容"
          />
          <button>搜索</button>
        </form>
        <button onClick={result.retry}>刷新</button>
      </div>
      {result.error ? (
        <AdminFailure
          error={result.error}
          status={result.status}
          retry={result.retry}
          relogin={relogin}
        />
      ) : !result.data ? (
        <p role="status">正在加载内容…</p>
      ) : (
        <>
          <p className="fine-print">共 {result.data.total} 条记录</p>
          {!result.data.items.length && <p>暂无符合条件的记录。</p>}
          <ul className="admin-items">
            {result.data.items.map((item) => (
              <AdminContentItem
                key={`${item.id}:${item.revision}`}
                item={item}
                changed={result.retry}
                relogin={relogin}
              />
            ))}
          </ul>
          <nav className="pagination" aria-label="管理内容分页">
            <button disabled={!offset} onClick={() => setOffset(offset - 20)}>
              上一页
            </button>
            <span>第 {offset / 20 + 1} 页</span>
            <button disabled={!result.data.hasMore} onClick={() => setOffset(offset + 20)}>
              下一页
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
function AdminContentItem({
  item,
  changed,
  relogin,
}: {
  item: AdminItem;
  changed: () => void;
  relogin: () => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [action, setAction] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState<number>();
  const request = useRef(crypto.randomUUID()),
    lock = useRef(false);
  function edited() {
    request.current = crypto.randomUUID();
    setError('');
    setStatus(undefined);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !action || !reason.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await adminRequest('moderate', {
        kind: item.kind,
        id: item.id,
        action,
        revision: item.revision,
        reason,
        requestId: request.current,
      });
      changed();
    } catch (cause) {
      setStatus(cause instanceof AdminRequestError ? cause.status : undefined);
      setError(
        cause instanceof AdminRequestError
          ? cause.message
          : '处理结果未确认，请原样重试或刷新核对。',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <li>
      <div className="admin-item-heading">
        <strong>
          {item.kind === 'report'
            ? (reportReasons[item.reason as keyof typeof reportReasons] ?? '举报')
            : (item.name ?? '内容记录')}
        </strong>
        <span>
          {item.withdrawn_at ? '作者已撤回' : (statusLabels[item.status] ?? item.status)} · 版本{' '}
          {item.revision}
        </span>
      </div>
      <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('zh-CN')}</time>
      <ContextLine {...item} />
      {item.supplementKind && <p>{supplementKinds[item.supplementKind]}</p>}
      {item.rating !== undefined && <p>评分：{item.rating} / 5</p>}
      <p className="review-body">{item.body || '未补充说明'}</p>
      {item.sourceUrl && (
        <p>
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
            提供的来源 ↗
          </a>
        </p>
      )}
      {item.resourceKind && item.resourceId && (
        <a href={`#/${item.resourceKind}/${item.resourceId}`}>查看公开页面</a>
      )}
      {item.kind === 'report' && item.target_kind && item.target_id && (
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>查看被举报内容</summary>
          {expanded && (
            <ReportTarget kind={item.target_kind} id={item.target_id} relogin={relogin} />
          )}
        </details>
      )}
      <form
        className="admin-action-form"
        aria-label={item.kind === 'report' ? '处理举报' : '处理原内容'}
        onSubmit={(event) => void submit(event)}
      >
        <label>
          处理方式{' '}
          <select
            required
            disabled={busy}
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              edited();
            }}
          >
            <option value="">请选择</option>
            {item.actions.map((value) => (
              <option key={value} value={value}>
                {actionLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          处理理由{' '}
          <textarea
            required
            rows={2}
            disabled={busy}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              edited();
            }}
            placeholder="简要说明核对依据或处理原因"
          />
        </label>
        <button className="primary-button" disabled={busy || !action || !reason.trim()}>
          {busy ? '正在处理…' : '确认处理'}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button onClick={status === 401 ? relogin : changed}>
            {status === 401 ? '重新登录' : '刷新核对'}
          </button>
        </p>
      )}
    </li>
  );
}
function ReportTarget({
  kind,
  id,
  relogin,
}: {
  kind: ModerationKind;
  id: string;
  relogin: () => void;
}) {
  const { data, error, status, retry } = useData<{ item: AdminItem }>(
    `/api/admin/content/${kind}/${id}`,
  );
  return error ? (
    <AdminFailure {...{ error, status, retry, relogin }} />
  ) : !data ? (
    <p role="status">正在读取原内容…</p>
  ) : (
    <div>
      <p className="fine-print">可在此核对并处理原内容，再选择举报处理结果。</p>
      <ul className="admin-items">
        <AdminContentItem
          key={`${data.item.id}:${data.item.revision}`}
          item={data.item}
          changed={retry}
          relogin={relogin}
        />
      </ul>
    </div>
  );
}
