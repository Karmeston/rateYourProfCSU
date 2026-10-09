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
    for (const course of page.courses) {
      const material = majorCatalog.courses.find((item) => item.code === course.code);
      const years = material.materials.filter((record) =>
        majorCatalog.sources[record.source_id].kind === 'major_syllabus'
        && majorCatalog.sources[record.source_id].department === course.department)
        .map((record) => majorCatalog.sources[record.source_id].year);
      assert.equal(course.departmentSourceYear, Math.max(...years));
    }
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

  await t.test('合并方案按专业与班型保留证据，2025生物方案不覆盖旧方案学分', async () => {
    const find = async (code) => {
      const course = await DB.prepare('SELECT id FROM courses WHERE code = ?').bind(code).first();
      return (await (await app.request(`/api/courses/${course.id}`, {}, platform.env)).json()).course.materials;
    };
    const minerals = await find('010102Z10');
    const tracks = minerals.filter((record) => record.sourceYear === 2023 && record.sourceUrl.includes('/7241.htm'));
    assert.deepEqual(new Set(tracks.map((record) => record.program)), new Set(['资源勘查工程', '资源勘查工程卓越人才培养']));
    assert.ok(tracks.every((record) => record.credits === 4 && record.requirement === '必修'));
    assert.ok(tracks.some((record) => record.sourceLocator === 'PDF第35页，表1第24行'));
    const biology = await find('030409Z10');
    assert.ok(biology.some((record) => record.program === '生物科学' && record.sourceYear === 2025 && record.credits === 2 && record.requirement === '选修'));
    assert.ok(biology.some((record) => record.program === '生物技术' && record.sourceYear === 2023 && record.requirement === '必修'));
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

test('大纲无类别时必须有近期方案的明确课程类别证据', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  const course = majorCatalog.courses.find((item) => item.materials.some((record) =>
    majorCatalog.sources[record.source_id].kind === 'major_syllabus' && record.category_raw === null));
  assert.ok(course);
  const subset = { ...majorCatalog, courses: [structuredClone(course)] };
  for (const record of subset.courses[0].materials) record.category_raw = null;
  await assert.rejects(importMajorCatalog(DB, subset), /大纲没有明确/);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses').first()).n, 0);
  subset.courses[0] = structuredClone(course);
  const result = await importMajorCatalog(DB, subset);
  assert.equal(result.insertedCourses, 1);
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
