import { useRef, useState } from 'react';
import { supplementKinds, type OwnSupplement, type SupplementPage } from '../shared/community';
import { ContextLine, ReportButton } from './community-forms';
import { useData } from './use-data';
import { SupplementForm } from './supplement-form';
import { OwnSupplementActions } from './own-supplement-actions';
export function CourseSupplements({ id }: { id: string }) {
  const endpoint = `/api/courses/${id}/supplements`;
  const [offset, setOffset] = useState(0),
    [mineOffset, setMineOffset] = useState(0),
    [writing, setWriting] = useState(false),
    [editing, setEditing] = useState<OwnSupplement | null>(null),
    [opened, setOpened] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const { data, error, retry } = useData<SupplementPage>(
    opened ? `${endpoint}?offset=${offset}&mineOffset=${mineOffset}` : null,
  );
  return (
    <section className="course-supplements">
      <details
        onToggle={(event) => {
          if (event.target === event.currentTarget) setOpened(event.currentTarget.open);
        }}
      >
        <summary>同学补充资料</summary>
        <p className="fine-print">
          课程考核、学习资料和纠错信息由同学提供，审核后展示；不替代官方培养方案或学分认定依据。
        </p>
        <button
          className="secondary-button"
          ref={button}
          onClick={() => {
            setEditing(null);
            returnFocus.current = button.current;
            setWriting(true);
          }}
        >
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
        <details className="own-supplements" hidden={!data?.mine.length && mineOffset === 0}>
          <summary>管理我的补充资料</summary>
          <ul className="supplement-list">
            {data?.mine.map((row) => (
              <OwnSupplementActions
                key={`${row.id}:${row.revision}`}
                endpoint={endpoint}
                supplement={row}
                changed={retry}
                edit={(origin) => {
                  setEditing(row);
                  returnFocus.current = origin;
                  setWriting(true);
                }}
              />
            ))}
          </ul>
          {(mineOffset > 0 || data?.hasMoreMine) && (
            <nav className="pagination" aria-label="我的补充资料分页">
              <button disabled={!mineOffset} onClick={() => setMineOffset(mineOffset - 20)}>
                上一页
              </button>
              <button disabled={!data?.hasMoreMine} onClick={() => setMineOffset(mineOffset + 20)}>
                下一页
              </button>
            </nav>
          )}
        </details>
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
          own={editing}
          close={() => {
            setWriting(false);
            // Restore focus after React removes the dialog and the browser finishes closing it.
            requestAnimationFrame(() => {
              const origin = returnFocus.current?.isConnected
                ? returnFocus.current
                : button.current;
              origin?.focus();
            });
          }}
          received={() => {
            // Refresh replaces the edited row. Return to the stable submission button after saving.
            returnFocus.current = button.current;
            if (!editing) setMineOffset(0);
            retry();
          }}
        />
      )}
    </section>
  );
}
