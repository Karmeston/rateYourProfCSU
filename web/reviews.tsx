import { useRef, useState } from 'react';
import { Icon } from './icons';
import { ReviewInteractions } from './review-interactions';
import { EmptyState, ErrorState } from './ui';
import { useData } from './use-data';
import { ContextLine } from './community-forms';
import type { OwnReview } from '../shared/community';
import { ReviewForm } from './review-form';
import { OwnReviewActions } from './own-review-actions';

type Review = {
  id: string;
  rating: number;
  body: string;
  created_at: string;
  likes: number;
  dislikes: number;
  myVote: number;
  replyCount: number;
  term: string | null;
  teacherName: string | null;
  updated_at: string | null;
  isMine: number;
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
  myReview: OwnReview | null;
};

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
  const [editing, setEditing] = useState<OwnReview | null>(null);
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
        <button
          className="primary-button"
          ref={writeButton}
          disabled={!data}
          onClick={() => {
            setEditing(data?.myReview ?? null);
            setWriting(true);
          }}
        >
          <Icon name="message" size={17} />
          {data?.myReview ? '修改我的评价' : '写评价'}
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
          {data.myReview && (
            <OwnReviewActions
              endpoint={endpoint}
              review={data.myReview}
              changed={retry}
              edit={() => {
                setEditing(data.myReview);
                setWriting(true);
              }}
            />
          )}
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
                    <span className="review-author">
                      {row.isMine ? '匿名同学 · 我的评价' : '匿名同学'}
                    </span>
                    <time dateTime={row.created_at}>
                      {new Date(row.created_at).toLocaleDateString('zh-CN')}
                    </time>
                  </div>
                  <Stars rating={row.rating} />
                  <ContextLine {...row} />
                  <p className="review-body">{row.body}</p>
                  {row.updated_at && (
                    <span className="fine-print">
                      已修改 · {new Date(row.updated_at).toLocaleDateString('zh-CN')}
                    </span>
                  )}
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
          own={editing}
          teacher={kind === 'courses'}
          published={() => {
            setOffset(0);
            setRating(null);
            setSort('latest');
            retry();
          }}
          close={() => {
            setWriting(false);
            setEditing(null);
            writeButton.current?.focus();
          }}
        />
      )}
    </section>
  );
}
