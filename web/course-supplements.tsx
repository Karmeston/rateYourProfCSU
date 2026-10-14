import { useRef, useState } from 'react';
import { supplementKinds, type ReviewContext } from '../shared/community';
import { ContextLine, ReportButton } from './community-forms';
import { useData } from './use-data';
import { SupplementForm } from './supplement-form';

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
    [writing, setWriting] = useState(false),
    [opened, setOpened] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const { data, error, retry } = useData<{
    supplements: Supplement[];
    mine: Supplement[];
    hasMore: boolean;
  }>(opened ? `${endpoint}?offset=${offset}` : null);
  return (
    <section className="course-supplements">
      <details onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary>同学补充资料</summary>
        <p className="fine-print">
          课程考核、学习资料和纠错信息由同学提供，审核后展示；不替代官方培养方案或学分认定依据。
        </p>
        <button className="secondary-button" ref={button} onClick={() => setWriting(true)}>
          补充课程资料
        </button>
        {opened && !data && !error && <p role="status">正在加载补充资料…</p>}
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
