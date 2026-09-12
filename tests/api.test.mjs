import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';

test('只读浏览 API（独立的临时 D1，不修改开发数据库）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  for (const file of ['../migrations/0001_core.sql', '../seeds/local.sql']) {
    const sql = readFileSync(new URL(file, import.meta.url), 'utf8');
    // 当前迁移与 seed 均无字符串内分号或触发器；逐语句交给真实本地 D1。
    for (const statement of sql.split(';').filter((part) => part.trim())) {
      await DB.prepare(statement).run();
    }
  }
  const request = (path) => app.request(path, {}, platform.env);

  await t.test('课程分页不重复，标记是否还有下一页', async () => {
    const first = await request('/api/courses?limit=1');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('Cache-Control'), 'private, max-age=60');
    const a = await first.json();
    const b = await (await request('/api/courses?limit=1&offset=1')).json();
    assert.equal(a.courses.length, 1);
    assert.equal(a.hasMore, true);
    assert.equal(b.hasMore, false);
    assert.notEqual(a.courses[0].id, b.courses[0].id);
    assert.deepEqual((await (await request('/api/courses?offset=100')).json()).courses, []);
  });

  await t.test('授课记录保留跨学期与不同教师，按新学期优先排列', async () => {
    const response = await request('/api/courses/-1/offerings');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=60');
    const body = await response.json();
    assert.equal(body.course.id, -1);
    assert.equal(body.offerings.length, 3);
    assert.deepEqual(body.offerings.map((row) => row.start_year), [2026, 2026, 2025]);
    assert.equal(new Set(body.offerings.map((row) => row.teacher_id)).size, 2);
    const page = await (await request('/api/courses/-1/offerings?limit=1&offset=2')).json();
    assert.equal(page.offerings[0].start_year, 2025);
    assert.equal(page.hasMore, false);
  });

  await t.test('不存在的课程与无授课记录的课程可区分', async () => {
    const missing = await request('/api/courses/999/offerings');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('Cache-Control'), null);
    await DB.prepare('INSERT INTO courses (id, name, department) VALUES (?, ?, ?)').bind(100, '空课程', '测试学院').run();
    const response = await request('/api/courses/100/offerings');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).offerings, []);
  });

  await t.test('拒绝非法、重复及未知参数，包括 SQL 注入形式', async () => {
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'offset=100001', 'limit=', 'limit=1&limit=2', 'q=test', 'offset=1%20OR%201=1']) {
      for (const path of ['/api/courses', '/api/courses/-1/offerings']) {
        assert.equal((await request(`${path}?${query}`)).status, 400, `${path}?${query}`);
      }
    }
    for (const id of ['0', '1.5', 'abc', '9007199254740992', '1%20OR%201=1']) {
      assert.equal((await request(`/api/courses/${id}/offerings`)).status, 400);
    }
  });

  await t.test('无写入路由，数据库错误不向客户端暴露 SQL', async () => {
    assert.equal((await app.request('/api/courses', { method: 'POST' }, platform.env)).status, 404);
    const original = console.error;
    t.mock.method(console, 'error', () => {});
    try {
      const response = await app.request('/api/courses', {}, {
        DB: { prepare() { throw new Error('private SQL details'); } },
      });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('Cache-Control'), null);
      assert.deepEqual(await response.json(), { error: '服务暂时不可用，请稍后重试' });
    } finally {
      console.error = original;
    }
  });
});
