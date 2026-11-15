import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import app, { QuotaGuard } from '../src/index.ts';

const token = (number) => number.toString(16).padStart(64, '0');

test('数据库预算按网络与类别共享，跨日恢复，并发不能超发', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let now = Date.UTC(2026, 10, 15, 23, 59, 30);
  t.mock.method(Date, 'now', () => now);
  const guard = new QuotaGuard({
    storage: {
      sql: {
        exec(sql, ...args) {
          if (sql.startsWith('SELECT')) return { toArray: () => db.prepare(sql).all(...args) };
          db.prepare(sql).run(...args);
        },
      },
      transactionSync(fn) {
        db.exec('BEGIN');
        try {
          const value = fn();
          db.exec('COMMIT');
          return value;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  });
  const reserve = (operation, network) => guard.fetch(new Request('https://internal/quota', {
    method: 'POST',
    body: JSON.stringify({ operation, network: token(network) }),
  }));
  const results = await Promise.all(Array.from({ length: 24 }, () => reserve('catalog', 1)));
  assert.equal(results.filter((r) => r.status === 204).length, 20);
  assert.equal(results.find((r) => r.status === 429).headers.get('Retry-After'), '30');
  assert.equal((await reserve('program', 1)).status, 204);
  assert.equal((await reserve('interaction', 1)).status, 204);
  const others = await Promise.all(Array.from({ length: 40 }, (_, i) => reserve('catalog', i + 2)));
  assert.equal(others.filter((r) => r.status === 204).length, 32);
  assert.equal((await reserve('catalog', 200)).status, 429);
  assert.equal((await reserve('traffic', 200)).status, 204);
  now += 31_000;
  assert.equal((await reserve('catalog', 1)).status, 204);
  assert.equal(db.prepare('SELECT count(*) AS n FROM quota').get().n, 2);
});

test('公开接口在触及 D1 之前拒绝超额，查询样式和来源头不改变网络额度', async () => {
  const networks = [];
  const operations = [];
  let touchingDb = 0;
  let admissions = 0;
  let allowBurst = true;
  const env = {
    VISITOR_SECRET: 'quota-test-secret-with-enough-characters',
    PUBLIC_DATA_LIMITER: { limit: async ({ key }) => {
      networks.push(key);
      return { success: allowBurst };
    } },
    QUOTA_GUARD: {
      idFromName: (x) => x,
      get: () => ({ fetch: async (_url, init) => {
        admissions++;
        operations.push(JSON.parse(init.body).operation);
        return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
      } }),
    },
    TRAFFIC_LIMITER: { limit: async () => ({ success: true }) },
    DB: { prepare() { touchingDb++; throw new Error('Admission bypassed'); } },
  };
  const query = (path, ip, forwarded) => app.request('https://example.test' + path, {
    headers: { 'CF-Connecting-IP': ip, 'X-Forwarded-For': forwarded },
  }, env);
  for (const [path, ip, forwarded] of [
    ['/api/courses?view=results&q=first', '2001:db8:1:2::1', '192.0.2.1'],
    ['/api/courses?q=second', '2001:0db8:0001:2::abcd', '192.0.2.2'],
    ['/api/courses/facets', '2001:db8:1:2::2', '192.0.2.3'],
    ['/api/courses/1/reviews', '2001:db8:1:2::3', '192.0.2.4'],
    ['/api/teachers?limit=1', '2001:db8:1:2::4', '192.0.2.5'],
  ]) {
    const response = await query(path, ip, forwarded);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '120');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).code, 'SERVICE_DAILY_BUDGET');
  }
  assert.equal(new Set(networks).size, 1);
  assert.equal(admissions, 5);
  assert.deepEqual(operations, ['catalog', 'catalog', 'facets', 'content', 'content']);
  allowBurst = false;
  const burst = await query('/api/courses?q=test', '192.0.2.1', '192.0.2.2');
  assert.equal((await burst.json()).code, 'REQUEST_RATE_LIMIT');
  assert.equal(admissions, 5);
  const traffic = await app.request('https://example.test/api/traffic', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), page: 'course', targetId: 1 }),
  }, env);
  assert.equal(traffic.status, 429);
  assert.equal(operations.at(-1), 'traffic');
  assert.equal(touchingDb, 0);

  const unbound = await app.request('https://example.test/api/courses/1', {
    headers: { 'CF-Connecting-IP': '192.0.2.1' },
  }, { ...env, PUBLIC_DATA_LIMITER: undefined });
  assert.equal(unbound.status, 503);
  assert.equal(touchingDb, 0);
});
