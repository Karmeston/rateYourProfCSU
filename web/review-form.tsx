import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { readDraft, type ReviewDraft } from './review-draft';
import { send } from './visitor';
import { ContextFields } from './community-forms';
import type { OwnReview } from '../shared/community';

const ratingLabels = ['不推荐', '不太推荐', '一般', '推荐', '非常推荐'];

export function ReviewForm({
  endpoint,
  name,
  close,
  published,
  own,
  teacher,
}: {
  endpoint: string;
  name: string;
  close: () => void;
  published: () => void;
  own: OwnReview | null;
  teacher: boolean;
}) {
  const storageKey = `csu-review-draft:${endpoint}${own ? `:${own.id}:${own.revision}` : ''}`;
  const [draft, setDraft] = useState<ReviewDraft>(() => {
    try {
      return (
        readDraft(sessionStorage.getItem(storageKey)) ??
        (own
          ? {
              id: own.id,
              rating: own.rating,
              body: own.body,
              term: own.term,
              teacherName: own.teacherName,
            }
          : {
              id: crypto.randomUUID(),
              rating: 0,
              body: '',
            })
      );
    } catch {
      return own
        ? {
            id: own.id,
            rating: own.rating,
            body: own.body,
            term: own.term,
            teacherName: own.teacherName,
          }
        : { id: crypto.randomUUID(), rating: 0, body: '' };
    }
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(true);
  const [success, setSuccess] = useState('');
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
  function update(patch: Partial<Omit<ReviewDraft, 'id'>>) {
    // Preserve this ID on retries and reopening the draft; changing content starts a new submission.
    setDraft((current) => ({ ...current, ...patch, id: own?.id ?? crypto.randomUUID() }));
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
      const { id: requestId, ...content } = draft;
      const result = await send<{ status?: string }>(
        own ? `${endpoint}/${own.id}` : endpoint,
        own ? 'PUT' : 'POST',
        own ? { ...content, revision: own.revision } : { id: requestId, ...content },
        abort.signal,
      );
      setSuccess(result.status === 'pending' ? '评价已保存，等待审核。' : '评价已保存。');
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
      published();
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
          <h2 id="review-form-title">
            {submitted ? '评价已保存' : own ? '修改我的评价' : '写评价'}
          </h2>
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
          <p role="status">{success}</p>
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
          <details className="review-context">
            <summary>补充选课背景（选填）</summary>
            <ContextFields value={draft} change={update} disabled={sending} teacher={teacher} />
          </details>
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
              {sending
                ? '正在保存…'
                : own
                  ? own.withdrawn_at
                    ? '保存并重新提交'
                    : '保存修改'
                  : '发布评价'}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
