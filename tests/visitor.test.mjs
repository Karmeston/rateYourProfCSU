import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { generateSignedCookie } from 'hono/cookie';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';
import { migrate } from './helpers/database.mjs';
import { issueCookie, testSecret, visitorEnv } from './helpers/visitor.mjs';

const json = (method, value, cookie, extra = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
  body: JSON.stringify(value),
});
const signed = async (value, secret = testSecret) =>
  (await generateSignedCookie('csu-visitor', value, secret, { path: '/' })).split(';')[0];

test('匿名访客 Cookie 与频率限制（临时 D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const env = visitorEnv(platform);
  const { DB } = env;
  await migrate(DB);
  await DB.prepare(
    "INSERT INTO courses (id,name,department) VALUES (1,'测试课程','测试学院')",
  ).run();
  const reviewId = randomUUID();
  await DB.prepare(
    "INSERT INTO course_reviews (id,course_id,rating,body,status) VALUES (?,1,4,'测试评价','published')",
  )
    .bind(reviewId)
    .run();
  const base = '/api/courses/1/reviews';
  const path = `${base}/${reviewId}`;
  const request = (url, init, bindings = env) => app.request(url, init, bindings);
  const cookie = await issueCookie(env);

  await t.test('Cookie 具备安全属性；有效访客不重复签发；不返回标识', async () => {
    const secure = await request(
      'https://example.test/api/visitor',
      json('POST', {}, undefined, { 'CF-Connecting-IP': '192.0.2.1' }),
    );
    assert.equal(secure.status, 204);
    const header = secure.headers.get('Set-Cookie');
    assert.ok(header.startsWith('__Host-csu-visitor='));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=15552000'])
      assert.ok(header.includes(flag));
    assert.ok(!header.includes('Domain='));
    assert.equal(await secure.text(), '');
    const repeat = await request('/api/visitor', json('POST', {}, cookie));
    assert.equal(repeat.status, 204);
    assert.equal(repeat.headers.get('Set-Cookie'), null);
    assert.equal(repeat.headers.get('Cache-Control'), 'no-store');
    const local = await request('/api/visitor', json('POST', {}));
    assert.ok(local.headers.get('Set-Cookie').startsWith('csu-visitor='));
    assert.ok(local.headers.get('Set-Cookie').includes('HttpOnly'));
    assert.ok(!local.headers.get('Set-Cookie').includes('Secure'));
    assert.equal((await request('http://example.test/api/visitor', json('POST', {}))).status, 503);
  });

  await t.test('签名篡改、过期、未来时间和旧请求头不能建立身份', async () => {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();
    const valid = await signed(`v1.${id}.${now}`);
    const forged = valid.replace(id, randomUUID());
    for (const invalid of [
      undefined,
      'csu-visitor=garbage',
      forged,
      await signed(`v1.${id}.${now}`, 'another-synthetic-secret-32-characters'),
      await signed(`v1.${id}.${now - 180 * 86400}`),
      await signed(`v1.${id}.${now + 3600}`),
      await signed(`v1.bad.${now}`),
    ]) {
      const vote = await request(
        `${path}/vote`,
        json('PUT', { value: 1 }, invalid, { 'X-Browser-ID': id }),
      );
      assert.equal(vote.status, 401);
      assert.equal((await vote.json()).code, 'VISITOR_REQUIRED');
      const page = await (
        await request(base, {
          headers: { ...(invalid ? { Cookie: invalid } : {}), 'X-Browser-ID': id },
        })
      ).json();
      assert.equal(page.reviews[0].myVote, 0);
    }
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM course_review_votes').first()).n, 0);
  });

  await t.test('同一 Cookie 投票去重、刷新恢复；两个访客互不冒充', async () => {
    const other = await issueCookie(env);
    const vote = (value, identity, headers) =>
      request(`${path}/vote`, json('PUT', { value }, identity, headers));
    for (let i = 0; i < 2; i++)
      assert.deepEqual(await (await vote(1, cookie)).json(), { likes: 1, dislikes: 0, myVote: 1 });
    assert.deepEqual(await (await vote(-1, other, { 'X-Browser-ID': 'ignored' })).json(), {
      likes: 1,
      dislikes: 1,
      myVote: -1,
    });
    const page = await (
      await request(base, { headers: { Cookie: cookie, 'X-Browser-ID': randomUUID() } })
    ).json();
    assert.equal(page.reviews[0].myVote, 1);
    assert.ok(!JSON.stringify(page).includes(cookie));
    assert.equal(
      (await (await request(base, { headers: { 'X-Browser-ID': randomUUID() } })).json()).reviews[0]
        .myVote,
      0,
    );
    assert.deepEqual(await (await vote(0, cookie)).json(), { likes: 0, dislikes: 1, myVote: 0 });
  });

  await t.test('评价和回复均要求 Cookie；跨站、非 JSON、附加参数被拒绝', async () => {
    const submission = { id: randomUUID(), rating: 5, body: '测试正文' };
    assert.equal((await request(base, json('POST', submission))).status, 401);
    assert.equal(
      (await request(`${path}/replies`, json('POST', { id: randomUUID(), body: '回复' }))).status,
      401,
    );
    for (const headers of [{ Origin: 'https://other.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await request('/api/visitor', json('POST', {}, cookie, headers))).status, 403);
      assert.equal((await request(base, json('POST', submission, cookie, headers))).status, 403);
      assert.equal(
        (await request(`${path}/vote`, json('PUT', { value: 1 }, cookie, headers))).status,
        403,
      );
      assert.equal(
        (
          await request(
            `${path}/replies`,
            json('POST', { id: randomUUID(), body: '回复' }, cookie, headers),
          )
        ).status,
        403,
      );
    }
    assert.equal(
      (await request('/api/visitor', json('POST', {}, cookie, { 'Content-Type': 'text/plain' })))
        .status,
      415,
    );
    assert.equal((await request('/api/visitor?extra=1', json('POST', {}, cookie))).status, 400);
    assert.equal((await request('/api/visitor', json('POST', { id: randomUUID() }))).status, 400);
    assert.equal(
      (await request('/api/visitor', json('POST', {}, undefined, { Origin: 'http://localhost' })))
        .status,
      204,
    );
  });

  await t.test('缺少密钥或限流配置时写入失败关闭，公开浏览不受影响', async () => {
    for (const missing of [
      { VISITOR_SECRET: undefined },
      { VISITOR_SECRET: 'weak' },
      { NETWORK_LIMITER: undefined },
      { VOTE_LIMITER: undefined },
    ]) {
      assert.equal(
        (await request(`${path}/vote`, json('PUT', { value: 1 }, cookie), { ...env, ...missing }))
          .status,
        503,
      );
      assert.equal((await request(base, undefined, { ...env, ...missing })).status, 200);
    }
    assert.equal(
      (await request('/api/visitor', json('POST', {}), { ...env, VISITOR_SECRET: undefined }))
        .status,
      503,
    );
    assert.equal((await request('https://example.test/api/visitor', json('POST', {}))).status, 503);
  });

  await t.test('发布与回复共用每访客额度，超限不写入并允许另一访客互动', async () => {
    const publisher = await issueCookie(env);
    for (let i = 0; i < 8; i++)
      await DB.prepare("INSERT INTO courses(id,name,department) VALUES (?,'限流测试','测试学院')")
        .bind(10 + i)
        .run();
    for (let i = 0; i < 8; i++) {
      const response =
        i % 2
          ? await request(
              `${path}/replies`,
              json('POST', { id: randomUUID(), body: `测试回复 ${i}` }, publisher),
            )
          : await request(
              `/api/courses/${10 + i}/reviews`,
              json('POST', { id: randomUUID(), rating: 5, body: `测试评价 ${i}` }, publisher),
            );
      assert.equal(response.status, i % 2 ? 201 : 202);
    }
    const id = randomUUID();
    const limited = await request(base, json('POST', { id, rating: 5, body: '超限' }, publisher));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
    assert.equal(
      await DB.prepare('SELECT id FROM course_reviews WHERE id=?').bind(id).first(),
      null,
    );
    assert.equal((await request(base)).status, 200);
    assert.equal(
      (await request(base, json('POST', { id, rating: 5, body: '超限' }, cookie))).status,
      202,
    );
  });

  await t.test('投票与网络额度都被执行，转发头不能改变网络计数键', async () => {
    const keys = [];
    const network = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    };
    const reject = { limit: async () => ({ success: false }) };
    const allow = { limit: async () => ({ success: true }) };
    const limitedVote = await request(`${path}/vote`, json('PUT', { value: 1 }, cookie), {
      ...env,
      NETWORK_LIMITER: network,
      VOTE_LIMITER: reject,
    });
    assert.equal(limitedVote.status, 429);
    const blockedNetwork = await request(`${path}/vote`, json('PUT', { value: 1 }, cookie), {
      ...env,
      NETWORK_LIMITER: reject,
      VOTE_LIMITER: allow,
    });
    assert.equal(blockedNetwork.status, 429);
    const other = await issueCookie(env);
    for (const identity of [cookie, other]) {
      assert.equal(
        (
          await request(
            `${path}/vote`,
            json('PUT', { value: 1 }, identity, { 'X-Forwarded-For': randomUUID() }),
            { ...env, NETWORK_LIMITER: network, VOTE_LIMITER: allow },
          )
        ).status,
        200,
      );
    }
    assert.equal(new Set(keys).size, 1);
    assert.match(keys[0], /^write:[0-9a-f]{64}$/);
  });

  await t.test('新访客签发按网络限流；清 Cookie 与伪造转发头不能绕过', async () => {
    const url = 'https://example.test/api/visitor';
    const headers = { 'CF-Connecting-IP': '192.0.2.60' };
    let firstCookie;
    for (let i = 0; i < 60; i++) {
      const response = await request(
        url,
        json('POST', {}, undefined, { ...headers, 'X-Forwarded-For': randomUUID() }),
      );
      assert.equal(response.status, 204);
      firstCookie ??= response.headers.get('Set-Cookie').split(';')[0];
    }
    const rejected = await request(url, json('POST', {}, undefined, headers));
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get('Set-Cookie'), null);
    assert.equal((await request(url, json('POST', {}, firstCookie, headers))).status, 204);
    assert.equal(
      (await request(url, json('POST', {}, undefined, { 'CF-Connecting-IP': '192.0.2.61' })))
        .status,
      204,
    );
  });
});
