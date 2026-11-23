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
  assert.equal(results.filter((r) => r.status === 204).length, 10);
  assert.equal(results.find((r) => r.status === 429).headers.get('Retry-After'), '30');
  assert.equal((await reserve('program', 1)).status, 204);
  assert.equal((await reserve('interaction', 1)).status, 204);
  const others = await Promise.all(Array.from({ length: 40 }, (_, i) => reserve('catalog', i + 2)));
  assert.equal(others.filter((r) => r.status === 204).length, 20);
  assert.equal((await reserve('catalog', 200)).status, 429);
  assert.equal((await reserve('traffic', 200)).status, 204);
  const monitor = await (await guard.fetch(new Request('https://internal/monitor?days=7'))).json();
  const catalog = monitor.operations.find((row) => row.operation === 'catalog');
  assert.equal(catalog.allowed, 30);
  assert.equal(catalog.networkLimited, 14);
  assert.equal(catalog.budgetLimited, 21);
  assert.equal(catalog.used, 30 * 35000);
  assert.equal(monitor.today, '2026-11-16');
  assert.ok(!JSON.stringify(monitor).includes(token(200)));
  assert.equal((await guard.fetch(new Request('https://internal/events', {
    method: 'POST', body: JSON.stringify({ group: 'reviews', event: 'd1_limit' }),
  }))).status, 204);
  const signals = await (await guard.fetch(new Request('https://internal/monitor?days=7'))).json();
  assert.deepEqual(signals.signals, [{ group: 'reviews', event: 'd1_limit', count: 1 }]);
  now += 31_000;
  assert.equal((await reserve('catalog', 1)).status, 204);
  assert.equal(db.prepare('SELECT count(*) AS n FROM quota').get().n, 2);
  now += 31 * 86400000;
  await reserve('content', 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM service_daily WHERE day<?').get('2026-11-17').n, 0);
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

test('读取超出估算时补记实际行数，补记计入网络与全站额度且不能用于写入类', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const now = Date.UTC(2026, 10, 23, 4);
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
        return fn();
      },
    },
  });
  const post = (path, body) => guard.fetch(new Request('https://internal' + path, {
    method: 'POST', body: JSON.stringify(body),
  }));
  const used = (key) => db.prepare('SELECT used FROM quota WHERE key=?').get(key)?.used;
  assert.equal((await post('/quota', { operation: 'content', network: token(1) })).status, 204);
  assert.equal(used('content'), 50);
  assert.equal((await post('/charge', { operation: 'content', network: token(1), units: 574_951 })).status, 204);
  assert.equal(used('content'), 575_001);
  assert.equal(used('content:' + token(1)), 575_001);
  // That network has now used its share; another network still has room.
  assert.equal((await post('/quota', { operation: 'content', network: token(1) })).status, 429);
  assert.equal((await post('/quota', { operation: 'content', network: token(2) })).status, 204);
  for (const body of [
    { operation: 'interaction', network: token(1), units: 10 },
    { operation: 'content', network: 'not-a-network', units: 10 },
    { operation: 'content', network: token(1), units: 0 },
    { operation: 'content', network: token(1), units: 1.5 },
  ])
    assert.equal((await post('/charge', body)).status, 400);
});
