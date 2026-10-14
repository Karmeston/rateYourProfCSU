import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import app from '../src/index.ts';
import { setupCommunity } from './helpers/community.mjs';
import { trafficDay, pruneTraffic } from '../src/traffic.ts';
import { overview } from '../src/admin-overview.ts';
import { parseRoute } from '../web/routing.ts';
import { recordPageView } from '../web/traffic.ts';

test('客户端统计尊重DNT，排除管理与错误页面，后备上报沿用同一事件且不包含搜索词', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  t.after(() => {
    Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    globalThis.fetch = originalFetch;
  });
  const events = [],
    fallbacks = [];
  const browser = {
    doNotTrack: '1',
    sendBeacon: (url, body) => {
      events.push({ url, body });
      return false;
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser });
  globalThis.fetch = async (url, options) => {
    fallbacks.push({ url, options });
    return new Response(null, { status: 204 });
  };
  recordPageView(parseRoute('#/courses?q=private-search'));
  assert.equal(events.length, 0);
  browser.doNotTrack = '0';
  recordPageView(parseRoute('#/admin'));
  recordPageView(parseRoute('#/missing'));
  assert.equal(events.length, 0);
  recordPageView(parseRoute('#/courses?q=private-search'));
  assert.equal(events.length, 1);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].options.body, events[0].body);
  assert.equal(fallbacks[0].options.credentials, 'omit');
  assert.equal(fallbacks[0].options.keepalive, true);
  const value = JSON.parse(await events[0].body.text());
  assert.deepEqual(Object.keys(value).sort(), ['id', 'page', 'targetId']);
  assert.equal(value.page, 'catalog');
  assert.equal(value.targetId, 0);
});

test('PV按北京时间汇总且重复上报不累加，不接受查询内容或隐藏课程', async (t) => {
  const { db } = await setupCommunity(t);
  const env = {
    DB: db,
    VISITOR_SECRET: 'synthetic-test-secret-at-least-32-characters',
    TRAFFIC_LIMITER: { limit: async () => ({ success: true }) },
  };
  const request = (data) =>
    app.request(
      '/api/traffic',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      env,
    );
  const event = { id: randomUUID(), page: 'catalog', targetId: 0 };
  const responses = await Promise.all([request(event), request(event)]);
  assert.ok(responses.every((response) => response.status === 204));
  assert.equal((await db.prepare('SELECT views FROM traffic_daily').first()).views, 1);
  await request({ id: randomUUID(), page: 'course', targetId: 1 });
  const stats = await overview(db, 7);
  assert.equal(stats.views, 2);
  assert.equal(stats.todayViews, 2);
  assert.equal(stats.daily.length, 7);
  assert.equal(stats.popularCourses[0].id, 1);
  assert.equal(stats.popularCourses[0].views, 1);
  assert.equal((await request({ ...event, id: randomUUID(), q: 'private search' })).status, 400);
  assert.equal((await request({ ...event, id: randomUUID(), page: 'admin' })).status, 400);
  await db.prepare('UPDATE courses SET is_listed=0 WHERE id=1').run();
  assert.equal((await request({ id: randomUUID(), page: 'course', targetId: 1 })).status, 404);
  env.TRAFFIC_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await request({ ...event, id: randomUUID() })).status, 429);
  assert.equal(trafficDay(Date.parse('2026-10-14T16:01:00Z')), '2026-10-15');
  assert.equal(trafficDay(Date.parse('2026-10-14T15:59:00Z')), '2026-10-14');
  assert.equal(parseRoute('#/admin').page, 'admin');
});

test('统计清理只移除过期汇总、短期去重标记和过期管理会话', async (t) => {
  const { db } = await setupCommunity(t),
    now = Date.parse('2026-10-14T04:00:00Z');
  for (const offset of [0, 1, 2])
    await db
      .prepare('INSERT INTO traffic_receipts(id,day,token) VALUES(?,?,?)')
      .bind(randomUUID(), trafficDay(now, offset), randomUUID())
      .run();
  for (const offset of [0, 179, 180])
    await db
      .prepare("INSERT INTO traffic_daily(day,page,target_id,views) VALUES(?,'catalog',0,1)")
      .bind(trafficDay(now, offset))
      .run();
  for (const expiry of [Math.floor(now / 1000), Math.floor(now / 1000) + 1])
    await db
      .prepare('INSERT INTO admin_sessions(id,expires_at) VALUES(?,?)')
      .bind(randomUUID(), expiry)
      .run();
  await pruneTraffic(db, now);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM traffic_receipts').first()).n, 2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM traffic_daily').first()).n, 2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM admin_sessions').first()).n, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM courses').first()).n, 2);
});
