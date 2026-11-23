import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { meterDatabase } from '../src/read-meter.ts';
import { migrate } from './helpers/database.mjs';
import { issueCookie, visitorEnv } from './helpers/visitor.mjs';

test('按实际读取行数计费与匿名评价缓存（临时 D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  const statements = [];
  for (const id of [1, 2, 3])
    statements.push(DB.prepare('INSERT INTO courses (id,name,department) VALUES (?,?,?)').bind(id, '课程' + id, '测试学院'));
  for (let i = 0; i < 40; i++) {
    const review = randomUUID();
    statements.push(DB.prepare("INSERT INTO course_reviews (id,course_id,rating,body,status,visitor_id) VALUES (?,1,?,?,'published',?)")
      .bind(review, 1 + (i % 5), '正文' + i, randomUUID()));
    for (let v = 0; v < 4; v++)
      statements.push(DB.prepare('INSERT INTO course_review_votes (review_id,voter_id,value) VALUES (?,?,?)')
        .bind(review, randomUUID(), v % 2 ? 1 : -1));
  }
  await DB.batch(statements);

  await t.test('计量包装保持 first、run、batch 的结果并累计行数', async () => {
    let rows = 0;
    const db = meterDatabase(DB, (read) => { rows += read; });
    assert.equal(await db.prepare('SELECT count(*) AS n FROM courses').first('n'), 3);
    assert.ok(rows >= 3);
    assert.equal(await db.prepare('SELECT id FROM courses WHERE id=?').bind(99).first(), null);
    await assert.rejects(db.prepare('SELECT id FROM courses').first('missing'));
    const before = rows;
    const [all, one] = await db.batch([
      db.prepare('SELECT id FROM courses ORDER BY id'),
      db.prepare('SELECT name FROM courses WHERE id=?').bind(2),
    ]);
    assert.deepEqual(all.results.map((row) => row.id), [1, 2, 3]);
    assert.equal(one.results[0].name, '课程2');
    assert.ok(rows > before);
  });

  await t.test('轻量读取只扣估算，热门评价按实际行数补记差额', async () => {
    const calls = [];
    const env = {
      ...visitorEnv(platform),
      PUBLIC_DATA_LIMITER: { limit: async () => ({ success: true }) },
      QUOTA_GUARD: {
        idFromName: (name) => name,
        get: () => ({ fetch: async (url, init) => {
          calls.push({ path: new URL(url).pathname, ...JSON.parse(init.body) });
          return new Response(null, { status: 204 });
        } }),
      },
    };
    const get = (path) => app.request('https://example.test' + path, {
      headers: { 'CF-Connecting-IP': '192.0.2.10' },
    }, env);
    assert.equal((await get('/api/courses/2?view=page')).status, 200);
    assert.deepEqual(calls.map((call) => [call.path, call.operation]), [['/quota', 'content']]);
    calls.length = 0;
    assert.equal((await get('/api/courses/1/reviews?sort=helpful')).status, 200);
    assert.deepEqual(calls.map((call) => call.path), ['/quota', '/charge']);
    assert.equal(calls[1].operation, 'content');
    assert.equal(calls[1].network, calls[0].network);
    assert.ok(calls[1].units > 100, `charged ${calls[1].units} extra rows`);
  });

  await t.test('匿名评价页命中缓存不访问数据库，本人视图不用缓存，提交后清除首页缓存', async (t) => {
    const store = new Map();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'caches');
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { default: {
        match: async (key) => store.get(key)?.clone(),
        put: async (key, response) => void store.set(key, response.clone()),
        delete: async (key) => store.delete(key),
      } },
    });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, 'caches', original);
      else delete globalThis.caches;
    });
    const env = visitorEnv(platform);
    const offline = {
      ...env,
      DB: { prepare() { throw new Error('Unexpected database access'); }, batch() { throw new Error('Unexpected database access'); } },
    };
    const first = await app.request('/api/courses/3/reviews', {}, env);
    assert.equal(first.status, 200);
    const page = await first.json();
    assert.equal(page.summary.count, 0);
    const cached = await app.request('/api/courses/3/reviews?offset=0', {}, offline);
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await cached.json(), page);
    // Only the anonymous first page was stored; invalid queries still reach validation.
    assert.equal(store.size, 1);
    assert.equal((await app.request('/api/courses/3/reviews?sort=bad', {}, env)).status, 400);

    const cookie = await issueCookie(env);
    const mine = (path, init = {}) =>
      app.request(path, { ...init, headers: { Cookie: cookie, ...init.headers } }, env);
    const posted = await mine('/api/courses/3/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: randomUUID(), rating: 4, body: '缓存后提交' }),
    });
    assert.equal(posted.status, 202);
    const own = await (await mine('/api/courses/3/reviews')).json();
    assert.equal(own.myReview.body, '缓存后提交');
    const fresh = await (await app.request('/api/courses/3/reviews', {}, env)).json();
    assert.equal(fresh.summary.count, 1);
    assert.equal(fresh.myReview, null);
  });
});
