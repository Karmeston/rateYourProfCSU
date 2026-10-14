import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import app from '../src/index.ts';
import { setupCommunity } from './helpers/community.mjs';
import { hashAdminPassword } from '../src/admin-password.ts';

const password = 'synthetic-admin-password-for-tests-only';
const hash = hashAdminPassword(password);
async function setup(t) {
  const community = await setupCommunity(t);
  const allow = { limit: async () => ({ success: true }) };
  const env = {
    ...community.env,
    DB: community.db,
    VISITOR_SECRET: 'synthetic-test-secret-at-least-32-characters',
    ADMIN_PASSWORD_HASH: await hash,
    ADMIN_SESSION_SECRET: 'synthetic-admin-signing-secret-at-least-32-characters',
    ADMIN_LOGIN_LIMITER: allow,
    ADMIN_WRITE_LIMITER: allow,
    TRAFFIC_LIMITER: allow,
  };
  const request = (path, method = 'GET', body, cookie, extra = {}) =>
    app.request(
      'https://example.test/api/admin' + path,
      {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== 'GET'
            ? { 'Content-Type': 'application/json', Origin: 'https://example.test' }
            : {}),
          'CF-Connecting-IP': '192.0.2.1',
          ...extra,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
  const login = async () => {
    const response = await request('/login', 'POST', { password });
    assert.equal(response.status, 200);
    return response.headers.get('Set-Cookie').split(';')[0];
  };
  return { ...community, env, adminRequest: request, login };
}

test('管理身份独立于匿名Cookie，安全会话退出后立即失效，旧签名与配置不能绕过认证', async (t) => {
  const { env, owner, adminRequest: request, login } = await setup(t);
  for (const cookie of [undefined, owner, '__Host-csu-admin=forged'])
    for (const path of ['/overview', '/content', '/audit'])
      assert.equal((await request(path, 'GET', undefined, cookie)).status, 401);
  assert.deepEqual(await (await request('/session')).json(), {
    configured: true,
    authenticated: false,
  });
  assert.equal(
    (await request('/login', 'POST', { password: 'incorrect-long-password' })).status,
    401,
  );
  const response = await request('/login', 'POST', { password }),
    header = response.headers.get('Set-Cookie');
  assert.equal(response.status, 200);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=28800'])
    assert.ok(header.includes(flag));
  const cookie = header.split(';')[0];
  assert.equal((await request('/overview', 'GET', undefined, cookie)).status, 200);
  assert.equal((await request('/logout', 'POST', {}, cookie)).status, 204);
  assert.equal((await request('/overview', 'GET', undefined, cookie)).status, 401);
  const newer = await login();
  env.ADMIN_PASSWORD_HASH = await hashAdminPassword(password + '-changed');
  assert.equal((await request('/overview', 'GET', undefined, newer)).status, 401);
  env.ADMIN_PASSWORD_HASH = undefined;
  assert.equal((await request('/login', 'POST', { password })).status, 503);
  assert.equal((await request('/overview', 'GET', undefined, newer)).status, 401);
});

test('管理写入严格校验来源、JSON和限流，公开页面不受管理员登录影响', async (t) => {
  const { env, adminRequest: request, login } = await setup(t);
  assert.equal(
    (await request('/login', 'POST', { password }, undefined, { Origin: 'https://other.test' }))
      .status,
    403,
  );
  assert.equal(
    (await request('/login', 'POST', { password }, undefined, { 'Content-Type': 'text/plain' }))
      .status,
    415,
  );
  env.ADMIN_LOGIN_LIMITER = { limit: async () => ({ success: false }) };
  const limited = await request('/login', 'POST', { password });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  env.ADMIN_LOGIN_LIMITER = { limit: async () => ({ success: true }) };
  const cookie = await login();
  assert.equal(
    (await request('/moderate', 'POST', {}, cookie, { Origin: 'https://other.test' })).status,
    403,
  );
  assert.equal((await request('/moderate', 'POST', {}, cookie, { Origin: '' })).status, 403);
  env.ADMIN_WRITE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await request('/moderate', 'POST', {}, cookie)).status, 429);
  assert.equal((await app.request('/api/courses', {}, env)).status, 200);
});

test('后台审核复用版本与审计，原样重试幂等，不恢复作者撤回内容', async (t) => {
  const { db, request: publicRequest, json, adminRequest: request, login } = await setup(t);
  const cookie = await login(),
    id = randomUUID();
  assert.equal(
    (
      await publicRequest('/api/courses/1/supplements', 'POST', {
        id,
        kind: 'materials',
        body: '审核测试资料',
        sourceUrl: 'https://example.test/material',
      })
    ).status,
    202,
  );
  const listing = await request('/content', 'GET', undefined, cookie);
  assert.equal(listing.headers.get('Cache-Control'), 'no-store');
  const page = await listing.json();
  assert.equal(page.items[0].body, '审核测试资料');
  assert.ok(!JSON.stringify(page).includes('visitor_id'));
  const action = {
    kind: 'supplement',
    id,
    action: 'approve',
    revision: 0,
    reason: '来源已核对',
    requestId: randomUUID(),
  };
  assert.equal((await request('/moderate', 'POST', action, cookie)).status, 200);
  assert.equal((await request('/moderate', 'POST', action, cookie)).status, 200);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM moderation_actions').first()).n, 1);
  assert.equal((await json('/api/courses/1/supplements')).supplements.length, 1);
  assert.equal(
    (await request('/moderate', 'POST', { ...action, requestId: randomUUID() }, cookie)).status,
    409,
  );
  await publicRequest(`/api/courses/1/supplements/${id}`, 'DELETE', { revision: 1 });
  assert.equal((await request('/moderate','POST',action,cookie)).status,200);
  assert.equal(
    (
      await request(
        '/moderate',
        'POST',
        { ...action, revision: 2, action: 'restore', requestId: randomUUID() },
        cookie,
      )
    ).status,
    409,
  );
  assert.equal((await json('/api/courses/1/supplements')).supplements.length, 0);
  const all = await (await request('/content?status=all', 'GET', undefined, cookie)).json();
  assert.ok(!all.items[0].actions.includes('restore'));
  const audit = await (await request('/audit', 'GET', undefined, cookie)).json();
  assert.equal(audit.items[0].actor, 'admin');
  assert.equal(audit.items[0].target_revision, 1);
  assert.equal(audit.items[0].reason, '来源已核对');
  for (const payload of [
    { ...action, actor: 'cli' },
    { ...action, kind: '__proto__' },
    { ...action, action: 'delete' },
    { ...action, reason: '' },
  ])
    assert.equal((await request('/moderate', 'POST', payload, cookie)).status, 400);
});

test('重复操作编号的并发竞争不会改动两个目标或留下未审计修改', async (t) => {
  const { db, request: publicRequest, adminRequest: request, login } = await setup(t);
  const cookie = await login(),
    ids = [randomUUID(), randomUUID()],
    requestId = randomUUID();
  for (const id of ids)
    await publicRequest('/api/courses/1/supplements', 'POST', {
      id,
      kind: 'other',
      body: '并发目标',
    });
  const results = await Promise.all(
    ids.map((id) =>
      request(
        '/moderate',
        'POST',
        { kind: 'supplement', id, action: 'approve', revision: 0, reason: '并发核对', requestId },
        cookie,
      ),
    ),
  );
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM course_supplements WHERE status='published'")
        .first()
    ).n,
    1,
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM moderation_actions').first()).n, 1);
});

test('举报可查看被举报原文并处理，列表分页与参数边界不泄露访客标识', async (t) => {
  const { db, request: publicRequest, adminRequest: request, login, other } = await setup(t);
  const review = randomUUID();
  await publicRequest('/api/courses/1/reviews', 'POST', {
    id: review,
    rating: 4,
    body: '举报原文测试',
  });
  const report = randomUUID();
  await publicRequest(
    `/api/courses/1/reviews/${review}/reports`,
    'POST',
    { id: report, reason: 'inaccurate', details: '报告说明' },
    other,
  );
  const cookie = await login();
  const list = await (
    await request('/content?kind=report&status=open', 'GET', undefined, cookie)
  ).json();
  assert.equal(list.items[0].target_id, review);
  assert.equal(list.items[0].body, '报告说明');
  const target = await (
    await request(`/content/course_review/${review}`, 'GET', undefined, cookie)
  ).json();
  assert.equal(target.item.body, '举报原文测试');
  assert.ok(!JSON.stringify(target).includes('visitor_id'));
  assert.equal(
    (
      await request(
        '/moderate',
        'POST',
        {
          kind: 'report',
          id: report,
          action: 'resolve',
          revision: 0,
          reason: '已核对原文',
          requestId: randomUUID(),
        },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.prepare('SELECT status FROM content_reports WHERE id=?').bind(report).first()).status,
    'resolved',
  );
  for (let i = 0; i < 22; i++)
    await db
      .prepare(
        "INSERT INTO moderation_actions(id,target_kind,target_id,action,reason) VALUES(?,'report',?,'resolve','分页')",
      )
      .bind(randomUUID(), report)
      .run();
  const first = await (await request('/audit', 'GET', undefined, cookie)).json();
  const second = await (await request('/audit?offset=20', 'GET', undefined, cookie)).json();
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 3);
  for (const path of [
    '/overview?days=365',
    '/content?kind=__proto__',
    '/content?kind=report&status=published',
    '/content?offset=-1',
    '/content?kind=supplement&kind=report',
    '/audit?offset=100001',
  ])
    assert.equal((await request(path, 'GET', undefined, cookie)).status, 400);
});
