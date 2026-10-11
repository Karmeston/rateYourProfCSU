import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reportReasons, termLabel, type ReviewContext } from '../shared/community';
import { send } from './visitor';
import { Icon } from './icons';

export function CommunityDialog({
  title,
  close,
  busy,
  children,
}: {
  title: string;
  close: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="review-dialog"
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={close}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="关闭表单"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ContextFields({
  value,
  change,
  disabled = false,
  teacher = true,
}: {
  value: Partial<ReviewContext>;
  change: (patch: Partial<ReviewContext>) => void;
  disabled?: boolean;
  teacher?: boolean;
}) {
  const year = new Date().getFullYear();
  const terms = Array.from({ length: 11 }, (_, offset) => [
    `${year - offset}-2`,
    `${year - offset}-1`,
  ]).flat();
  if (value.term && !terms.includes(value.term)) terms.unshift(value.term);
  return (
    <div className="context-fields">
      <label>
        学年学期（选填）
        <select
          value={value.term ?? ''}
          disabled={disabled}
          onChange={(event) => change({ term: event.target.value || null })}
        >
          <option value="">不填写</option>
          {terms.map((term) => (
            <option key={term} value={term}>
              {termLabel(term)}
            </option>
          ))}
        </select>
      </label>
      {teacher && (
        <label>
          任课教师（选填）
          <input
            value={value.teacherName ?? ''}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => change({ teacherName: event.target.value || null })}
            placeholder="填写你上课时的教师"
          />
        </label>
      )}
    </div>
  );
}

export function ContextLine({ term, teacherName }: Partial<ReviewContext>) {
  return term || teacherName ? (
    <p className="fine-print">
      {[term && termLabel(term), teacherName && `任课教师：${teacherName}`]
        .filter(Boolean)
        .join(' · ')}{' '}
      · 同学自述
    </p>
  ) : null;
}

export function ReportButton({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button className="text-button" ref={button} onClick={() => setOpen(true)}>
        举报
      </button>
      {open && (
        <ReportForm
          endpoint={endpoint}
          close={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}
function ReportForm({ endpoint, close }: { endpoint: string; close: () => void }) {
  const [reason, setReason] = useState<keyof typeof reportReasons>('inaccurate');
  const [details, setDetails] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(crypto.randomUUID());
  const lock = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await send(endpoint, 'POST', { id: request.current, reason, details });
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请原样重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <CommunityDialog title="举报内容" busy={busy} close={close}>
      {done ? (
        <p role="status">
          举报已收到，维护者会查看。<button onClick={close}>完成</button>
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label>
            举报原因
            <select
              value={reason}
              disabled={busy}
              onChange={(event) => {
                setReason(event.target.value as keyof typeof reportReasons);
                request.current = crypto.randomUUID();
              }}
            >
              {Object.entries(reportReasons).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            补充说明（选填）
            <textarea
              value={details}
              maxLength={1000}
              rows={4}
              disabled={busy}
              onChange={(event) => {
                setDetails(event.target.value);
                request.current = crypto.randomUUID();
              }}
            />
          </label>
          <p className="fine-print">举报由维护者处理，同一访客对同一条内容的重复举报只记一次。</p>
          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? '正在提交…' : '提交举报'}
            </button>
          </div>
        </form>
      )}
    </CommunityDialog>
  );
}
