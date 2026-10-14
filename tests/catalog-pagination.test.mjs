import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { migrate } from './helpers/database.mjs';

test('课程分页只返回当页方案记录，完整保留版本差异且支持最大页长', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  await migrate(db);
  const statements = [];
  for (let id = 1; id <= 125; id++) {
    statements.push(
      db
        .prepare("INSERT INTO courses(id,name,department,category) VALUES(?,?,'测试学院','major')")
        .bind(id, `课程${String(id).padStart(3, '0')}`),
    );
    for (const year of [2023, 2025]) {
      statements.push(
        db
          .prepare(
            `INSERT INTO course_materials
        (id,course_id,source_id,kind,source_year,department,program,credits,requirement,source_url,source_label,source_locator)
        VALUES(?,?,?,'curriculum',?,'测试学院','测试专业',?,'必修','https://example.edu/plan','测试方案','原表')`,
          )
          .bind(`${id}-${year}`, id, `source-${year}`, year, year === 2023 ? 3 : 4),
      );
    }
  }
  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50));
  }
  // Observe rows returned by the extra material read, not just the final JSON response.
  const reads = [];
  const statementsByWrapper = new WeakMap();
  function observe(statement) {
    const wrapper = {
      bind: (...parameters) => observe(statement.bind(...parameters)),
      async all() {
        const result = await statement.all();
        reads.push(result.results.length);
        return result;
      },
    };
    statementsByWrapper.set(wrapper, statement);
    return wrapper;
  }
  const env = {
    ...platform.env,
    DB: {
      prepare: (sql) => observe(db.prepare(sql)),
      batch: (queries) => db.batch(queries.map((query) => statementsByWrapper.get(query))),
    },
  };
  async function page(query) {
    reads.length = 0;
    const response = await app.request(`/api/courses?${query}`, {}, env);
    assert.equal(response.status, 200);
    return response.json();
  }
  const first = await page('program=测试专业&limit=20');
  assert.equal(first.total, 125);
  assert.deepEqual(first.stats, { courseCount: 125, reviewCount: 0, reviewedCourseCount: 0 });
  assert.equal(first.hasMore, true);
  assert.deepEqual(reads, [40]);
  assert.deepEqual(
    first.courses[0].planRecords.map((row) => [row.sourceYear, row.credits]),
    [
      [2025, 4],
      [2023, 3],
    ],
  );
  const next = await page('program=测试专业&limit=20&offset=20&planYear=2023');
  assert.equal(next.courses[0].id, 21);
  assert.deepEqual(reads, [20]);
  assert.equal(next.courses[0].planRecords[0].sourceYear, 2023);
  const largest = await page('program=测试专业&limit=100');
  assert.equal(largest.courses.length, 100);
  assert.deepEqual(reads, [200]);
  assert.deepEqual((await page('program=测试专业&offset=125')).courses, []);
  assert.deepEqual(reads, []);
  const unfiltered = await page('limit=20');
  assert.deepEqual(reads, []);
  assert.ok(unfiltered.courses.every((row) => !Object.hasOwn(row, 'planRecords')));
});

test('四种课程排序在分页后保持评分与来源一致，隐藏和撤回不参与排名', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  await migrate(db);
  for (const [id, name] of [
    [1, 'C'],
    [2, 'A'],
    [3, 'B'],
    [4, 'D'],
  ]) {
    await db
      .prepare("INSERT INTO courses(id,name,department) VALUES(?,?,'测试学院')")
      .bind(id, name)
      .run();
  }
  for (const [id, course, rating, status, withdrawn] of [
    ['a', 1, 3, 'published', null],
    ['b', 1, 5, 'published', null],
    ['c', 2, 5, 'published', null],
    ['d', 3, 5, 'pending', null],
    ['e', 3, 5, 'rejected', null],
    ['f', 3, 5, 'published', '2026-10-14'],
    ['g', 4, 5, 'published', null],
  ]) {
    await db
      .prepare(
        "INSERT INTO course_reviews(id,course_id,rating,body,status,withdrawn_at) VALUES(?,?,?,'测试评价',?,?)",
      )
      .bind(id, course, rating, status, withdrawn)
      .run();
  }
  await db.prepare('UPDATE courses SET is_listed=0 WHERE id=4').run();
  for (const [id, department, year] of [
    ['own', '测试学院', 2023],
    ['other', '另一学院', 2025],
  ]) {
    await db
      .prepare(
        `INSERT INTO course_materials
      (id,course_id,source_id,kind,source_year,department,source_url,source_label,source_locator)
      VALUES(?,1,?,'syllabus',?,?,'https://example.edu/syllabus','测试大纲','原表')`,
      )
      .bind(id, id, year, department)
      .run();
  }
  const expected = { default: [1, 2, 3], name: [2, 3, 1], rating: [2, 1, 3], reviews: [1, 2, 3] };
  for (const [sort, ids] of Object.entries(expected)) {
    for (let offset = 0; offset < ids.length; offset++) {
      const response = await app.request(
        `/api/courses?sort=${sort}&limit=1&offset=${offset}`,
        {},
        platform.env,
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      const course = data.courses[0];
      assert.equal(course.id, ids[offset]);
      assert.equal(course.average, { 1: 4, 2: 5, 3: null }[course.id]);
      assert.equal(course.reviewCount, { 1: 2, 2: 1, 3: 0 }[course.id]);
      assert.equal(course.departmentSourceYear, course.id === 1 ? 2023 : null);
      assert.equal(data.stats.reviewCount, 3);
      assert.equal(data.stats.reviewedCourseCount, 2);
      assert.equal(data.stats.courseCount, 3);
      assert.equal(data.hasMore, offset < 2);
    }
  }
});
