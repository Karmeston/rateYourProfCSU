import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';

test('独立教师与课程浏览 API（临时 D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(new URL(file, migrations), 'utf8');
    for (const statement of sql.split(';').filter((part) => part.trim())) await DB.prepare(statement).run();
  }
  // 无授课关系、无学期，也可以建立和浏览这两类资料。
  for (const [id, name] of [[1, '同名教师'], [2, '同名教师']]) {
    await DB.prepare('INSERT INTO teachers (id, name, department) VALUES (?, ?, ?)').bind(id, name, '测试学院').run();
  }
  await DB.prepare('UPDATE teachers SET profile_url = ? WHERE id = ?').bind('https://faculty.csu.edu.cn/example/', 1).run();
  for (const [id, name] of [[1, '数学分析'], [2, '概率论']]) {
    await DB.prepare('INSERT INTO courses (id, name, department) VALUES (?, ?, ?)').bind(id, name, '测试学院').run();
  }
  const request = (path) => app.request(path, {}, platform.env);

  await t.test('两类列表均可分页，同名教师保留独立 ID', async () => {
    for (const kind of ['teachers', 'courses']) {
      const first = await request(`/api/${kind}?limit=1`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('Cache-Control'), 'private, max-age=60');
      const a = await first.json();
      const b = await (await request(`/api/${kind}?limit=1&offset=1`)).json();
      assert.equal(a[kind].length, 1);
      assert.equal(a.hasMore, true);
      assert.equal(b.hasMore, false);
      assert.notEqual(a[kind][0].id, b[kind][0].id);
    }
  });

  await t.test('独立详情不需要学期或授课记录，返回官网链接', async () => {
    const teacher = await (await request('/api/teachers/1')).json();
    assert.equal(teacher.teacher.profile_url, 'https://faculty.csu.edu.cn/example/');
    assert.deepEqual(Object.keys(teacher), ['teacher']);
    const course = await (await request('/api/courses/1')).json();
    assert.equal(course.course.name, '数学分析');
    assert.deepEqual(Object.keys(course), ['course']);
    for (const table of ['terms', 'course_offerings']) {
      assert.equal((await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
    }
    assert.equal((await request('/api/courses/1/offerings')).status, 404);
  });

  await t.test('搜索按字面匹配，注入字符串与通配符不扩大结果', async () => {
    const found = await (await request('/api/courses?q=' + encodeURIComponent('数学'))).json();
    assert.deepEqual(found.courses.map((row) => row.name), ['数学分析']);
    for (const kind of ['teachers', 'courses']) {
      for (const q of ["' OR 1=1 --", '%', '_', '不存在']) {
        const response = await request(`/api/${kind}?q=${encodeURIComponent(q)}`);
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json())[kind], []);
      }
    }
  });

  await t.test('拒绝非法参数，不存在的详情返回 404', async () => {
    for (const kind of ['teachers', 'courses']) {
      for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'offset=100001', 'limit=', 'limit=1&limit=2', 'q=a&q=b', 'q=' + 'a'.repeat(101), 'other=x']) {
        assert.equal((await request(`/api/${kind}?${query}`)).status, 400);
      }
      for (const id of ['0', '1.5', 'abc', '9007199254740992', '1%20OR%201=1']) {
        assert.equal((await request(`/api/${kind}/${id}`)).status, 400);
      }
      assert.equal((await request(`/api/${kind}/1?term=2026`)).status, 400);
      const missing = await request(`/api/${kind}/999`);
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get('Cache-Control'), null);
      assert.equal((await app.request(`/api/${kind}`, { method: 'POST' }, platform.env)).status, 404);
    }
  });

  await t.test('数据库故障不泄露 SQL、不缓存错误', async () => {
    t.mock.method(console, 'error', () => {});
    for (const kind of ['teachers', 'courses']) {
      const response = await app.request(`/api/${kind}`, {}, {
        DB: { prepare() { throw new Error('private SQL details'); } },
      });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('Cache-Control'), null);
      assert.deepEqual(await response.json(), { error: '服务暂时不可用，请稍后重试' });
    }
  });
});
