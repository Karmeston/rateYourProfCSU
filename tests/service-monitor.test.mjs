import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { monitorService } from '../src/service-monitor.ts';

test('异常采集限制放大成本，使用固定接口范围且不泄露查询或内容', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 21, 2));
  const events = [];
  const pending = [];
  const env = { QUOTA_GUARD: {
    idFromName: (name) => name,
    get: () => ({ fetch: async (_url, init) => {
      events.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    } }),
  } };
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const app = new Hono();
  app.use('*', monitorService);
  app.get('/api/courses/:id/reviews', (c) => c.body(null, 429));
  app.get('/api/error', (c) => {
    c.set('serviceEvent', 'd1_limit');
    return c.body(null, 503);
  });
  app.get('/api/recorded', (c) => {
    c.set('quotaRecorded', true);
    return c.body(null, 429);
  });
  app.get('/api/ok', (c) => c.body(null, 204));
  for (const path of ['/api/error', '/api/recorded', '/api/ok'])
    await app.fetch(new Request('https://example.test' + path), env, ctx);
  for (let i = 0; i < 75; i++)
    await app.fetch(new Request('https://example.test/api/courses/123/reviews?q=private'), env, ctx);
  await Promise.all(pending);
  assert.equal(events.length, 60);
  assert.deepEqual(events[0], { group: 'other', event: 'd1_limit' });
  assert.deepEqual(events[1], { group: 'reviews', event: 'rate_limit' });
  assert.ok(!JSON.stringify(events).includes('private'));
  assert.ok(!JSON.stringify(events).includes('123'));
  env.QUOTA_GUARD.get = () => { throw new Error('offline'); };
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 21, 2, 1));
  const warning = t.mock.method(console, 'warn', () => {});
  assert.equal((await app.fetch(new Request('https://example.test/api/error'), env, ctx)).status, 503);
  await Promise.all(pending);
  assert.equal(warning.mock.callCount(), 1);
});
