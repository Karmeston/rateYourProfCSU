import { useRef, useState } from 'react';
import { send } from './visitor';
import { ContextLine } from './community-forms';
import type { OwnReview } from '../shared/community';

export function OwnReviewActions({
  endpoint,
  review,
  edit,
  changed,
}: {
  endpoint: string;
  review: OwnReview;
  edit: () => void;
  changed: () => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function withdraw() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await send(`${endpoint}/${review.id}`, 'DELETE', { revision: review.revision });
      setConfirm(false);
      changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤回结果未确认，请原样重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="own-review">
      <span>
        我的评价 ·{' '}
        {review.withdrawn_at
          ? '已撤回，不计入评分'
          : review.status === 'pending'
            ? '待审核'
            : review.status === 'rejected'
              ? '已隐藏；修改后将重新审核'
              : '已发布'}
      </span>
      {(review.withdrawn_at || review.status !== 'published') && (
        <>
          <ContextLine {...review} />
          <p className="review-body">{review.body}</p>
        </>
      )}
      {!review.withdrawn_at && !confirm && (
        <button className="text-button" onClick={() => setConfirm(true)}>
          撤回评价
        </button>
      )}
      {review.withdrawn_at && (
        <button className="text-button" onClick={edit}>
          修改并重新提交
        </button>
      )}
      {confirm && (
        <div>
          <span>撤回后不再公开，也不计入评分。</span>
          <button disabled={busy} onClick={() => void withdraw()}>
            确认撤回
          </button>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            取消
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
          <button onClick={changed}>刷新评价</button>
        </p>
      )}
    </div>
  );
}
