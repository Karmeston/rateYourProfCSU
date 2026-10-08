import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { readDraft, type ReviewDraft } from './review-draft';
import { ReviewInteractions } from './review-interactions';
import { EmptyState, ErrorState } from './ui';
import { useData } from './use-data';

type Review = {
  id: string;
  rating: number;
  body: string;
  created_at: string;
  likes: number;
  dislikes: number;
  myVote: number;
  replyCount: number;
};
type ReviewPage = {
  reviews: Review[];
  summary: {
    average: number | null;
    count: number;
    distribution: { rating: number; count: number }[];
  };
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};
const ratingLabels = ['不推荐', '不太推荐', '一般', '推荐', '非常推荐'];

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" role="img" aria-label={`${rating.toFixed(1)} / 5 星`}>
      <span aria-hidden="true">★★★★★</span>
      <span className="stars-fill" aria-hidden="true" style={{ width: `${(rating / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

function ReviewForm({
  endpoint,
  name,
  close,
  published,
}: {
  endpoint: string;
  name: string;
  close: () => void;
  published: () => void;
}) {
  const storageKey = `csu-review-draft:${endpoint}`;
  const [draft, setDraft] = useState<ReviewDraft>(() => {
    try {
      return (
        readDraft(sessionStorage.getItem(storageKey)) ?? {
          id: crypto.randomUUID(),
          rating: 0,
          body: '',
        }
      );
    } catch {
      return { id: crypto.randomUUID(), rating: 0, body: '' };
    }
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    try {
      if (submitted || (!draft.rating && !draft.body)) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [draft, storageKey, submitted]);
  function update(patch: Partial<Pick<ReviewDraft, 'rating' | 'body'>>) {
    // Preserve this ID on retries and reopening the draft; changing content starts a new submission.
    setDraft((current) => ({ ...current, ...patch, id: crypto.randomUUID() }));
    setError('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (controller.current || sending) return;
    if (!draft.rating || !draft.body.trim()) {
      setError('请选择星级并填写你的课堂体验。');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setSending(true);
    setError('');
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
        signal: abort.signal,
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? '提交失败，请重试。');
      }
      setSubmitted(true);
      published();
    } catch (cause) {
      setError(
        abort.signal.aborted || cause instanceof TypeError
          ? '提交结果未确认，请原样重试；同一份草稿不会重复发布。'
          : cause instanceof Error
            ? cause.message
            : '提交失败，请重试。',
      );
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      setSending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="review-dialog"
      aria-labelledby="review-form-title"
      onCancel={(event) => {
        if (sending) event.preventDefault();
      }}
      onClose={close}
    >
      <div className="dialog-heading">
        <div>
          <h2 id="review-form-title">{submitted ? '评价已发布' : '写评价'}</h2>
        </div>
        <button
          className="icon-button"
          disabled={sending}
          aria-label="关闭评价表单"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
      {submitted ? (
        <div className="review-success">
          <span>
            <Icon name="check" size={30} />
          </span>
          <p role="status">评价已发布。</p>
          <button className="primary-button" onClick={() => dialog.current?.close()}>
            完成
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <p className="review-target">
            <Icon name="book" size={17} />
            {name}
          </p>
          <fieldset className="rating-picker" disabled={sending}>
            <legend>
              你的整体评分 <span>必填</span>
            </legend>
            <div>
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} title={ratingLabels[value - 1]}>
                  <input
                    type="radio"
                    name="rating"
                    value={value}
                    required
                    checked={draft.rating === value}
                    onChange={() => update({ rating: value })}
                    aria-label={`${value} 星`}
                  />
                  <span aria-hidden="true" className={value <= draft.rating ? 'selected' : ''}>
                    ★
                  </span>
                </label>
              ))}
            </div>
            <p className="rating-hint">
              {draft.rating ? ratingLabels[draft.rating - 1] : '选择 1–5 星，表达你的整体体验'}
            </p>
          </fieldset>
          <label className="comment-label" htmlFor="review-body">
            你的课堂体验 <span>必填</span>
          </label>
          <textarea
            id="review-body"
            required
            maxLength={2000}
            rows={6}
            value={draft.body}
            disabled={sending}
            placeholder="可以聊聊课程内容、授课节奏、作业与考核，以及你最大的收获…"
            onChange={(event) => update({ body: event.target.value })}
          />
          <div className="draft-status">
            <span>{saved ? '草稿保存在当前标签页' : '浏览器无法保存草稿，请保留本表单'}</span>
            <span>{draft.body.length} / 2000</span>
          </div>
          <p className="fine-print">匿名发布，请分享具体经历，并避免填写个人联系方式。</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={sending}
              onClick={() => dialog.current?.close()}
            >
              稍后再写
            </button>
            <button type="submit" className="primary-button" disabled={sending}>
              {sending ? '正在发布…' : '发布评价'}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function Reviews({
  kind,
  id,
  name,
}: {
  kind: 'teachers' | 'courses';
  id: string;
  name: string;
}) {
  const [offset, setOffset] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [sort, setSort] = useState('latest');
  const [writing, setWriting] = useState(false);
  const writeButton = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/${kind}/${id}/reviews`;
  const { data, error, retry } = useData<ReviewPage>(
    `${endpoint}?offset=${offset}&sort=${sort}${rating ? `&rating=${rating}` : ''}`,
  );
  return (
    <section className="reviews" aria-labelledby="reviews-heading">
      <div className="reviews-heading">
        <div>
          <h2 id="reviews-heading">课程评价</h2>
        </div>
        <button className="primary-button" ref={writeButton} onClick={() => setWriting(true)}>
          <Icon name="message" size={17} />
          写评价
        </button>
      </div>
      {!data ? (
        error ? (
          <ErrorState message={error} retry={retry} />
        ) : (
          <div className="review-loading" role="status">
            正在加载课堂体验…
          </div>
        )
      ) : (
        <>
          <div className="rating-summary">
            <div className="rating-score">
              <strong>
                {data.summary.average === null ? '—' : data.summary.average.toFixed(1)}
              </strong>
              {data.summary.average !== null && <Stars rating={data.summary.average} />}
              <span>
                {data.summary.count ? `${data.summary.count} 条评价 · 满分 5 分` : '等待第一条评分'}
              </span>
            </div>
            <div className="rating-distribution">
              {data.summary.distribution.map((row) => (
                <button
                  className="rating-row"
                  key={row.rating}
                  aria-label={`筛选 ${row.rating} 星评价，共 ${row.count} 条`}
                  aria-pressed={rating === row.rating}
                  onClick={() => {
                    setRating(rating === row.rating ? null : row.rating);
                    setOffset(0);
                  }}
                >
                  <span>{row.rating} ★</span>
                  <span className="rating-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${data.summary.count ? (row.count / data.summary.count) * 100 : 0}%`,
                      }}
                    />
                  </span>
                  <span>{row.count}</span>
                </button>
              ))}
              <p className="fine-print">点击星级查看对应评价</p>
            </div>
          </div>
          <div className="review-list-heading">
            <h3>
              {rating ? `${rating} 星评价` : '全部评价'}
              <span>{data.total}</span>
            </h3>
            <div>
              {rating && (
                <button
                  className="text-button"
                  onClick={() => {
                    setRating(null);
                    setOffset(0);
                  }}
                >
                  查看全部
                </button>
              )}
              <label>
                <span className="sr-only">评价排序</span>
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="latest">最新发布</option>
                  <option value="helpful">赞同最多</option>
                </select>
              </label>
            </div>
          </div>
          {data.reviews.length ? (
            <ul className="review-list">
              {data.reviews.map((row) => (
                <li key={row.id}>
                  <div className="review-meta">
                    <span className="review-author">匿名同学</span>
                    <time dateTime={row.created_at}>
                      {new Date(row.created_at).toLocaleDateString('zh-CN')}
                    </time>
                  </div>
                  <Stars rating={row.rating} />
                  <p className="review-body">{row.body}</p>
                  <ReviewInteractions endpoint={`${endpoint}/${row.id}`} initial={row} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={
                rating
                  ? '还没有这个星级的评价'
                  : offset
                    ? '这一页还没有评价'
                    : '成为第一个分享课堂体验的人'
              }
              action={
                rating ? (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setRating(null);
                      setOffset(0);
                    }}
                  >
                    查看全部评价
                  </button>
                ) : offset ? (
                  <button className="secondary-button" onClick={() => setOffset(0)}>
                    回到第一页
                  </button>
                ) : undefined
              }
            >
              {rating
                ? '可以查看其他星级，了解同学们的不同感受。'
                : '你的收获与建议，都可能为下一位同学提供参考。'}
            </EmptyState>
          )}
          {(offset > 0 || data.hasMore) && (
            <nav className="pagination" aria-label="评价分页">
              <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>
                上一页
              </button>
              <span>第 {offset / 20 + 1} 页</span>
              <button disabled={!data.hasMore} onClick={() => setOffset(offset + 20)}>
                下一页
              </button>
            </nav>
          )}
        </>
      )}
      {writing && (
        <ReviewForm
          endpoint={endpoint}
          name={name}
          published={() => {
            setOffset(0);
            setRating(null);
            setSort('latest');
            retry();
          }}
          close={() => {
            setWriting(false);
            writeButton.current?.focus();
          }}
        />
      )}
    </section>
  );
}
