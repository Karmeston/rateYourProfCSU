import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';

test('评价投票与单层回复（临时 D1）', async (t) => {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const { DB } = platform.env;
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(new URL(name, dir), 'utf8').split(';').filter((part) => part.trim())) await DB.prepare(sql).run();
  }
  const reviewId = randomUUID();
  const voter = randomUUID();
  const request = (url, init) => app.request(url, init, platform.env);
  const write = (url, method, data, browser = voter, extra = {}) => request(url, {
    method, headers: { 'Content-Type': 'application/json', 'X-Browser-ID': browser, ...extra }, body: JSON.stringify(data),
  });
  for (const kind of ['teachers', 'courses']) {
    const singular = kind.slice(0, -1);
    await DB.prepare(`INSERT INTO ${kind} (id,name,department) VALUES (1,?,?)`).bind('测试对象', '测试学院').run();
    await DB.prepare(`INSERT INTO ${singular}_reviews (id,${singular}_id,rating,body,status) VALUES (?,1,4,?,'published')`).bind(reviewId, '测试评价').run();
    const base = `/api/${kind}/1/reviews`;
    const path = `${base}/${reviewId}`;
    await t.test(`${kind} 投票可重试、切换和取消，不改变星级`, async () => {
      const vote = async (value, browser) => {
        const response = await write(`${path}/vote`, 'PUT', { value }, browser);
        assert.equal(response.status, 200);
        return response.json();
      };
      assert.deepEqual(await vote(1), { likes: 1, dislikes: 0, myVote: 1 });
      assert.deepEqual(await vote(1), { likes: 1, dislikes: 0, myVote: 1 });
      assert.deepEqual(await vote(-1), { likes: 0, dislikes: 1, myVote: -1 });
      assert.deepEqual(await vote(1, randomUUID()), { likes: 1, dislikes: 1, myVote: 1 });
      assert.deepEqual(await vote(0), { likes: 1, dislikes: 0, myVote: 0 });
      assert.deepEqual(await vote(0), { likes: 1, dislikes: 0, myVote: 0 });
      await vote(-1);
      const data = await (await request(base, { headers: { 'X-Browser-ID': voter } })).json();
      assert.equal(data.summary.count, 1);
      assert.equal(data.summary.average, 4);
      assert.equal(data.reviews[0].myVote, -1);
      assert.equal(data.reviews[0].likes, 1);
      assert.equal(data.reviews[0].dislikes, 1);
      assert.equal((await (await request(base)).json()).reviews[0].myVote, 0);
      assert.ok(!JSON.stringify(data).includes(voter));
    });
    await t.test(`${kind} 回复去重、分页且仅返回公开内容`, async () => {
      const body = { id: randomUUID(), body: '  <b>测试回复</b>  ' };
      for (let i = 0; i < 2; i++) {
        const response = await write(`${path}/replies`, 'POST', body);
        assert.equal(response.status, 201);
        assert.equal((await response.json()).replyCount, 1);
      }
      assert.equal((await write(`${path}/replies`, 'POST', { ...body, body: '改写' })).status, 409);
      const first = await (await request(`${path}/replies`)).json();
      assert.equal(first.replies[0].body, '<b>测试回复</b>');
      for (let i = 0; i < 21; i++) await DB.prepare(`INSERT INTO ${singular}_review_replies (id,review_id,body,status) VALUES (?,?,?,?)`).bind(randomUUID(), reviewId, `回复 ${i}`, i === 20 ? 'pending' : 'published').run();
      const page1 = await (await request(`${path}/replies`)).json();
      const page2 = await (await request(`${path}/replies?offset=20`)).json();
      assert.equal(page1.replies.length, 20);
      assert.equal(page1.hasMore, true);
      assert.equal(page2.replies.length, 1);
      assert.equal(page2.hasMore, false);
      assert.equal(new Set([...page1.replies, ...page2.replies].map((r) => r.id)).size, 21);
      assert.equal((await (await request(base)).json()).reviews[0].replyCount, 21);
    });
    await t.test(`${kind} 拒绝非法输入、跨站写入及不可见评价`, async () => {
      for (const value of [2, '1', null, true]) assert.equal((await write(`${path}/vote`, 'PUT', { value })).status, 400);
      assert.equal((await write(`${path}/vote`, 'PUT', { value: 1 }, '')).status, 400);
      assert.equal((await write(`${path}/vote`, 'PUT', { value: 1 }, voter, { Origin: 'https://other.example' })).status, 403);
      assert.equal((await write(`${path}/replies`, 'POST', { id: randomUUID(), body: 'x'.repeat(1001) })).status, 400);
      assert.equal((await write(`${path}/replies`, 'POST', { id: randomUUID(), body: 'ok', status: 'published' })).status, 400);
      assert.equal((await request(`${path}/replies?offset=0&offset=1`)).status, 400);
      assert.equal((await request(`${base}/${randomUUID()}/replies`)).status, 404);
      await DB.prepare(`UPDATE ${singular}_reviews SET status='pending' WHERE id=?`).bind(reviewId).run();
      assert.equal((await request(`${path}/replies`)).status, 404);
      assert.equal((await write(`${path}/vote`, 'PUT', { value: 1 })).status, 404);
      assert.equal((await write(`${path}/replies`, 'POST', { id: randomUUID(), body: 'ok' })).status, 404);
      await DB.prepare(`UPDATE ${singular}_reviews SET status='published' WHERE id=?`).bind(reviewId).run();
      if (kind === 'courses') {
        await DB.prepare('UPDATE courses SET is_listed=0 WHERE id=1').run();
        assert.equal((await request(`${path}/replies`)).status, 404);
        assert.equal((await write(`${path}/vote`, 'PUT', { value: 1 })).status, 404);
      }
    });
  }
});
