import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { academicCatalog, importAcademicCatalog } from '../scripts/import-academic-catalog.mjs';
import {
  latestAcademicPlans,
  prepareAcademicCatalog,
} from '../scripts/prepare-academic-catalog.mjs';
import { catalogHref, parseRoute } from '../web/routing.ts';
import { migrate } from './helpers/database.mjs';
import { planVersionLabel } from '../shared/catalog.ts';

const read = (file) =>
  JSON.parse(readFileSync(new URL('../data/course-data/' + file, import.meta.url), 'utf8'));
const input = 'pending/academic-20261018/';

test('教务数据按正式类别证据收录，冲突整组留待核对，采集时间不充当版本', () => {
  const { catalog, report } = prepareAcademicCatalog({
    syllabus: read(input + 'academic-syllabus-catalog-20261018.json'),
    curriculum: read(input + 'academic-own-plan-courses-20261018.json'),
    execution: read(input + 'academic-execution-plan-20261018.json'),
    evidence: read('course-records.json'),
  });
  assert.deepEqual(catalog, academicCatalog);
  assert.ok(report.held.some((r) => r.code === '180460ZG10' && r.reason === 'code_name_conflict'));
  assert.equal(
    catalog.courses.some((c) => c.code === '180460ZG10'),
    false,
  );
  assert.ok(
    catalog.courses.some((c) => c.category === null && c.records[0].kind === '理论课（不含实践）'),
  );
  assert.ok(
    catalog.courses.some(
      (c) =>
        c.category === 'major' && c.classification.some((p) => p.raw.startsWith('专业教育课程')),
    ),
  );
  const plans = catalog.courses.flatMap((c) => c.records.filter((r) => r.program));
  assert.ok(plans.length > 30);
  assert.ok(plans.every((r) => r.year === null));
});

test('最新方案区分主修、辅修专业和辅修学位，同年并列记录保留', () => {
  const row = (year, name) => ({
    college: '学院',
    majorCode: 'A',
    major: '统计学',
    category: '主修',
    year,
    name,
  });
  const result = latestAcademicPlans([
    row(2023, '2023版统计学本科培养方案'),
    row(2026, '2026版统计学本科培养方案'),
    row(2024, '2024版统计学本科辅修专业培养方案'),
    row(2026, '2026版统计学本科辅修专业培养方案'),
    row(2025, '2025版统计学本科辅修学位培养方案'),
    row(2025, '2025版统计学本科辅修学位培养方案（修订）'),
  ]);
  assert.equal(result.length, 4);
  assert.deepEqual(
    result.map((p) => p.role),
    ['主修', '辅修专业', '辅修学位', '辅修学位'],
  );
  assert.equal(
    result.some((p) => p.year === 2023 || p.year === 2024),
    false,
  );
});

test('教务目录完整导入、分类筛选和未标注版本的方案查询（临时D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  const preserved = academicCatalog.courses.find((c) => c.category === 'major');
  const uncoded = academicCatalog.courses.find((c) => c.name === '多元统计分析');
  await DB.prepare(
    "INSERT INTO courses(id,code,name,department,category,is_listed) VALUES(5,?,?, '已核实学院','major',0)",
  )
    .bind(preserved.code, preserved.name)
    .run();
  await DB.prepare(
    "INSERT INTO courses(id,name,department,category) VALUES(6,?,'数学学院','major')",
  )
    .bind(uncoded.name)
    .run();
  await DB.prepare(
    "INSERT INTO course_reviews(id,course_id,rating,body,status) VALUES('existing',6,5,'已有课堂体验','published')",
  ).run();
  const get = async (query) => {
    const response = await app.request(query, {}, platform.env);
    assert.equal(response.status, 200, query);
    return response.json();
  };

  await t.test('来源或分类损坏在首次写入前中止', async () => {
    const broken = structuredClone(academicCatalog);
    broken.courses.find((c) => c.category === 'major').classification = [];
    await assert.rejects(importAcademicCatalog(DB, broken), /分类依据/);
    const source = Object.values(broken.sources)[0];
    broken.courses = structuredClone(academicCatalog.courses);
    source.url = 'http://evil.example/catalog';
    await assert.rejects(importAcademicCatalog(DB, broken), /来源记录/);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses').first()).n, 2);
  });

  await t.test('全量批次保留已有ID、学院、隐藏状态及评价；无代码同名不强行合并', async () => {
    const result = await importAcademicCatalog(DB);
    assert.ok(result.insertedCourses > 4500);
    assert.ok(result.skipped.some((r) => r.name === uncoded.name));
    assert.deepEqual(
      await DB.prepare('SELECT id,department,is_listed FROM courses WHERE code=?')
        .bind(preserved.code)
        .first(),
      { id: 5, department: '已核实学院', is_listed: 0 },
    );
    assert.equal((await DB.prepare('SELECT course_id FROM course_reviews').first()).course_id, 6);
    assert.equal((await DB.prepare('SELECT code FROM courses WHERE id=6').first()).code, null);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM course_supplements').first()).n, 0);
    assert.equal((await get('/api/courses?q=' + preserved.code)).total, 0);
  });

  await t.test('重跑不增加课程或来源记录', async () => {
    const repeated = await importAcademicCatalog(DB);
    assert.equal(repeated.insertedCourses, 0);
    assert.equal(repeated.insertedRecords, 0);
  });

  await t.test('未知分类可搜索、分页和排序，不混入专业课或公选课', async () => {
    const first = await get('/api/courses?category=unknown&limit=24');
    const next = await get('/api/courses?category=unknown&limit=24&offset=24');
    assert.ok(first.total > 2000);
    assert.ok([...first.courses, ...next.courses].every((c) => c.category === null));
    assert.equal(new Set([...first.courses, ...next.courses].map((c) => c.id)).size, 48);
    const code = first.courses[0].code;
    assert.equal((await get('/api/courses?category=major&q=' + code)).total, 0);
    assert.equal((await get('/api/courses?category=elective&q=' + code)).total, 0);
    assert.equal((await get('/api/courses?category=unknown&q=' + code + '&sort=rating')).total, 1);
    const dual = academicCatalog.courses.find(
      (c) => c.code.includes('ZG') && c.name !== uncoded.name,
    );
    assert.equal((await get('/api/courses?q=' + dual.code)).courses[0].code, dual.code);
  });

  await t.test('统计学方案可筛选，未知版本保留为空，不冒充2026版', async () => {
    const base = '/api/courses?program=' + encodeURIComponent('统计学');
    const page = await get(base + '&planYear=unknown');
    assert.ok(page.total > 20);
    assert.ok(page.facets.programs.find((p) => p.name === '统计学').years.includes(null));
    assert.ok(page.courses.every((c) => c.planRecords.every((r) => r.sourceYear === null)));
    assert.equal((await get(base + '&planYear=2026')).total, 0);
    for (const query of [
      'category=unknown&program=统计学',
      'category=unknown&electiveType=unknown',
      'planYear=unknown',
    ])
      assert.equal((await app.request('/api/courses?' + query, {}, platform.env)).status, 400);
  });

  await t.test('既有来源被改动时中止，不覆盖核验结果', async () => {
    await DB.prepare(
      "UPDATE course_catalog_records SET source_label='人工核验' WHERE source_sha256=(SELECT source_sha256 FROM course_catalog_records LIMIT 1)",
    ).run();
    const count = (await DB.prepare('SELECT count(*) AS n FROM courses').first()).n;
    await assert.rejects(importAcademicCatalog(DB), /既有教务记录存在冲突/);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses').first()).n, count);
  });
});

test('类别待核实及未知方案版本的分享链接可恢复，切换分类清理隐藏筛选', () => {
  const route = parseRoute('#/courses?category=unknown&q=数学&offset=24');
  assert.equal(route.page, 'catalog');
  assert.equal(route.category, 'unknown');
  assert.equal(parseRoute(catalogHref(route)).category, 'unknown');
  const program = parseRoute('#/courses?program=统计学&planYear=unknown');
  assert.equal(program.planYear, 'unknown');
  assert.equal(planVersionLabel(program.planYear), '版本未标注');
  assert.equal(planVersionLabel(null), '版本未标注');
  assert.equal(catalogHref(program, { category: 'unknown' }), '#/courses?category=unknown');
  assert.equal(parseRoute('#/courses?category=unknown&program=统计学').page, 'not-found');
});
