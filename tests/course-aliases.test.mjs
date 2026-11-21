import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { courseAliases } from '../shared/course-aliases.ts';
import { openDirectory, searchDirectory } from '../shared/course-directory.ts';
import { defaultFilters, parseRoute } from '../web/routing.ts';
import { setupCommunity } from './helpers/community.mjs';

test('旧代码查询和评分使用主课程，同一访客不能通过旧入口重复评分', async (t) => {
  const { db, request, json } = await setupCommunity(t);
  const pair = courseAliases[1];
  for (const row of courseAliases) {
    await db.prepare("INSERT INTO courses(id,code,name,department,is_listed) VALUES(?,?,?,'学院',1)")
      .bind(row.id, row.code, row.name).run();
    await db.prepare("INSERT INTO courses(id,code,name,department,is_listed) VALUES(?,?,?,'学院',0)")
      .bind(row.oldId, row.alias, row.name).run();
    for (const [method, suffix] of [['GET', '?view=page'], ['GET', '/reviews?sort=helpful'], ['POST', '/reviews'], ['PUT', '/supplements/legacy']]) {
      const response = await request(`/api/courses/${row.oldId}${suffix}`, method);
      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get('Location')).pathname, `/api/courses/${row.id}${suffix.split('?')[0]}`);
      assert.equal(new URL(response.headers.get('Location')).search, suffix.includes('?') ? '?' + suffix.split('?')[1] : '');
    }
  }
  const matches = await json('/api/courses?view=results&q=BYSW');
  assert.equal(matches.total, 1);
  assert.equal(matches.courses[0].id, pair.id);
  const body = { id: randomUUID(), rating: 5, body: '课程体验' };
  const redirect = await request(`/api/courses/${pair.oldId}/reviews`, 'POST', body);
  assert.equal(redirect.status, 307);
  const target = new URL(redirect.headers.get('Location')).pathname;
  assert.equal((await request(target, 'POST', body)).status, 202);
  assert.equal((await request(target, 'POST', { ...body, id: randomUUID() })).status, 409);
  assert.equal((await db.prepare('SELECT course_id FROM course_reviews').first()).course_id, pair.id);
  const listed = await json(`/api/courses/${pair.id}/reviews`);
  assert.equal(listed.reviews.length, 1);
  // A fresh database may assign a historical ID to an unrelated course.
  const oldId = courseAliases[0].oldId;
  await db.prepare("UPDATE courses SET name='独立新课程',code='NEW-UNRELATED',is_listed=1 WHERE id=?").bind(oldId).run();
  const unrelated = await request(`/api/courses/${oldId}?view=page`);
  assert.equal(unrelated.status, 200);
  assert.equal((await unrelated.json()).course.id, oldId);
});

test('七组历史课程只展示主入口，旧代码可搜索，旧链接保留返回条件', () => {
  const directory = openDirectory(JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url))));
  for (const row of courseAliases) {
    const result = searchDirectory(directory, { ...defaultFilters, q: row.alias.toUpperCase() }, 24);
    assert.ok(result.courses.some((course) => course.id === row.id));
    assert.ok(!directory.courses.some((course) => course.id === row.oldId));
    const route = parseRoute(`#/courses/${row.oldId}?from=${encodeURIComponent('#/courses?q=' + row.alias)}`);
    assert.equal(route.id, String(row.oldId));
    assert.equal(route.from, '#/courses?q=' + row.alias);
  }
});

test('合并迁移归集来源、评价、互动和资料，浏览量相加，重跑无重复', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../migrations/', import.meta.url);
  const mergeFile = '0015_merge_historical_course_aliases.sql';
  for (const file of readdirSync(migrations).filter((file) => file.endsWith('.sql') && file < mergeFile).sort())
    db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const row = courseAliases[1];
  const insert = db.prepare('INSERT INTO courses(id,code,name,department,is_listed) VALUES(?,?,?,\'学院\',1)');
  insert.run(row.oldId, row.alias, row.name);
  insert.run(row.id, row.code, row.name);
  db.exec(`INSERT INTO course_reviews(id,course_id,rating,body,status,visitor_id)
    VALUES('legacy',${row.oldId},5,'已有体验','published','11111111-1111-4111-8111-111111111111');
    INSERT INTO course_review_votes(review_id,voter_id,value) VALUES('legacy','viewer',1);
    INSERT INTO course_review_replies(id,review_id,body) VALUES('reply','legacy','已有回复');
    INSERT INTO course_supplements(id,course_id,visitor_id,kind,body)
    VALUES('material',${row.oldId},'11111111-1111-4111-8111-111111111111','materials','真实资料');
    INSERT INTO course_catalog_records(source_sha256,source_sequence,course_id,source_type,source_date,source_url,source_label)
    VALUES('${'a'.repeat(64)}',1,${row.oldId},'timetable','2026-11-07','http://csujwc.its.csu.edu.cn/jiaowu/example','原始课表');
    INSERT INTO traffic_daily VALUES('2026-11-22','course',${row.oldId},5),('2026-11-22','course',${row.id},3);`);
  const migrate = () => db.exec('BEGIN;\n' + readFileSync(new URL(mergeFile, migrations), 'utf8') + '\nCOMMIT;');
  migrate();
  migrate();
  for (const table of ['course_reviews', 'course_supplements', 'course_catalog_records'])
    assert.equal(db.prepare(`SELECT course_id FROM ${table}`).get().course_id, row.id);
  assert.equal(db.prepare('SELECT review_id FROM course_review_votes').get().review_id, 'legacy');
  assert.equal(db.prepare('SELECT review_id FROM course_review_replies').get().review_id, 'legacy');
  assert.deepEqual(db.prepare('SELECT target_id,views FROM traffic_daily').all().map((r) => [r.target_id,r.views]), [[row.id,8]]);
  assert.equal(db.prepare('SELECT is_listed FROM courses WHERE id=?').get(row.oldId).is_listed, 0);
  assert.equal(db.prepare('SELECT code FROM courses WHERE id=?').get(row.oldId).code, row.alias);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
