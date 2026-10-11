import { useRef, useState } from 'react';
import { supplementKinds, type ReviewContext } from '../shared/community';
import { CommunityDialog, ContextFields, ContextLine, ReportButton } from './community-forms';
import { useData } from './use-data';
import { send } from './visitor';

type Supplement = ReviewContext & {
  id: string;
  kind: keyof typeof supplementKinds;
  body: string;
  sourceUrl: string | null;
  status?: string;
};
export function CourseSupplements({ id }: { id: string }) {
  const endpoint = `/api/courses/${id}/supplements`;
  const [offset, setOffset] = useState(0),
    [writing, setWriting] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const { data, error, retry } = useData<{
    supplements: Supplement[];
    mine: Supplement[];
    hasMore: boolean;
  }>(`${endpoint}?offset=${offset}`);
  return (
    <section className="course-supplements">
      <details>
        <summary>同学补充资料</summary>
        <p className="fine-print">
          课程考核、学习资料和纠错信息由同学提供，审核后展示；不替代官方培养方案或学分认定依据。
        </p>
        <button className="secondary-button" ref={button} onClick={() => setWriting(true)}>
          补充课程资料
        </button>
        {error && (
          <p role="alert">
            {error}
            <button onClick={retry}>重试</button>
          </p>
        )}
        {data && !data.supplements.length && <p className="fine-print">暂无已审核的补充资料。</p>}
        <ul className="supplement-list">
          {data?.supplements.map((row) => (
            <li key={row.id}>
              <strong>{supplementKinds[row.kind]} · 同学补充</strong>
              <ContextLine {...row} />
              <p className="review-body">{row.body}</p>
              {row.sourceUrl && (
                <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">
                  查看提供的来源 ↗
                </a>
              )}
              <ReportButton endpoint={`${endpoint}/${row.id}/reports`} />
            </li>
          ))}
        </ul>
        {data?.mine.map((row) => (
          <div className="own-supplement" key={row.id}>
            <span>{row.status === 'pending' ? '我的补充 · 待审核' : '我的补充 · 未通过审核'}</span>
            <p className="review-body">{row.body}</p>
          </div>
        ))}
        {(offset > 0 || data?.hasMore) && (
          <nav className="pagination" aria-label="补充资料分页">
            <button disabled={!offset} onClick={() => setOffset(offset - 20)}>
              上一页
            </button>
            <button disabled={!data?.hasMore} onClick={() => setOffset(offset + 20)}>
              下一页
            </button>
          </nav>
        )}
      </details>
      {writing && (
        <SupplementForm
          endpoint={endpoint}
          close={() => {
            setWriting(false);
            button.current?.focus();
          }}
          received={() => {
            setOffset(0);
            retry();
          }}
        />
      )}
    </section>
  );
}
function SupplementForm({
  endpoint,
  close,
  received,
}: {
  endpoint: string;
  close: () => void;
  received: () => void;
}) {
  const [kind, setKind] = useState<keyof typeof supplementKinds>('assessment'),
    [body, setBody] = useState(''),
    [sourceUrl, setUrl] = useState('');
  const [context, setContext] = useState<ReviewContext>({ term: null, teacherName: null });
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  const request = useRef(crypto.randomUUID()),
    lock = useRef(false);
  function changed() {
    request.current = crypto.randomUUID();
    setError('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await send(endpoint, 'POST', { id: request.current, kind, body, sourceUrl, ...context });
      setDone(true);
      received();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请原样重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <CommunityDialog title="补充课程资料" close={close} busy={busy}>
      {done ? (
        <p role="status">
          补充资料已提交，审核后展示。<button onClick={close}>完成</button>
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label>
            补充类型
            <select
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind(event.target.value as keyof typeof supplementKinds);
                changed();
              }}
            >
              {Object.entries(supplementKinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            补充内容
            <textarea
              value={body}
              required
              maxLength={2000}
              rows={5}
              disabled={busy}
              onChange={(event) => {
                setBody(event.target.value);
                changed();
              }}
              placeholder="例如作业安排、考核方式、公开学习资料；纠错请说明原文位置。"
            />
          </label>
          <label>
            来源链接（选填）
            <input
              type="url"
              value={sourceUrl}
              maxLength={2048}
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                changed();
              }}
              placeholder="https://…"
            />
          </label>
          <ContextFields
            value={context}
            disabled={busy}
            change={(patch) => {
              setContext((current) => ({ ...current, ...patch }));
              changed();
            }}
          />
          <p className="fine-print">请勿填写学号、联系方式或公开非公开资料。</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? '正在提交…' : '提交资料'}
            </button>
          </div>
        </form>
      )}
    </CommunityDialog>
  );
}
