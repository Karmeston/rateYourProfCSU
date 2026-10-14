import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readSupplementDraft } from '../web/supplement-draft.ts';

const draft = () => ({
  id: randomUUID(),
  kind: 'materials',
  body: '公开课件说明',
  sourceUrl: 'https://example.edu/',
  term: '2025-1',
  teacherName: '教师甲',
});

test('重新打开补充草稿保留提交编号和选课背景，未完成的链接也可以保存', () => {
  const original = draft();
  assert.deepEqual(readSupplementDraft(JSON.stringify(original)), original);
  const incomplete = { ...original, body: '', sourceUrl: 'https://' };
  assert.deepEqual(readSupplementDraft(JSON.stringify(incomplete)), incomplete);
  assert.deepEqual(
    readSupplementDraft(JSON.stringify({ ...original, visitor_id: 'ignored' })),
    original,
  );
});

test('损坏或超长的浏览器草稿不进入表单', () => {
  for (const value of [
    null,
    '',
    '{',
    'null',
    '[]',
    '1',
    JSON.stringify({}),
    ...[
      { id: 'bad' },
      { kind: '__proto__' },
      { body: 'a'.repeat(2001) },
      { sourceUrl: 'a'.repeat(2049) },
      { term: '2025-3' },
      { teacherName: '' },
      { body: '正文\0' },
      { sourceUrl: null },
    ].map((patch) => JSON.stringify({ ...draft(), ...patch })),
  ]) {
    assert.equal(readSupplementDraft(value), null);
  }
});
