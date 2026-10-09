import assert from 'node:assert/strict';
import { test } from 'node:test';
import { send, SubmissionError } from '../web/visitor.ts';

const ready = () => new Response(null, { status: 204 });
const success = () => Response.json({ received: true });

test('首次并行互动只建立一个会话，后续互动重新检查 Cookie', async (t) => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/visitor') {
      await gate;
      return ready();
    }
    return success();
  });
  const a = send('/api/courses/1/reviews', 'POST', { id: 'same-draft' });
  const b = send('/api/courses/1/reviews/r/vote', 'PUT', { value: 1 });
  assert.equal(calls.length, 1);
  release();
  await Promise.all([a, b]);
  assert.equal(calls.filter((c) => c.url === '/api/visitor').length, 1);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.headers['X-Browser-ID'], undefined);
  }
  await send('/api/courses/1/reviews', 'POST', { id: 'same-draft' });
  assert.equal(calls.filter((c) => c.url === '/api/visitor').length, 2);
});

test('Cookie 被禁用时提示服务端错误，不循环签发、不更改草稿', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return url === '/api/visitor'
      ? ready()
      : Response.json(
          { code: 'VISITOR_REQUIRED', error: '请允许本站 Cookie 后重试。' },
          { status: 401 },
        );
  });
  const draft = { id: 'original-id', rating: 4, body: '原样重试' };
  for (let i = 0; i < 2; i++) {
    await assert.rejects(
      send('/api/courses/1/reviews', 'POST', draft),
      (error) => error instanceof SubmissionError && error.message.includes('Cookie'),
    );
  }
  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(calls[1].options.body), draft);
  assert.equal(calls[1].options.body, calls[3].options.body);
});

test('会话建立失败或表单取消后不继续提交', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: '操作太频繁' }, { status: 429 }),
  );
  await assert.rejects(send('/api/courses/1/reviews', 'POST', {}), /操作太频繁/);
  assert.equal(mock.mock.callCount(), 1);
  const abort = new AbortController();
  mock.mock.mockImplementation(async () => {
    abort.abort();
    return ready();
  });
  await assert.rejects(send('/api/courses/1/reviews', 'POST', {}, abort.signal), {
    name: 'AbortError',
  });
  assert.equal(mock.mock.callCount(), 2);
});
