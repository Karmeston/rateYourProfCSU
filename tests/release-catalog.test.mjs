import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { prepareCatalogSql } from '../scripts/prepare-release-catalog.mjs';
import { majorCatalog } from '../scripts/import-major-catalog.mjs';
import { electiveCatalog } from '../scripts/import-elective-catalog.mjs';

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(new URL(name, directory), 'utf8'));
  db.exec(
    "INSERT INTO courses(id,name,department,category) VALUES(5,'旧课程','已核实学院','major'); INSERT INTO course_reviews(id,course_id,rating,body,status) VALUES('legacy',5,4,'已有评价','published')",
  );
  return db;
}

test('发行SQL仅新增，规划不改快照，SQLite展开引号、问号和Unicode后可重放', async (t) => {
  const db = database(t),
    major = structuredClone(majorCatalog);
  major.courses = [major.courses[0]];
  major.courses[0].name = "引号'问号?; 课程";
  for (const material of major.courses[0].materials) material.name = major.courses[0].name;
  const { sql, report } = await prepareCatalogSql(db, { major, elective: electiveCatalog });
  assert.equal(db.prepare('SELECT count(*) AS n FROM courses').get().n, 1);
  assert.equal(report.major.insertedCourses, 1);
  assert.equal(report.elective.insertedCourses, 18);
  db.exec(sql);
  assert.equal(
    db.prepare('SELECT name FROM courses WHERE code=?').get(major.courses[0].code).name,
    major.courses[0].name,
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM courses').get().n, report.counts.total);
  assert.deepEqual(
    { ...db.prepare('SELECT course_id,rating,body,status FROM course_reviews').get() },
    { course_id: 5, rating: 4, body: '已有评价', status: 'published' },
  );
  assert.equal(
    db.prepare('SELECT department FROM courses WHERE id=5').get().department,
    '已核实学院',
  );
  const repeated = await prepareCatalogSql(db, { major, elective: electiveCatalog });
  assert.equal(repeated.report.major.insertedCourses, 0);
  assert.equal(repeated.report.elective.insertedCourses, 0);
});

test('发行目录发现同码冲突时回滚全部规划写入，不遗留先规划的MOOC', async (t) => {
  const db = database(t),
    major = { ...majorCatalog, courses: [majorCatalog.courses[0]] };
  db.prepare('UPDATE courses SET code=? WHERE id=5').run(major.courses[0].code);
  await assert.rejects(
    prepareCatalogSql(db, { major, elective: electiveCatalog }),
    /已被不同资料占用/,
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM courses').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM elective_course_facts').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM course_reviews').get().n, 1);
});
