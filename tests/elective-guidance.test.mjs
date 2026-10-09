import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { academicYear, assessCreditModule, getMoocAnnualRule } from '../shared/electives.ts';
import { catalogHref, parseRoute } from '../web/routing.ts';
import { electiveCatalog, importElectiveCatalog } from '../scripts/import-elective-catalog.mjs';

const evidence = { sourceUrl: 'https://bksy.csu.edu.cn/example', sourceLabel: '测试依据', sourceLocator: '第2页' };
const rule = { ...evidence, planId: 'electrical-2025', module: 'art', outcome: 'counts', reason: '测试认定规则' };

async function migrate(db) {
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(new URL(name, migrations), 'utf8').split(';').filter((sql) => sql.trim()))
      await db.prepare(sql).run();
  }
}

test('只有负编号演示课程时，真实课程仍使用正编号且能重复导入', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  await DB.prepare("INSERT INTO courses (id, code, name, department, category) VALUES (-101, 'DEMO-101', '演示课程', '演示学院', 'elective')").run();
  assert.equal((await importElectiveCatalog(DB)).insertedCourses, 18);
  const real = await DB.prepare("SELECT id FROM courses WHERE code != 'DEMO-101'").all();
  assert.equal(real.results.length, 18);
  assert.ok(real.results.every((row) => row.id > 0));
  assert.equal((await importElectiveCatalog(DB)).insertedCourses, 0);
  assert.equal((await DB.prepare("SELECT name FROM courses WHERE id = -101").first()).name, '演示课程');
});

test('学分认定逐方案、逐模块匹配；无证据、未知方案及冲突不判为可计入', () => {
  assert.equal(assessCreditModule('electrical-2025', 'art', []).outcome, 'unknown');
  assert.equal(assessCreditModule('electrical-2025', 'art', [rule]).outcome, 'counts');
  assert.equal(assessCreditModule('electrical-2025', 'cross_discipline', [rule]).outcome, 'unknown');
  assert.equal(assessCreditModule('bioengineering-2023', 'art', [rule]).outcome, 'unknown');
  assert.equal(assessCreditModule('unlisted', 'art', [{ ...rule, planId: 'unlisted' }]).outcome, 'unknown');
  const conflicting = [rule, { ...rule, outcome: 'not_counts', sourceLocator: '院级补充说明' }];
  assert.equal(assessCreditModule('electrical-2025', 'art', conflicting).outcome, 'conflict');
  assert.equal(assessCreditModule('electrical-2025', 'art', conflicting.reverse()).outcome, 'conflict');
  assert.equal(assessCreditModule('electrical-2025', 'art', [conflicting[0]]).outcome, 'not_counts');
});

test('MOOC限制绑定已核实的开课学期；面授、其他学年及未核实学期不套用', () => {
  const offering = { ...evidence, startYear: 2026, semester: 1, mode: 'mooc', platform: '超星', originUniversity: '中南大学' };
  assert.equal(getMoocAnnualRule(offering).maxCourses, 1);
  for (const patch of [{ mode: 'classroom' }, { startYear: 2025 }, { startYear: 2027 }, { semester: 2 }])
    assert.equal(getMoocAnnualRule({ ...offering, ...patch }), null);
  assert.equal(academicYear(2026), '2026—2027学年');
});

test('公选课类别可分享、返回并清除；切换课程大类不遗留隐藏筛选', () => {
  const route = parseRoute('#/courses?electiveType=arts_sports&sort=rating&offset=20');
  assert.equal(route.category, 'elective');
  assert.equal(route.electiveType, 'arts_sports');
  const from = catalogHref(route);
  assert.equal(parseRoute(`#/courses/2?from=${encodeURIComponent(from)}`).from, from);
  const major = parseRoute(catalogHref(route, { category: 'major', offset: 0 }));
  assert.equal(major.electiveType, '');
  assert.equal(major.category, 'major');
  const all = parseRoute(catalogHref(route, { category: '', offset: 0 }));
  assert.equal(all.electiveType, '');
  assert.equal(all.category, '');
  assert.equal(parseRoute('#/courses?electiveType=unknown').category, 'elective');
  for (const query of ['electiveType=__proto__', 'electiveType=art', 'category=major&electiveType=unknown', 'electiveType=unknown&electiveType=economics'])
    assert.equal(parseRoute(`#/courses?${query}`).page, 'not-found');
});

test('公选课资料、分类过滤与已核对名单导入（独立临时D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  await migrate(DB);
  for (const [id, category, listed] of [[1, 'major', 1], [2, 'elective', 1], [3, 'major', 1], [4, 'elective', 0], [5, 'elective', 1]]) {
    await DB.prepare('INSERT INTO courses (id, code, name, department, category, is_listed) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, `TEST-${id}`, `测试课程${id}`, '同一学院', category, listed).run();
  }
  for (const id of [2, 3, 4]) {
    await DB.prepare('INSERT INTO elective_course_facts (course_id, elective_type, credits, source_url, source_label, source_locator) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, 'arts_sports', 2, evidence.sourceUrl, evidence.sourceLabel, evidence.sourceLocator).run();
  }
  const get = async (path) => {
    const response = await app.request(path, {}, platform.env);
    assert.equal(response.status, 200, path);
    return response.json();
  };
  await t.test('类别筛选和未知类别均只包含可见公选课，与学院、搜索、分页组合', async () => {
    const classified = await get('/api/courses?electiveType=arts_sports&limit=1&department=' + encodeURIComponent('同一学院'));
    assert.equal(classified.total, 1);
    assert.equal(classified.category, 'elective');
    assert.equal(classified.courses[0].id, 2);
    assert.equal(classified.courses[0].electiveType, 'arts_sports');
    assert.equal(classified.hasMore, false);
    assert.equal((await get('/api/courses?electiveType=arts_sports&offset=1')).total, 1);
    assert.equal((await get('/api/courses?electiveType=arts_sports&q=TEST-5')).total, 0);
    const unknown = await get('/api/courses?electiveType=unknown');
    assert.deepEqual(unknown.courses.map((course) => course.id), [5]);
    assert.equal(unknown.courses[0].electiveType, null);
    assert.equal((await get('/api/courses?category=major')).courses.find((course) => course.id === 3).electiveType, null);
    for (const query of ['electiveType=', 'electiveType=art', 'electiveType=__proto__', 'electiveType=unknown&electiveType=arts_sports', 'category=major&electiveType=unknown'])
      assert.equal((await app.request(`/api/courses?${query}`, {}, platform.env)).status, 400);
  });
  await t.test('艺体类别、同学院和课程学分不会生成学分认定规则；隐藏课程不返回资料', async () => {
    const { course } = await get('/api/courses/2');
    assert.equal(course.elective.facts.credits, 2);
    assert.equal(course.elective.facts.sourceLocator, '第2页');
    assert.deepEqual(course.elective.creditRules, []);
    assert.equal(assessCreditModule('electrical-2025', 'art', course.elective.creditRules).outcome, 'unknown');
    assert.equal((await get('/api/courses/3')).course.elective, null);
    assert.deepEqual((await get('/api/courses/5')).course.elective, { facts: null, offerings: [], creditRules: [] });
    assert.equal((await app.request('/api/courses/4', {}, platform.env)).status, 404);
    for (const outcome of ['counts', 'not_counts']) {
      await DB.prepare('INSERT INTO elective_credit_rules (course_id, plan_id, module, outcome, reason, source_url, source_label, source_locator) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(2, rule.planId, rule.module, outcome, rule.reason, rule.sourceUrl, rule.sourceLabel, rule.sourceLocator).run();
    }
    const rules = (await get('/api/courses/2')).course.elective.creditRules;
    assert.equal(rules.length, 2);
    assert.equal(assessCreditModule('electrical-2025', 'art', rules).outcome, 'conflict');
  });
  await t.test('缺少来源、错误分类和错误学期无法进入新数据表', async () => {
    await assert.rejects(DB.prepare("INSERT INTO elective_course_facts (course_id, elective_type) VALUES (5, 'arts_sports')").run());
    await assert.rejects(DB.prepare("UPDATE elective_course_facts SET elective_type = 'art' WHERE course_id = 2").run());
    await assert.rejects(DB.prepare("UPDATE elective_course_facts SET source_url = 'javascript:alert(1)' WHERE course_id = 2").run());
    await assert.rejects(DB.prepare("INSERT INTO elective_course_offerings (course_id, start_year, semester, mode, source_url, source_label, source_locator) VALUES (5, 2026, 3, 'mooc', 'https://bksy.csu.edu.cn/', '测试', '第1页')").run());
  });
  await t.test('同码异名在任何写入前中止，未审核的源文件也不能导入', async () => {
    await DB.prepare("INSERT INTO courses (id, code, name, department, category) VALUES (99, '3-57', '不同课程', '不同学院', 'elective')").run();
    await assert.rejects(importElectiveCatalog(DB), /已被不同资料占用/);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses').first()).n, 6);
    await DB.prepare('DELETE FROM courses WHERE id = 99').run();
    const invalid = structuredClone(electiveCatalog);
    invalid.courses[0].needs_review = ['学分未核实'];
    await assert.rejects(importElectiveCatalog(DB, invalid), /尚未审核/);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM courses').first()).n, 5);
  });
  await t.test('18门已核对MOOC保留学分、平台和来源，重跑不覆盖分类或评价', async () => {
    assert.deepEqual(await importElectiveCatalog(DB), { courses: 18, insertedCourses: 18 });
    const page = await get('/api/courses?electiveType=unknown&limit=100');
    assert.equal(page.total, 19);
    const art = page.courses.find((course) => course.code === '3-42');
    assert.equal(art.electiveType, null);
    const detail = (await get(`/api/courses/${art.id}`)).course;
    assert.equal(detail.elective.facts.credits, 2);
    assert.equal(detail.elective.offerings[0].startYear, 2026);
    assert.equal(detail.elective.offerings[0].mode, 'mooc');
    assert.equal(detail.elective.offerings[0].platform, '超星');
    assert.equal(detail.elective.facts.sourceLocator, '附件1，表1第6行');
    assert.deepEqual(detail.elective.creditRules, []);
    await DB.prepare("INSERT INTO course_reviews (id, course_id, rating, body, status) VALUES ('keep-review', ?, 5, '保留评价', 'published')").bind(art.id).run();
    await DB.prepare("UPDATE elective_course_facts SET elective_type = 'arts_sports' WHERE course_id = ?").bind(art.id).run();
    assert.deepEqual(await importElectiveCatalog(DB), { courses: 18, insertedCourses: 0 });
    assert.equal((await get(`/api/courses/${art.id}`)).course.electiveType, 'arts_sports');
    assert.equal((await DB.prepare("SELECT count(*) AS n FROM course_reviews WHERE id = 'keep-review'").first()).n, 1);
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM elective_course_offerings').first()).n, 18);
  });
});
