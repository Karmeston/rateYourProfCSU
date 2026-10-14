import { useRef, useState } from 'react';
import { supplementKinds, type OwnSupplement } from '../shared/community';
import { ContextLine } from './community-forms';
import { send } from './visitor';

export function OwnSupplementActions({
  endpoint,
  supplement,
  edit,
  changed,
}: {
  endpoint: string;
  supplement: OwnSupplement;
  edit: (button: HTMLButtonElement) => void;
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
      await send(`${endpoint}/${supplement.id}`, 'DELETE', { revision: supplement.revision });
      setConfirm(false);
      changed();
    } catch (cause) {
      setError(
        cause instanceof TypeError ||
          (cause instanceof Error && ['AbortError', 'TimeoutError'].includes(cause.name))
          ? '撤回结果未确认，请原样重试。'
          : cause instanceof Error
            ? cause.message
            : '撤回失败，请重试。',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <li className="own-supplement">
      <strong>
        {supplementKinds[supplement.kind]} ·{' '}
        {supplement.withdrawn_at
          ? '已撤回'
          : supplement.status === 'published'
            ? '已发布'
            : supplement.status === 'pending'
              ? '待审核'
              : '未通过审核或已隐藏'}
      </strong>
      <ContextLine {...supplement} />
      <p className="review-body">{supplement.body}</p>
      <div className="supplement-actions">
        <button
          className="text-button"
          disabled={busy || confirm}
          onClick={(event) => edit(event.currentTarget)}
        >
          {supplement.withdrawn_at ? '修改并重新提交' : '修改资料'}
        </button>
        {!supplement.withdrawn_at && !confirm && (
          <button className="text-button" onClick={() => setConfirm(true)}>
            撤回资料
          </button>
        )}
      </div>
      {confirm && (
        <div className="withdraw-confirm">
          <p>撤回后不再公开，也不会进入待审核队列。</p>
          <div className="supplement-actions">
            <button disabled={busy} onClick={() => void withdraw()}>
              确认撤回
            </button>
            <button disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error} <button onClick={changed}>刷新资料</button>
        </p>
      )}
    </li>
  );
}
