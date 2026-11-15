import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readPublicDirectory } from '../scripts/prepare-public-directory.mjs';
import { openDirectory, searchDirectory } from '../shared/course-directory.ts';
import { defaultFilters } from '../web/routing.ts';

test('静态目录保留真实课程编号和方案版本，筛选及分页不依赖服务接口', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url), 'utf8'));
  const directory = openDirectory(snapshot);
  const program = { ...defaultFilters, program: '计算机科学与技术', planYear: '2026' };
  const first = searchDirectory(directory, program, 24);
  const second = searchDirectory(directory, { ...program, offset: 24 }, 24);
  assert.equal(first.total, 71);
  assert.equal(first.courses.length, 24);
  assert.equal(second.courses.length, 24);
  assert.ok(first.courses.every(({ id }) => !second.courses.some((item) => item.id === id)));
  assert.ok(first.courses.some((item) => item.category === null));
  const result = searchDirectory(directory, { ...program, q: '高级英语' }, 24);
  assert.ok(result.courses.some(({ id, name }) => id === 3634 && name === '高级英语（一）'));
  assert.deepEqual(searchDirectory(directory, { ...program, planYear: '2099' }, 24).courses, []);
  const [a, b] = first.courses;
  const ratings = [[a.id, 5, 1], [b.id, 4, 2]];
  assert.equal(searchDirectory(directory, { ...program, sort: 'rating' }, 24, ratings).courses[0].id, a.id);
  assert.equal(searchDirectory(directory, { ...program, sort: 'reviews' }, 24, ratings).courses[0].id, b.id);
});

test('公开快照过滤隐藏课程，不包含来源记录和用户内容', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter((entry) => entry.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  db.exec(`INSERT INTO courses(id,name,code,department,category,is_listed)
    VALUES (14,'公开测试','MATH-A','数学学院',NULL,1),(15,'隐藏课程','MATH-B','数学学院',NULL,0);
    INSERT INTO course_reviews(id,course_id,rating,body,status) VALUES ('test',14,5,'评价正文','published');`);
  const insert = db.prepare(`INSERT INTO course_catalog_records
    (source_sha256,source_sequence,course_id,source_type,source_date,source_url,source_label,program,source_year)
    VALUES (?, ?, ?, 'curriculum', '2026-11-14','http://csujwc.its.csu.edu.cn/test','来源标题','数学',?)`);
  insert.run('a'.repeat(64), 1, 14, null);
  insert.run('a'.repeat(64), 2, 14, null);
  insert.run('a'.repeat(64), 3, 15, 2026);
  const snapshot = readPublicDirectory(db);
  assert.deepEqual(snapshot.courses, [[14, '公开测试', 'MATH-A', 0, null, null]]);
  assert.deepEqual(snapshot.programs, [['数学', [[null, [14]]]]]);
  for (const privateField of ['隐藏课程','评价正文','来源标题','csujwc'])
    assert.ok(!JSON.stringify(snapshot).includes(privateField));
  const directory = openDirectory(snapshot);
  assert.equal(searchDirectory(directory, { ...defaultFilters, program: '数学', planYear: 'unknown', q: 'math-a' }, 24).total, 1);
});
