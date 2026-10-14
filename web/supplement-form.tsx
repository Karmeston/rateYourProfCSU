import { useEffect, useRef, useState } from 'react';
import { supplementKinds } from '../shared/community';
import { CommunityDialog, ContextFields } from './community-forms';
import { readSupplementDraft, type SupplementDraft } from './supplement-draft';
import { send } from './visitor';

export function SupplementForm({
  endpoint,
  close,
  received,
}: {
  endpoint: string;
  close: () => void;
  received: () => void;
}) {
  const storageKey = `csu-supplement-draft:${endpoint}`;
  const [draft, setDraft] = useState<SupplementDraft>(() => {
    const empty: SupplementDraft = {
      id: crypto.randomUUID(),
      kind: 'assessment',
      body: '',
      sourceUrl: '',
      term: null,
      teacherName: null,
    };
    try {
      return readSupplementDraft(sessionStorage.getItem(storageKey)) ?? empty;
    } catch {
      return empty;
    }
  });
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    try {
      if (done || (!draft.body && !draft.sourceUrl && !draft.term && !draft.teacherName))
        sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [draft, storageKey, done]);
  function update(patch: Partial<Omit<SupplementDraft, 'id'>>) {
    // Keep the submission ID through retries and reopening; edits create a new submission.
    setDraft((current) => ({ ...current, ...patch, id: crypto.randomUUID() }));
    setError('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    if (!draft.body.trim()) {
      setError('请填写补充内容。');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    setBusy(true);
    setError('');
    try {
      await send(endpoint, 'POST', draft, abort.signal);
      if (!mounted.current) return;
      setDone(true);
      received();
    } catch (cause) {
      if (mounted.current)
        setError(
          abort.signal.aborted || cause instanceof TypeError
            ? '提交结果未确认，请原样重试；同一份草稿不会重复提交。'
            : cause instanceof Error
              ? cause.message
              : '提交失败，请原样重试。',
        );
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      if (mounted.current) setBusy(false);
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
              value={draft.kind}
              disabled={busy}
              onChange={(event) => {
                update({ kind: event.target.value as keyof typeof supplementKinds });
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
              value={draft.body}
              required
              maxLength={2000}
              rows={5}
              disabled={busy}
              onChange={(event) => {
                update({ body: event.target.value });
              }}
              placeholder="例如作业安排、考核方式、公开学习资料；纠错请说明原文位置。"
            />
          </label>
          <label>
            来源链接（选填）
            <input
              type="url"
              value={draft.sourceUrl}
              maxLength={2048}
              disabled={busy}
              onChange={(event) => {
                update({ sourceUrl: event.target.value });
              }}
              placeholder="https://…"
            />
          </label>
          <ContextFields value={draft} disabled={busy} change={update} />
          <p className="fine-print" role="status">
            {saved
              ? '草稿保存在当前标签页，关闭后可继续填写。'
              : '浏览器无法保存草稿，请保留本表单。'}
          </p>
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
