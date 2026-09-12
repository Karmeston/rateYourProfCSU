import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';

test('星级与评论（临时 D1，不向线上写测试评价）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(new URL(name, dir), 'utf8').split(';').filter((part) => part.trim())) await DB.prepare(sql).run();
  }
  for (const table of ['teachers', 'courses']) {
    for (const id of [1, 2]) await DB.prepare(`INSERT INTO ${table} (id, name, department) VALUES (?, ?, ?)`).bind(id, '测试对象', '测试学院').run();
  }
  const request = (path, init) => app.request(path, init, platform.env);
  const submit = (kind, data, id = 1) => request(`/api/${kind}/${id}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  await t.test('新对象没有评分；零条评价不等于零分', async () => {
    for (const kind of ['teachers', 'courses']) {
      const response = await request(`/api/${kind}/1/reviews`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const data = await response.json();
      assert.equal(data.summary.average, null);
      assert.equal(data.summary.count, 0);
      assert.deepEqual(data.reviews, []);
      assert.equal(data.summary.distribution.length, 5);
      assert.ok(data.summary.distribution.every((row) => row.count === 0));
    }
  });

  await t.test('验证阶段直接发布，同编号原样重试不重复，不允许覆盖', async () => {
    for (const kind of ['teachers', 'courses']) {
      const table = kind === 'teachers' ? 'teacher_reviews' : 'course_reviews';
      const data = { id: randomUUID(), rating: 4, body: '  例题讲解清楚。  ' };
      assert.equal((await submit(kind, data)).status, 202);
      assert.equal((await submit(kind, data)).status, 202);
      const stored = await DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(data.id).first();
      assert.equal(stored.status, 'published');
      assert.equal(stored.body, '例题讲解清楚。');
      assert.ok(Number.isFinite(Date.parse(stored.created_at)));
      assert.equal((await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 1);
      assert.equal((await submit(kind, { ...data, rating: 1 })).status, 409);
      assert.equal((await submit(kind, data, 2)).status, 409);
      const visible = await (await request(`/api/${kind}/1/reviews`)).json();
      assert.equal(visible.summary.count, 1);
      assert.equal(visible.summary.average, 4);
      assert.equal(visible.reviews[0].body, '例题讲解清楚。');
      // 后续统计用例仍覆盖待审核内容不可见的约束。
      await DB.prepare(`UPDATE ${table} SET status='pending' WHERE id=?`).bind(data.id).run();
    }
  });

  await t.test('只统计已公开评价，教师和课程评分隔离，分页不改变总分', async () => {
    for (let i = 0; i < 22; i++) {
      await DB.prepare('INSERT INTO teacher_reviews (id, teacher_id, rating, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(randomUUID(), 1, i % 2 ? 3 : 5, `测试评论 ${i}`, 'published', `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`).run();
    }
    await DB.prepare('INSERT INTO teacher_reviews (id, teacher_id, rating, body, status) VALUES (?, ?, ?, ?, ?)').bind(randomUUID(), 1, 1, '不公开', 'rejected').run();
    await DB.prepare('INSERT INTO course_reviews (id, course_id, rating, body, status) VALUES (?, ?, ?, ?, ?)').bind(randomUUID(), 1, 2, '<script>alert(1)</script>', 'published').run();
    const a = await (await request('/api/teachers/1/reviews')).json();
    const b = await (await request('/api/teachers/1/reviews?offset=20')).json();
    assert.equal(a.summary.average, 4);
    assert.equal(a.summary.count, 22);
    assert.deepEqual(a.summary, b.summary);
    assert.equal(a.reviews.length, 20);
    assert.equal(b.reviews.length, 2);
    assert.equal(a.hasMore, true);
    assert.equal(b.hasMore, false);
    assert.equal(new Set([...a.reviews, ...b.reviews].map((row) => row.id)).size, 22);
    assert.equal(a.reviews[0].body, '测试评论 21');
    assert.ok(a.reviews.every((row) => !('status' in row) && !('teacher_id' in row)));
    const course = await (await request('/api/courses/1/reviews')).json();
    assert.equal(course.summary.average, 2);
    assert.equal(course.summary.count, 1);
    assert.equal(course.reviews[0].body, '<script>alert(1)</script>');
    assert.equal((await (await request('/api/teachers/2/reviews')).json()).summary.count, 0);
  });

  await t.test('服务端拒绝非法星级、正文、审核状态、对象和跨站提交', async () => {
    for (const kind of ['teachers', 'courses']) {
      const good = { id: randomUUID(), rating: 5, body: '测试正文' };
      for (const invalid of [null, [], {}, { ...good, rating: 0 }, { ...good, rating: 6 }, { ...good, rating: 2.5 }, { ...good, rating: '5' }, { ...good, body: '  ' }, { ...good, body: 'a'.repeat(2001) }, { ...good, body: '\0' }, { ...good, status: 'published' }, { ...good, id: 'bad' }]) {
        assert.equal((await submit(kind, invalid)).status, 400);
      }
      assert.equal((await submit(kind, good, 999)).status, 404);
      assert.equal((await submit(kind, good, '1%20OR%201=1')).status, 400);
      for (const suffix of ['?offset=-1', '?offset=100001', '?offset=0&offset=20', '?offset=1.5', '?q=x']) assert.equal((await request(`/api/${kind}/1/reviews${suffix}`)).status, 400);
      assert.equal((await request(`/api/${kind}/999/reviews`)).status, 404);
      assert.equal((await request(`/api/${kind}/1/reviews`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(good) })).status, 415);
      assert.equal((await request(`/api/${kind}/1/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify(good) })).status, 403);
      assert.equal((await request(`/api/${kind}/1/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
      assert.equal((await request(`/api/${kind}/1/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'a'.repeat(9000) })).status, 413);
    }
  });

  await t.test('退出目录的课程不能读取或提交评价', async () => {
    await DB.prepare('UPDATE courses SET is_listed=0 WHERE id=?').bind(2).run();
    assert.equal((await request('/api/courses/2/reviews')).status, 404);
    assert.equal((await submit('courses', { id: randomUUID(), rating: 5, body: '不应写入' }, 2)).status, 404);
  });

  await t.test('数据库同样约束星级、正文与外键', async () => {
    const insert = (target, rating, body) => DB.prepare('INSERT INTO teacher_reviews (id, teacher_id, rating, body) VALUES (?, ?, ?, ?)').bind(randomUUID(), target, rating, body).run();
    await assert.rejects(insert(1, 0, '正文'));
    await assert.rejects(insert(1, 2.5, '正文'));
    await assert.rejects(insert(1, 5, ''));
    await assert.rejects(insert(999, 5, '正文'));
  });
});
