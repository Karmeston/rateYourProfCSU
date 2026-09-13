import { useEffect, useRef, useState } from 'react';
import { useData } from './use-data';
import { ReviewInteractions } from './review-interactions';

type Review = { id: string; rating: number; body: string; created_at: string; likes:number;dislikes:number;myVote:number;replyCount:number };
type ReviewPage = {
  reviews: Review[];
  summary: { average: number | null; count: number; distribution: { rating: number; count: number }[] };
  offset: number; limit: number; hasMore: boolean;
};

function Stars({ rating }: { rating: number }) {
  return <span className="stars" role="img" aria-label={`${rating.toFixed(1)} / 5 星`}>
    <span aria-hidden="true">★★★★★</span><span className="stars-fill" aria-hidden="true" style={{ width: `${rating / 5 * 100}%` }}>★★★★★</span>
  </span>;
}

function ReviewForm({ endpoint, name, close, published }: { endpoint: string; name: string; close: () => void; published: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const controller = useRef<AbortController | null>(null);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);
  const changed = () => { requestId.current = crypto.randomUUID(); setError(''); };
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="review-form-title" onCancel={(event) => { if (sending) event.preventDefault(); }} onClose={close}>
    <h2 id="review-form-title">{submitted ? '已提交' : '写评价'}</h2>
    {submitted ? <><p role="status">评价已发布。</p><button className="primary-button" onClick={() => dialog.current?.close()}>完成</button></> :
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (controller.current || sending) return;
        if (!rating || !body.trim()) { setError('请选择星级并填写评论。'); return; }
        const abort = new AbortController();
        controller.current = abort;
        setSending(true); setError('');
        const timeout = window.setTimeout(() => abort.abort(), 20000);
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: requestId.current, rating, body }), signal: abort.signal });
          if (!response.ok) {
            const result = await response.json().catch(() => null) as { error?: string } | null;
            throw new Error(result?.error ?? '提交失败，请重试。');
          }
          setSubmitted(true);
          published();
        } catch (cause) {
          setError(abort.signal.aborted ? '提交结果未确认，请重试；原样重试不会重复提交。' : cause instanceof TypeError ? '网络连接失败，请重试。' : cause instanceof Error ? cause.message : '提交失败，请重试。');
        } finally { window.clearTimeout(timeout); controller.current = null; setSending(false); }
      }}>
        <p className="review-target">{name}</p>
        <fieldset className="rating-picker" disabled={sending}>
          <legend>你的评分</legend>
          <div>{[1, 2, 3, 4, 5].map((value) => <label key={value}>
            <input type="radio" name="rating" value={value} required checked={rating === value} onChange={() => { changed(); setRating(value); }} aria-label={`${value} 星`} />
            <span aria-hidden="true" className={value <= rating ? 'selected' : ''}>★</span>
          </label>)}</div>
        </fieldset>
        <label className="comment-label" htmlFor="review-body">评论</label>
        <textarea id="review-body" required maxLength={2000} rows={6} value={body} disabled={sending} onChange={(event) => { changed(); setBody(event.target.value); }} />
        <p className="character-count">{body.length} / 2000</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><button type="button" disabled={sending} onClick={() => dialog.current?.close()}>取消</button><button type="submit" className="primary-button" disabled={sending}>{sending ? '提交中…' : '提交评价'}</button></div>
      </form>}
  </dialog>;
}

export function Reviews({ kind, id, name }: { kind: 'teachers' | 'courses'; id: string; name: string }) {
  const [offset, setOffset] = useState(0);
  const [writing, setWriting] = useState(false);
  const writeButton = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/${kind}/${id}/reviews`;
  const { data, error, retry } = useData<ReviewPage>(`${endpoint}?offset=${offset}`);
  return <section className="reviews" aria-labelledby="reviews-heading">
    <div className="reviews-heading"><h2 id="reviews-heading">评分与评论</h2><button className="primary-button" ref={writeButton} onClick={() => setWriting(true)}>写评价</button></div>
    {!data ? error ? <div className="notice" role="alert"><p>{error}</p><button onClick={retry}>重新加载</button></div> : <p role="status">正在加载…</p> : <>
      <div className="rating-summary">
        <div className="rating-score"><strong>{data.summary.average === null ? '—' : data.summary.average.toFixed(1)}</strong>
          {data.summary.average !== null && <Stars rating={data.summary.average} />}
          <span>{data.summary.count ? `${data.summary.count} 条评价` : '暂无评分'}</span>
        </div>
        <div className="rating-distribution">{data.summary.distribution.map((row) => <div className="rating-row" key={row.rating} aria-label={`${row.rating} 星：${row.count} 条`}>
          <span aria-hidden="true">{row.rating} ★</span><div className="rating-track" aria-hidden="true"><div style={{ width: `${data.summary.count ? row.count / data.summary.count * 100 : 0}%` }} /></div><span aria-hidden="true">{row.count}</span>
        </div>)}</div>
      </div>
      <div className="review-list-heading"><h3>评论</h3><span>最新发布</span></div>
      {data.reviews.length ? <ul className="review-list">{data.reviews.map((row) => <li key={row.id}>
        <div className="review-meta"><span>匿名用户</span><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleDateString('zh-CN')}</time></div>
        <Stars rating={row.rating} /><p className="review-body">{row.body}</p>
        <ReviewInteractions endpoint={`${endpoint}/${row.id}`} initial={row} />
      </li>)}</ul> : <p className="review-empty">{offset ? '本页暂无评论' : '暂无评论'}</p>}
      {(offset > 0 || data.hasMore) && <nav className="pagination" aria-label="评论分页"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</button><span>第 {offset / 20 + 1} 页</span><button disabled={!data.hasMore} onClick={() => setOffset(offset + 20)}>下一页</button></nav>}
    </>}
    {writing && <ReviewForm endpoint={endpoint} name={name} published={() => { setOffset(0); retry(); }} close={() => { setWriting(false); writeButton.current?.focus(); }} />}
  </section>;
}
