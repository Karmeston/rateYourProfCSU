import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readPublicDirectory } from '../scripts/prepare-public-directory.mjs';
import { isMinorProgram, openDirectory, searchDirectory } from '../shared/course-directory.ts';
import { catalogHref, defaultFilters, parseRoute } from '../web/routing.ts';

test('静态目录按最新方案显示真实课程，筛选及分页不依赖服务接口', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url), 'utf8'));
  const directory = openDirectory(snapshot);
  const program = { ...defaultFilters, program: '计算机科学与技术' };
  const first = searchDirectory(directory, program, 24);
  const second = searchDirectory(directory, { ...program, offset: 24 }, 24);
  assert.equal(first.total, 69);
  assert.equal(first.courses.length, 24);
  assert.equal(second.courses.length, 24);
  assert.ok(first.courses.every(({ id }) => !second.courses.some((item) => item.id === id)));
  assert.ok(first.courses.some((item) => item.category === null));
  const result = searchDirectory(directory, { ...program, q: '高级英语' }, 24);
  assert.ok(result.courses.some(({ id, name }) => id === 3634 && name === '高级英语（一）'));
  const [a, b] = first.courses;
  const ratings = [[a.id, 5, 1], [b.id, 4, 2]];
  assert.equal(searchDirectory(directory, { ...program, sort: 'rating' }, 24, ratings).courses[0].id, a.id);
  assert.equal(searchDirectory(directory, { ...program, sort: 'reviews' }, 24, ratings).courses[0].id, b.id);
});

test('公选课类别只列出目录中实际存在的类别，按固定顺序', () => {
  const snapshot = {
    version: 2,
    departments: ['某学院'],
    courses: [
      [1, '甲', 'A', 0, 'elective', 'arts_sports'],
      [2, '乙', 'B', 0, 'elective', null],
      [3, '丙', 'C', 0, 'elective', 'natural_science'],
      [4, '丁', 'D', 0, 'major', null],
    ],
    programs: [],
    colleges: [],
  };
  assert.deepEqual(openDirectory(snapshot).facets.electiveTypes, ['natural_science', 'arts_sports']);
  const real = JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url), 'utf8'));
  const known = new Set(real.courses.map((row) => row[5]).filter(Boolean));
  assert.equal(openDirectory(real).facets.electiveTypes.length, known.size);
});

test('学院按培养方案归组，辅修不混入学院概览，同名同年分学院查询', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url), 'utf8'));
  const directory = openDirectory(snapshot);
  const find = (filters) => searchDirectory(directory, { ...defaultFilters, ...filters }, 1000);
  const college = '计算机学院';
  const group = directory.facets.colleges.find((entry) => entry.name === college);
  const main = group.programs.filter((entry) => !isMinorProgram(entry.name));
  assert.ok(main.some((entry) => entry.name === '计算机科学与技术'));
  assert.ok(main.some((entry) => entry.name === '软件工程'));
  const visible = new Set(main.flatMap(({ name }) => find({ college, program: name }).courses.map((row) => row.id)));
  assert.deepEqual(new Set(find({ college }).courses.map((row) => row.id)), visible);
  const route = parseRoute(catalogHref(defaultFilters, { college, program: '计算机科学与技术' }));
  assert.equal(find(route).total, 69);
  assert.equal(parseRoute(catalogHref(route, { college: '自动化学院' })).program, '');
  assert.equal(parseRoute(catalogHref(route, { category: 'elective' })).college, '');
  const focus = { program: '人工智能' };
  const a = find({ ...focus, college: '自动化学院' }).courses.map((row) => row.id);
  const b = find({ ...focus, college: '人工智能学院' }).courses.map((row) => row.id);
  assert.ok(a.some((id) => !b.includes(id)) && b.some((id) => !a.includes(id)));
  assert.equal(new Set([...a, ...b]).size, find(focus).total);
});

test('编号思政方案条目下架后仍保留课程与评价，公开快照不再收录', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const migrations = new URL('../migrations/', import.meta.url);
  const hidePlaceholders = '0013_hide_numbered_politics_placeholders.sql';
  const apply = (file) => db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  for (const file of readdirSync(migrations).filter((entry) => entry.endsWith('.sql') && entry < hidePlaceholders).sort())
    apply(file);
  db.exec(`INSERT INTO courses(id,name,code,department,is_listed)
    VALUES (10527,'思政课4','210105T10','待核实',1),
           (10592,'思政课6','210203T10','待核实',1),
           (10599,'思政实践','211001T11','待核实',1);
    INSERT INTO course_reviews(id,course_id,rating,body,status)
    VALUES ('existing',10527,5,'已有评价','published');`);
  apply(hidePlaceholders);
  assert.deepEqual(db.prepare('SELECT is_listed FROM courses ORDER BY id').all().map((row) => row.is_listed), [0, 0, 1]);
  assert.equal(db.prepare("SELECT course_id FROM course_reviews WHERE id='existing'").get().course_id, 10527);
  assert.deepEqual(readPublicDirectory(db).courses.map(([id]) => id), [10599]);
});

test('思想政治理论综合课下架后保留记录，同类思政专业课与思政实践不受影响', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const migrations = new URL('../migrations/', import.meta.url);
  const hide = '0016_hide_politics_theory_course.sql';
  const apply = (file) => db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  for (const file of readdirSync(migrations).filter((entry) => entry.endsWith('.sql') && entry < hide).sort())
    apply(file);
  db.exec(`INSERT INTO courses(id,name,code,department,is_listed)
    VALUES (10277,'思想政治理论综合课','2-110','待核实',1),
           (10599,'思政实践','211001T11','待核实',1),
           (10543,'思想政治教育史','210109X10','待核实',1);
    INSERT INTO course_reviews(id,course_id,rating,body,status)
    VALUES ('kept',10277,4,'已有评价','published');`);
  apply(hide);
  assert.deepEqual(readPublicDirectory(db).courses.map(([id]) => id), [10543, 10599]);
  assert.equal(db.prepare("SELECT course_id FROM course_reviews WHERE id='kept'").get().course_id, 10277);
  const snapshot = JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url), 'utf8'));
  assert.ok(!snapshot.courses.some(([, name]) => name === '思想政治理论综合课'));
  assert.ok(snapshot.courses.some(([id]) => id === 10599));
});

test('只选学院时分别取各主修的最新方案，旧链接也按学院取最新', () => {
  const directory = openDirectory({
    version: 2,
    departments: ['甲学院'],
    courses: Array.from({ length: 7 }, (_, index) => [index + 1, `课程${index + 1}`, null, 0, 'major', null]),
    programs: [
      ['数学', [[null, [1]], [2026, [3]], [2024, [2]], [2027, [7]]]],
      ['统计学', [[2025, [4]]]],
      ['物理学', [[null, [5]]]],
      ['数学辅修', [[2026, [6]]]],
    ],
    colleges: [
      ['甲学院', [['数学', [[null], [2026], [2024]]], ['统计学', [[2025]]], ['物理学', [[null]]], ['数学辅修', [[2026]]]]],
      ['乙学院', [['数学', [[2027]]]]],
    ],
  });
  const ids = (hash) => searchDirectory(directory, parseRoute(hash), 24).courses.map(({ id }) => id);
  assert.deepEqual(ids('#/courses?college=甲学院'), [3, 4, 5]);
  assert.deepEqual(ids('#/courses?college=甲学院&program=数学&planYear=2024'), [3]);
  assert.deepEqual(ids('#/courses?college=乙学院&program=数学'), [7]);
  assert.deepEqual(ids('#/courses?college=甲学院&program=数学辅修'), [6]);
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
  assert.equal(searchDirectory(directory, { ...defaultFilters, program: '数学', q: 'math-a' }, 24).total, 1);
});
