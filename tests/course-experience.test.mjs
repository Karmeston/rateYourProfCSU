import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { catalogHref, parseRoute } from '../web/routing.ts';
import { readDraft } from '../web/review-draft.ts';

test('课程发现与评价筛选（独立临时 D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    for (const sql of readFileSync(new URL(name, migrations), 'utf8')
      .split(';')
      .filter((sql) => sql.trim()))
      await DB.prepare(sql).run();
  }
  for (const [id, name, code, department, category, listed] of [
    [1, '数学分析', 'MATH-101', '数学学院', 'major', 1],
    [2, '艺术导论', 'ART-102', '艺术学院', 'elective', 1],
    [3, '高等代数（Python）', 'MATH-103', '数学学院', 'major', 1],
    [4, '退出目录', 'OLD-104', '隐藏学院', 'elective', 0],
  ])
    await DB.prepare(
      'INSERT INTO courses (id, name, code, department, category, is_listed) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, name, code, department, category, listed)
      .run();
  for (const [id, course, rating, status, date] of [
    ['a', 1, 3, 'published', '2026-10-01T00:00:00.000Z'],
    ['b', 1, 5, 'published', '2026-10-02T00:00:00.000Z'],
    ['c', 2, 5, 'published', '2026-10-03T00:00:00.000Z'],
    ['d', 1, 1, 'pending', '2026-10-04T00:00:00.000Z'],
    ['e', 4, 5, 'published', '2026-10-05T00:00:00.000Z'],
  ])
    await DB.prepare(
      'INSERT INTO course_reviews (id, course_id, rating, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, course, rating, '测试课堂体验', status, date)
      .run();
  const request = (path) => app.request(path, {}, platform.env);
  const get = async (path) => {
    const response = await request(path);
    assert.equal(response.status, 200);
    return response.json();
  };

  await t.test('名称/代码搜索、学院与类型可以组合；总数独立于分页', async () => {
    const query = new URLSearchParams({
      q: 'math-',
      department: '数学学院',
      category: 'major',
      limit: '1',
      sort: 'reviews',
    });
    const first = await get(`/api/courses?${query}`);
    assert.equal(first.total, 2);
    assert.equal(first.hasMore, true);
    assert.deepEqual(
      first.courses.map((course) => course.id),
      [1],
    );
    query.set('offset', '1');
    const second = await get(`/api/courses?${query}`);
    assert.equal(second.total, 2);
    assert.equal(second.hasMore, false);
    assert.deepEqual(
      second.courses.map((course) => course.id),
      [3],
    );
    assert.deepEqual(first.facets.departments, [
      { name: '数学学院', count: 2 },
      { name: '艺术学院', count: 1 },
    ]);
    assert.deepEqual(first.stats, { courseCount: 3, reviewCount: 3, reviewedCourseCount: 2 });
    query.set('department', '艺术学院');
    assert.equal((await get(`/api/courses?${query}`)).total, 0);
    assert.deepEqual((await get('/api/courses?q=python')).courses.map(course => course.id), [3]);
  });

  await t.test('排序使用公开评价，并把无评分课程放在评分列表末尾', async () => {
    assert.deepEqual(
      (await get('/api/courses?sort=rating')).courses.map((course) => course.id),
      [2, 1, 3],
    );
    assert.deepEqual(
      (await get('/api/courses?sort=reviews')).courses.map((course) => course.id),
      [1, 2, 3],
    );
    const page = await get('/api/courses?sort=name');
    assert.equal(page.courses.length, 3);
    assert.equal(page.courses.find((course) => course.id === 1).average, 4);
    assert.equal(page.courses.find((course) => course.id === 3).average, null);
  });

  await t.test('收藏查询不重复、不泄露隐藏课程，仍可搜索和筛选', async () => {
    const saved = await get('/api/courses?ids=1,1,2,4,999&sort=rating');
    assert.deepEqual(
      saved.courses.map((course) => course.id),
      [2, 1],
    );
    assert.equal(saved.total, 2);
    assert.deepEqual(
      (await get('/api/courses?ids=1,2&category=elective')).courses.map((course) => course.id),
      [2],
    );
    assert.equal((await get('/api/courses?ids=999')).total, 0);
  });

  await t.test('拒绝任意排序 SQL、重复参数、非法收藏及学院输入', async () => {
    for (const query of [
      'sort=average%20DESC',
      'sort=__proto__',
      'sort=rating&sort=name',
      'department=',
      'department=%00',
      'department=a&department=b',
      'ids=',
      'ids=0',
      'ids=1,',
      'ids=9007199254740992',
      'ids=1&ids=2',
      `ids=${Array(101).fill('1').join(',')}`,
    ]) {
      assert.equal((await request(`/api/courses?${query}`)).status, 400, query);
    }
  });

  await t.test('星级筛选只筛列表；总分、星级分布不随筛选变化', async () => {
    const all = await get('/api/courses/1/reviews');
    const filtered = await get('/api/courses/1/reviews?rating=3');
    assert.deepEqual(filtered.summary, all.summary);
    assert.equal(filtered.total, 1);
    assert.deepEqual(
      filtered.reviews.map((review) => review.id),
      ['a'],
    );
    const empty = await get('/api/courses/1/reviews?rating=1');
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.reviews, []);
    assert.deepEqual(empty.summary, all.summary);
  });

  await t.test('赞同排序由投票决定，平票保持确定的时间与 ID 顺序', async () => {
    await DB.prepare(
      'INSERT INTO course_review_votes (review_id, voter_id, value) VALUES (?, ?, ?)',
    )
      .bind('a', randomUUID(), 1)
      .run();
    assert.deepEqual(
      (await get('/api/courses/1/reviews?sort=latest')).reviews.map((review) => review.id),
      ['b', 'a'],
    );
    assert.deepEqual(
      (await get('/api/courses/1/reviews?sort=helpful')).reviews.map((review) => review.id),
      ['a', 'b'],
    );
    for (const query of [
      'rating=0',
      'rating=6',
      'rating=',
      'rating=3&rating=5',
      'sort=likes',
      'sort=helpful&sort=latest',
    ])
      assert.equal((await request(`/api/courses/1/reviews?${query}`)).status, 400);
  });
});

test('返回课程列表保留搜索、学院、排序和页码；非法返回地址不会成为链接', () => {
  const route = parseRoute(
    '#/saved?q=数学&category=major&department=数学学院&sort=reviews&offset=20',
  );
  assert.equal(route.page, 'saved');
  const changed = parseRoute(catalogHref(route, { category: '', offset: 0 }));
  assert.equal(changed.page, 'saved');
  assert.equal(changed.q, '数学');
  assert.equal(changed.department, '数学学院');
  assert.equal(changed.sort, 'reviews');
  assert.equal(changed.offset, 0);
  const from = catalogHref(route);
  assert.equal(parseRoute(`#/courses/1?from=${encodeURIComponent(from)}`).from, from);
  for (const from of ['https://example.com', '#/guide', '#/courses/2', '#/courses?sort=bad'])
    assert.equal(parseRoute(`#/courses/1?from=${encodeURIComponent(from)}`).from, '#/');
  for (const hash of [
    '#/courses?sort=bad',
    '#/courses?q=a&q=b',
    '#/courses/0',
    '#/courses?offset=100001',
  ])
    assert.equal(parseRoute(hash).page, 'not-found');
  assert.equal(parseRoute('#/teachers/1').page, 'catalog');
});

test('评价草稿恢复同一提交 ID，拒绝损坏或超出服务端限制的草稿', () => {
  const draft = { id: randomUUID(), rating: 4, body: '未提交的课堂体验' };
  assert.deepEqual(readDraft(JSON.stringify(draft)), draft);
  assert.equal(readDraft('broken'), null);
  assert.equal(readDraft(JSON.stringify({ ...draft, rating: 6 })), null);
  assert.equal(readDraft(JSON.stringify({ ...draft, body: 'a'.repeat(2001) })), null);
  assert.equal(readDraft(JSON.stringify({ ...draft, id: 'invalid' })), null);
});
