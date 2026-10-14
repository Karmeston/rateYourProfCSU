import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { moderate, inspect, queue } from '../scripts/moderate.mjs';
import { setupCommunity as setup } from './helpers/community.mjs';
import { catalogHref, parseRoute } from '../web/routing.ts';

test('方案按专业与班型精确筛选，版本和分页可分享，记录差异不增加课程数', async (t) => {
  const { db, request, json } = await setup(t);
  const insert = async (id, course, program, year, credits, requirement) =>
    db
      .prepare(
        `INSERT INTO course_materials(id,course_id,source_id,kind,source_year,department,program,credits,requirement,source_url,source_label,source_locator)
    VALUES(?,?,?,'curriculum',?,'测试学院',?,?,?,'https://gip.csu.edu.cn/fixture','测试方案','原表')`,
      )
      .bind(id, course, id, year, program, credits, requirement)
      .run();
  await insert('a', 1, '资源勘查工程', 2023, 4, '必修');
  await insert('b', 1, '资源勘查工程', 2025, 3, '选修');
  await insert('c', 2, '资源勘查工程卓越人才培养', 2023, 2, '必修');
  const url = '/api/courses?program=' + encodeURIComponent('资源勘查工程');
  const all = await json(url);
  assert.equal(all.total, 1);
  assert.equal(all.category, 'major');
  assert.equal(all.courses[0].planRecords.length, 2);
  const recent = await json(url + '&planYear=2025');
  assert.equal(recent.courses[0].planRecords[0].credits, 3);
  assert.equal(recent.courses[0].planRecords[0].requirement, '选修');
  assert.equal((await json(url + '&offset=20')).total, 1);
  assert.deepEqual(all.facets.programs.find((x) => x.name === '资源勘查工程').years, [2025, 2023]);
  for (const query of [
    'planYear=2023',
    'program=x&category=elective',
    'program=x&planYear=bad',
    'program=&planYear=2023',
    'program=x&program=y',
  ])
    assert.equal((await request('/api/courses?' + query)).status, 400);
  const route = parseRoute('#/courses?program=资源勘查工程&planYear=2025&offset=20');
  assert.equal(route.page, 'catalog');
  const link = catalogHref(route);
  assert.equal(parseRoute(`#/courses/1?from=${encodeURIComponent(link)}`).from, link);
  assert.equal(parseRoute(catalogHref(route, { program: '生物科学' })).planYear, '');
  assert.equal(parseRoute(catalogHref(route, { category: 'elective' })).program, '');
  assert.equal(parseRoute(catalogHref(route, { category: '' })).program, '');
  await db.prepare('UPDATE courses SET is_listed=0 WHERE id=1').run();
  assert.equal((await json(url)).total, 0);
  assert.ok(!(await json(url)).facets.programs.some((x) => x.name === '资源勘查工程'));
});

test('同访客一对象一条评价，修改撤回与审核互不越权；旧记录不能认领', async (t) => {
  const { db, request, json, owner, other } = await setup(t);
  for (const kind of ['courses', 'teachers']) {
    const table = kind === 'courses' ? 'course_reviews' : 'teacher_reviews',
      foreign = kind === 'courses' ? 'course_id' : 'teacher_id';
    const legacy = randomUUID();
    await db
      .prepare(
        `INSERT INTO ${table}(id,${foreign},rating,body,status) VALUES(?,1,3,'历史评价','published')`,
      )
      .bind(legacy)
      .run();
    const base = `/api/${kind}/1/reviews`,
      data = {
        id: randomUUID(),
        rating: 5,
        body: '课堂体验',
        term: '2025-1',
        teacherName: '教师甲',
      };
    const outcomes = await Promise.all([
      request(base, 'POST', data),
      request(base, 'POST', { ...data, id: randomUUID() }),
    ]);
    assert.deepEqual(outcomes.map((x) => x.status).sort(), [202, 409]);
    const page = await json(base),
      mine = page.myReview,
      id = mine.id;
    const original = { ...data, id };
    assert.equal((await request(base, 'POST', original)).status, 202);
    assert.equal(page.summary.count, 2);
    assert.ok(!JSON.stringify(page).includes('visitor_id'));
    assert.equal((await json(base, other)).myReview, null);
    assert.equal(
      (await request(`${base}/${legacy}`, 'PUT', { revision: 0, rating: 2, body: '冒认' })).status,
      404,
    );
    assert.equal((await request(`${base}/${id}`, 'DELETE', { revision: 0 }, other)).status, 404);
    const edited = {
      revision: 0,
      rating: 4,
      body: '修订后的课堂体验',
      term: '2025-2',
      teacherName: '教师乙',
    };
    assert.equal((await request(`${base}/${id}`, 'PUT', edited)).status, 200);
    assert.equal((await request(`${base}/${id}`, 'PUT', edited)).status, 200);
    assert.equal((await json(base)).summary.average, 3.5);
    assert.equal((await request(`${base}/${id}`, 'DELETE', { revision: 0 })).status, 409);
    assert.equal((await request(`${base}/${id}`, 'DELETE', { revision: 1 })).status, 200);
    assert.equal((await request(`${base}/${id}`, 'DELETE', { revision: 1 })).status, 200);
    assert.equal((await json(base)).summary.count, 1);
    assert.equal((await request(`${base}/${id}/vote`, 'PUT', { value: 1 }, other)).status, 404);
    assert.equal((await request(base, 'POST', { ...data, id: randomUUID() })).status, 409);
    assert.equal(
      (await request(`${base}/${id}`, 'PUT', { ...edited, revision: 2, rating: 2 })).status,
      200,
    );
    assert.equal((await json(base)).summary.count, 2);
    await moderate(db, {
      kind: kind === 'courses' ? 'course_review' : 'teacher_review',
      id,
      action: 'hide',
      revision: 3,
      reason: '测试隐藏',
    });
    assert.equal((await json(base)).summary.count, 1);
    assert.equal((await request(`${base}/${id}`, 'PUT', { ...edited, revision: 3 })).status, 409);
    assert.equal((await request(`${base}/${id}`, 'PUT', { ...edited, revision: 4 })).status, 200);
    assert.equal((await json(base)).myReview.status, 'pending');
    assert.equal((await json(base)).summary.count, 1);
    assert.ok((await queue(db)).reviews[kind].some((review) => review.id === id));
    const modKind = kind === 'courses' ? 'course_review' : 'teacher_review';
    await moderate(db, {
      kind: modKind,
      id,
      action: 'approve',
      revision: 5,
      reason: '修改后审核通过',
    });
    assert.equal((await request(`${base}/${id}`, 'DELETE', { revision: 6 })).status, 200);
    await moderate(db, {
      kind: modKind,
      id,
      action: 'restore',
      revision: 7,
      reason: '验证恢复不覆盖作者撤回',
    });
    assert.equal((await json(base)).summary.count, 1);
    await assert.rejects(
      moderate(db, { kind: modKind, id, action: 'hide', revision: 7, reason: '过期版本' }),
      /版本/,
    );
    assert.ok(!('visitor_id' in (await inspect(db, modKind, id))));
    assert.equal((await request(base, 'POST', { ...data, id: randomUUID() }, null)).status, 401);
    assert.equal(
      (
        await request(`${base}/${id}`, 'PUT', { ...edited, revision: 8 }, owner, {
          Origin: 'https://other.example',
        })
      ).status,
      403,
    );
  }
  assert.equal((await db.prepare('SELECT count(*) AS n FROM moderation_actions').first()).n, 6);
  assert.equal((await json('/api/courses')).stats.reviewCount, 1);
});

test('回复举报绑定正确父评价，隐藏与恢复不影响作者撤回', async (t) => {
  const { db, request, json, other } = await setup(t);
  for (const kind of ['courses', 'teachers']) {
    const review = { id: randomUUID(), rating: 4, body: '用于回复验收的评价' };
    const base = `/api/${kind}/1/reviews`;
    assert.equal((await request(base, 'POST', review)).status, 202);
    const reply = { id: randomUUID(), body: '补充回复' };
    assert.equal((await request(`${base}/${review.id}/replies`, 'POST', reply, other)).status, 201);
    const path = `${base}/${review.id}/replies/${reply.id}/reports`;
    const report = { id: randomUUID(), reason: 'spam', details: '测试举报' };
    assert.equal((await request(path, 'POST', report)).status, 202);
    const target = kind === 'courses' ? 'course_reply' : 'teacher_reply';
    await moderate(db, {
      kind: target,
      id: reply.id,
      action: 'hide',
      revision: 0,
      reason: '测试隐藏回复',
    });
    assert.equal((await json(`${base}/${review.id}/replies`)).replies.length, 0);
    assert.equal((await request(path, 'POST', { ...report, id: randomUUID() })).status, 404);
    await moderate(db, {
      kind: target,
      id: reply.id,
      action: 'restore',
      revision: 1,
      reason: '测试恢复回复',
    });
    assert.equal((await json(`${base}/${review.id}/replies`)).replies.length, 1);
    assert.equal((await request(`${base}/${review.id}`, 'DELETE', { revision: 0 })).status, 200);
    assert.equal((await request(`${base}/${review.id}/replies`)).status, 404);
    assert.equal((await request(path, 'POST', { ...report, id: randomUUID() })).status, 404);
  }
});

test('资料先审核，举报去重不自动下架；管理操作有审计且隐藏内容不能继续互动', async (t) => {
  const { db, request, json, owner, other } = await setup(t),
    base = '/api/courses/1/supplements';
  const data = {
    id: randomUUID(),
    kind: 'assessment',
    body: '作业和期末安排',
    sourceUrl: 'https://gip.csu.edu.cn/info/fixture',
    term: '2025-1',
    teacherName: '教师甲',
  };
  assert.equal((await request(base, 'POST', data)).status, 202);
  assert.equal((await request(base, 'POST', data)).status, 202);
  assert.equal((await json(base)).supplements.length, 0);
  assert.equal((await json(base)).mine.length, 1);
  assert.equal((await json(base, other)).mine.length, 0);
  assert.equal(
    (await request(base, 'POST', { ...data, id: randomUUID(), sourceUrl: 'javascript:alert(1)' }))
      .status,
    400,
  );
  assert.equal(
    (await request(base, 'POST', { ...data, id: randomUUID(), teacherName: 'x'.repeat(81) }))
      .status,
    400,
  );
  assert.equal(
    (await request(base, 'POST', { ...data, id: randomUUID(), term: '2025-3' })).status,
    400,
  );
  await moderate(db, {
    kind: 'supplement',
    id: data.id,
    action: 'approve',
    revision: 0,
    reason: '有公开来源',
  });
  const publicData = await json(base, other);
  assert.equal(publicData.supplements.length, 1);
  assert.ok(!JSON.stringify(publicData).includes('visitor_id'));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM course_materials').first()).n, 0);
  const report = { id: randomUUID(), reason: 'inaccurate', details: '原文安排不同' };
  const path = `${base}/${data.id}/reports`;
  assert.equal((await request(path, 'POST', report, other)).status, 202);
  assert.equal((await request(path, 'POST', { ...report, id: randomUUID() }, other)).status, 202);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM content_reports').first()).n, 1);
  assert.equal((await json(base)).supplements.length, 1);
  assert.equal(
    (
      await request(
        `/api/courses/2/supplements/${data.id}/reports`,
        'POST',
        { ...report, id: randomUUID() },
        owner,
      )
    ).status,
    404,
  );
  await moderate(db, {
    kind: 'supplement',
    id: data.id,
    action: 'hide',
    revision: 1,
    reason: '核实后隐藏',
  });
  assert.equal((await json(base)).supplements.length, 0);
  assert.equal((await request(path, 'POST', { ...report, id: randomUUID() }, other)).status, 404);
  await moderate(db, {
    kind: 'report',
    id: report.id,
    action: 'resolve',
    revision: 0,
    reason: '已处理对应资料',
  });
  assert.equal((await inspect(db, 'report', report.id)).status, 'resolved');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM moderation_actions').first()).n, 3);
  await db.prepare('UPDATE courses SET is_listed=0 WHERE id=1').run();
  assert.equal((await request(base)).status, 404);
  assert.equal((await request('/api/admin')).status, 404);
});
