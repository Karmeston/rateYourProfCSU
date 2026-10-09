import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { importMajorCatalog, majorCatalog } from '../scripts/import-major-catalog.mjs';
import { migrate } from './helpers/database.mjs';

test('专业课交叉目录导入与来源展示（临时D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  await DB.prepare("INSERT INTO courses (id, name, department, category) VALUES (-1, '演示', '演示学院', 'major')").run();
  const first = majorCatalog.courses[0];
  await DB.prepare("INSERT INTO courses (id, code, name, department, category) VALUES (5, ?, '不同课程', '已核实开课学院', 'major')").bind(first.code).run();

  await t.test('同码异名及来源不完整均在任何写入前中止', async () => {
    await assert.rejects(importMajorCatalog(DB), /已被不同资料占用/);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses').first()).n, 2);
    await DB.prepare('UPDATE courses SET name = ? WHERE id = 5').bind(first.name).run();
    const invalid = structuredClone(majorCatalog);
    invalid.courses[1].materials = invalid.courses[1].materials.filter((record) => invalid.sources[record.source_id].kind !== 'major_syllabus');
    await assert.rejects(importMajorCatalog(DB, invalid), /缺少大纲与培养方案/);
    invalid.courses[1].materials = structuredClone(majorCatalog.courses[1].materials);
    invalid.sources[invalid.courses[1].materials[0].source_id].url = 'https://example.com/fake';
    await assert.rejects(importMajorCatalog(DB, invalid), /来源/);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM course_materials').first()).n, 0);
  });

  await t.test('批量新增正编号课程，保留已有编号、开课学院、评价和隐藏状态', async () => {
    const review = randomUUID();
    await DB.prepare("INSERT INTO course_reviews (id, course_id, rating, body, status) VALUES (?, 5, 5, '已有评价', 'published')").bind(review).run();
    await DB.prepare('UPDATE courses SET is_listed = 0 WHERE id = 5').run();
    const result = await importMajorCatalog(DB);
    assert.equal(result.insertedCourses, majorCatalog.courses.length - 1);
    assert.equal(result.insertedMaterials, majorCatalog.courses.reduce((total, course) => total + course.materials.length, 0));
    assert.deepEqual(result.skipped, []);
    const stored = await DB.prepare('SELECT id, department, is_listed FROM courses WHERE code = ?').bind(first.code).first();
    assert.deepEqual(stored, { id: 5, department: '已核实开课学院', is_listed: 0 });
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM course_reviews WHERE id = ?').bind(review).first()).n, 1);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses WHERE code IS NOT NULL AND id <= 0').first()).n, 0);
    assert.equal((await app.request('/api/courses/5', {}, platform.env)).status, 404);
  });

  await t.test('可查数据结构，多代码同名分别保留，学分和版本有原表定位', async () => {
    const response = await app.request('/api/courses?category=major&q=' + encodeURIComponent('数据结构'), {}, platform.env);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(page.total >= 2);
    assert.ok(page.courses.every((course) => course.departmentSourceYear === 2016));
    assert.equal(new Set(page.courses.map((course) => course.code)).size, page.courses.length);
    const course = page.courses.find((course) => course.code === '090163X10');
    const detail = await (await app.request(`/api/courses/${course.id}`, {}, platform.env)).json();
    assert.equal(detail.course.elective, null);
    const record = detail.course.materials.find((source) => source.sourceYear === 2023 && source.sourceLocator === 'PDF第5页，表1第30行');
    assert.equal(record.credits, 3.5);
    assert.equal(record.requirement, '必修');
    assert.equal(record.department, '自动化学院');
    assert.match(record.sourceUrl, /^https:\/\/.*\.csu\.edu\.cn\//);
  });

  await t.test('重跑不重复写入，既有资料冲突不会覆盖', async () => {
    const result = await importMajorCatalog(DB);
    assert.equal(result.insertedCourses, 0);
    assert.equal(result.insertedMaterials, 0);
    await DB.prepare("UPDATE course_materials SET source_locator = '人工核对的新定位' WHERE course_id = 5").run();
    await assert.rejects(importMajorCatalog(DB), /既有来源资料存在冲突/);
    assert.equal((await DB.prepare('SELECT source_locator FROM course_materials WHERE course_id = 5 LIMIT 1').first()).source_locator, '人工核对的新定位');
  });
});

test('已有无代码同名记录不自动合并或另建同名课程', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  const first = majorCatalog.courses[0];
  await DB.prepare("INSERT INTO courses (id, name, department, category) VALUES (1, ?, '待核实', 'major')").bind(first.name).run();
  const subset = { ...majorCatalog, courses: [first] };
  const result = await importMajorCatalog(DB, subset);
  assert.equal(result.insertedCourses, 0);
  assert.equal(result.insertedMaterials, 0);
  assert.equal(result.skipped[0].code, first.code);
  assert.equal((await DB.prepare('SELECT code FROM courses WHERE id = 1').first()).code, null);
});
