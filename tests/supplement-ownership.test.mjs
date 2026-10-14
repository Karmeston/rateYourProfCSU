import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setupCommunity } from './helpers/community.mjs';
import { moderate, inspect, queue } from '../scripts/moderate.mjs';

const content = (patch = {}) => ({
  kind: 'assessment',
  body: '考核与作业安排',
  sourceUrl: 'https://example.edu/material',
  term: '2025-1',
  teacherName: '教师甲',
  ...patch,
});

test('资料归属迁移保留既有内容、审核版本和日志关联', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql') && name < '0009')
    .sort())
    db.exec(readFileSync(new URL(name, directory), 'utf8'));
  db.exec("INSERT INTO courses(id,name,department) VALUES(1,'测试课程','测试学院')");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO course_supplements(id,course_id,visitor_id,kind,body,status,revision,moderation_id)
    VALUES(?,1,?,'materials','原有资料','published',3,'audit-marker')`,
  ).run(id, randomUUID());
  const before = db.prepare('SELECT * FROM course_supplements').get();
  db.exec(readFileSync(new URL('0009_supplement_ownership.sql', directory), 'utf8'));
  assert.deepEqual(
    { ...db.prepare('SELECT * FROM course_supplements').get() },
    {
      ...before,
      updated_at: null,
      withdrawn_at: null,
    },
  );
});

test('资料仅本人可改撤，原样重试不重复，修改和重新提交都须审核', async (t) => {
  const { db, request, json, other } = await setupCommunity(t);
  const base = '/api/courses/1/supplements',
    id = randomUUID(),
    path = `${base}/${id}`;
  assert.equal((await request(base, 'POST', { id, ...content() })).status, 202);
  const edit = { revision: 0, ...content({ body: '更正后的考核安排', term: '2025-2' }) };
  assert.equal((await request(path, 'PUT', edit)).status, 200);
  assert.equal((await request(path, 'PUT', edit)).status, 200);
  assert.equal((await json(base)).mine[0].revision, 1);
  assert.equal((await request(path, 'DELETE', { revision: 0 })).status, 409);
  assert.equal((await request(path, 'PUT', { ...edit, revision: 1 }, other)).status, 404);
  assert.equal((await request(path, 'DELETE', { revision: 1 }, other)).status, 404);
  assert.equal(
    (await request(`/api/courses/2/supplements/${id}`, 'PUT', { ...edit, revision: 1 })).status,
    404,
  );
  const outcomes = await Promise.all([
    request(path, 'PUT', { ...edit, revision: 1, body: '第一份修改' }),
    request(path, 'PUT', { ...edit, revision: 1, body: '第二份修改' }),
  ]);
  assert.deepEqual(outcomes.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await json(base)).mine[0].revision, 2);
  await moderate(db, { kind: 'supplement', id, action: 'approve', revision: 2, reason: '已核对' });
  assert.equal((await json(base, other)).supplements.length, 1);
  assert.equal((await json(base)).mine[0].status, 'published');
  assert.equal((await request(path, 'PUT', { ...edit, revision: 3 })).status, 200);
  const edited = (await json(base)).mine[0];
  assert.equal(edited.status, 'pending');
  assert.ok(edited.updated_at);
  assert.equal((await json(base, other)).supplements.length, 0);
  await moderate(db, {
    kind: 'supplement',
    id,
    action: 'approve',
    revision: 4,
    reason: '修改后核对',
  });
  assert.equal((await request(path, 'DELETE', { revision: 5 })).status, 200);
  assert.equal((await request(path, 'DELETE', { revision: 5 })).status, 200);
  assert.ok((await json(base)).mine[0].withdrawn_at);
  await moderate(db, {
    kind: 'supplement',
    id,
    action: 'restore',
    revision: 6,
    reason: '验证恢复不会覆盖撤回',
  });
  assert.equal((await json(base, null)).supplements.length, 0);
  assert.equal(
    (
      await request(
        `${path}/reports`,
        'POST',
        { id: randomUUID(), reason: 'other', details: '' },
        other,
      )
    ).status,
    404,
  );
  assert.equal((await request(path, 'PUT', { ...edit, revision: 7 })).status, 200);
  assert.equal((await json(base)).mine[0].withdrawn_at, null);
  assert.equal((await json(base, null)).supplements.length, 0);
  await moderate(db, {
    kind: 'supplement',
    id,
    action: 'approve',
    revision: 8,
    reason: '重新提交后核对',
  });
  await moderate(db, { kind: 'supplement', id, action: 'hide', revision: 9, reason: '资料需复核' });
  assert.equal((await request(path, 'PUT', { ...edit, revision: 9 })).status, 409);
  assert.equal((await request(path, 'PUT', { ...edit, revision: 10 })).status, 200);
  assert.equal((await json(base)).mine[0].status, 'pending');
  assert.ok((await queue(db)).supplements.some((row) => row.id === id));
  assert.equal((await request(path, 'DELETE', { revision: 11 })).status, 200);
  assert.ok(!(await queue(db)).supplements.some((row) => row.id === id));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM course_supplements').first()).n, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM course_materials').first()).n, 0);
  assert.ok(!JSON.stringify(await json(base)).includes('visitor_id'));
  assert.ok(!('visitor_id' in (await inspect(db, 'supplement', id))));
});

test('本人资料独立分页，包括已发布和撤回记录，不泄露给其他访客', async (t) => {
  const { db, request, json, other } = await setupCommunity(t);
  const base = '/api/courses/1/supplements',
    id = randomUUID();
  await request(base, 'POST', { id, ...content() });
  const identity = await db
    .prepare('SELECT visitor_id FROM course_supplements WHERE id=?')
    .bind(id)
    .first();
  const ids = Array.from({ length: 23 }, () => randomUUID()).sort();
  await db.prepare('DELETE FROM course_supplements WHERE id=?').bind(id).run();
  await db.batch(
    ids.map((id, i) =>
      db
        .prepare(
          `INSERT INTO course_supplements
    (id,course_id,visitor_id,kind,body,status,withdrawn_at,created_at)
    VALUES(?,1,?,'assessment','分页测试',?,?,'2026-10-14T00:00:00.000Z')`,
        )
        .bind(
          id,
          identity.visitor_id,
          i < 21 ? 'published' : 'pending',
          i === 22 ? '2026-10-14T00:00:01.000Z' : null,
        ),
    ),
  );
  const first = await json(base);
  assert.equal(first.mine.length, 20);
  assert.equal(first.hasMoreMine, true);
  assert.equal(first.hasMore, true);
  const second = await json(`${base}?mineOffset=20`);
  assert.deepEqual(
    second.mine.map((row) => row.id),
    ids.slice(20),
  );
  assert.equal(second.hasMoreMine, false);
  assert.equal(second.supplements.length, 20);
  assert.equal(second.offset, 0);
  const publicNext = await json(`${base}?offset=20`);
  assert.equal(publicNext.supplements.length, 1);
  assert.equal(publicNext.mine.length, 20);
  for (const identity of [null, other]) {
    const page = await json(`${base}?mineOffset=20`, identity);
    assert.deepEqual(page.mine, []);
    assert.equal(page.hasMoreMine, false);
  }
  for (const query of [
    'mineOffset=-1',
    'mineOffset=1.5',
    'mineOffset=100001',
    'mineOffset=0&mineOffset=20',
    'offset=0&unknown=1',
  ])
    assert.equal((await request(`${base}?${query}`)).status, 400);
});

test('修改与审核竞争不覆盖内容或错误记录审计，非法和跨站写入被拒绝', async (t) => {
  const { db, request, json, owner } = await setupCommunity(t);
  const base = '/api/courses/1/supplements',
    id = randomUUID(),
    path = `${base}/${id}`;
  await request(base, 'POST', { id, ...content() });
  const [reviewed, edited] = await Promise.allSettled([
    moderate(db, { kind: 'supplement', id, action: 'approve', revision: 0, reason: '竞争测试' }),
    request(path, 'PUT', { revision: 0, ...content({ body: '修改竞争测试' }) }),
  ]);
  assert.equal(edited.status, 'fulfilled');
  const current = (await json(base)).mine[0];
  assert.equal(current.revision, 1);
  if (reviewed.status === 'fulfilled') {
    assert.equal(edited.value.status, 409);
    assert.equal(current.status, 'published');
    assert.equal(current.body, content().body);
  } else {
    assert.equal(edited.value.status, 200);
    assert.equal(current.status, 'pending');
    assert.equal(current.body, '修改竞争测试');
  }
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM moderation_actions').first()).n,
    reviewed.status === 'fulfilled' ? 1 : 0,
  );
  for (const patch of [
    { revision: -1 },
    { revision: '1' },
    { body: '' },
    { kind: '__proto__' },
    { sourceUrl: 'javascript:alert(1)' },
    { term: '2025-3' },
    { teacherName: 'x'.repeat(81) },
    { status: 'published' },
  ])
    assert.equal((await request(path, 'PUT', { revision: 1, ...content(), ...patch })).status, 400);
  assert.equal((await request(path, 'PUT', { revision: 1, ...content() }, null)).status, 401);
  assert.equal(
    (await request(path, 'DELETE', { revision: 1 }, owner, { Origin: 'https://other.example' }))
      .status,
    403,
  );
  await db.prepare('UPDATE courses SET is_listed=0 WHERE id=1').run();
  assert.equal((await request(path, 'PUT', { revision: 1, ...content() })).status, 404);
  assert.equal((await request(path, 'DELETE', { revision: 1 })).status, 404);
});
