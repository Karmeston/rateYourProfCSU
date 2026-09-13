import { Hono } from 'hono';
import { readBody } from './request-body.ts';

const app = new Hono<{ Bindings: Env }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const kind of ['teachers', 'courses'] as const) {
  const singular = kind.slice(0, -1);
  const reviews = `${singular}_reviews`;
  const votes = `${singular}_review_votes`;
  const replies = `${singular}_review_replies`;
  const path = `/${kind}/:id/reviews/:reviewId`;
  app.use(`${path}/*`, async (c, next) => {
    const id = c.req.param('id') ?? '';
    const reviewId = c.req.param('reviewId') ?? '';
    if (!/^-?[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !uuid.test(reviewId)) return c.json({ error: '参数不合法' }, 400);
    const origin = c.req.header('Origin');
    if (c.req.method !== 'GET') {
      if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: '不支持跨站提交' }, 403);
      if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: '请使用 JSON 提交' }, 415);
      if (Object.keys(c.req.queries()).length) return c.json({ error: '参数不合法' }, 400);
    }
    const parent = await c.env.DB.prepare(`SELECT r.id FROM ${reviews} r JOIN ${kind} t ON t.id=r.${singular}_id WHERE r.id=? AND t.id=? AND r.status='published' ${kind === 'courses' ? 'AND t.is_listed=1' : ''}`).bind(reviewId, Number(id)).first();
    if (!parent) return c.json({ error: '评价不存在' }, 404);
    await next();
  });
  app.put(`${path}/vote`, async (c) => {
    const voter = c.req.header('X-Browser-ID') ?? '';
    if (!uuid.test(voter)) return c.json({ error: '浏览器标识无效' }, 400);
    const input = await readBody(c.req.raw);
    if ('error' in input) return c.json({ error: input.error }, input.status);
    const data = input.value as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || ![-1, 0, 1].includes(data.value as number)) return c.json({ error: '投票值无效' }, 400);
    const id = c.req.param('reviewId');
    const mutation = data.value === 0
      ? c.env.DB.prepare(`DELETE FROM ${votes} WHERE review_id=? AND voter_id=?`).bind(id, voter)
      : c.env.DB.prepare(`INSERT INTO ${votes} (review_id,voter_id,value) VALUES (?,?,?) ON CONFLICT(review_id,voter_id) DO UPDATE SET value=excluded.value`).bind(id, voter, data.value);
    const result = await c.env.DB.batch([mutation, c.env.DB.prepare(`SELECT
      count(CASE WHEN value=1 THEN 1 END) AS likes,
      count(CASE WHEN value=-1 THEN 1 END) AS dislikes,
      coalesce(max(CASE WHEN voter_id=? THEN value END),0) AS myVote FROM ${votes} WHERE review_id=?`).bind(voter, id)]);
    return c.json(result[1].results[0]);
  });
  app.get(`${path}/replies`, async (c) => {
    const query = c.req.queries();
    const offset = query.offset?.[0] ?? '0';
    if (Object.keys(query).some((key) => key !== 'offset') || (query.offset && query.offset.length !== 1) || !/^(0|[1-9]\d*)$/.test(offset) || Number(offset)>100000) return c.json({ error: '分页参数无效' },400);
    const { results } = await c.env.DB.prepare(`SELECT id,body,created_at FROM ${replies} WHERE review_id=? AND status='published' ORDER BY created_at,id LIMIT ? OFFSET ?`).bind(c.req.param('reviewId'),21,Number(offset)).all();
    return c.json({ replies: results.slice(0,20), offset:Number(offset), hasMore:results.length>20 });
  });
  app.post(`${path}/replies`, async (c) => {
    const input = await readBody(c.req.raw);
    if ('error' in input) return c.json({ error: input.error }, input.status);
    const data = input.value as Record<string,unknown> | null;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((key)=>!['id','body'].includes(key)) || typeof data.id !== 'string' || !uuid.test(data.id) || typeof data.body !== 'string' || !data.body.trim() || data.body.length>1000 || data.body.includes('\0')) return c.json({ error: '请填写 1–1000 字的回复' },400);
    const parent = c.req.param('reviewId');
    const body = data.body.trim();
    await c.env.DB.prepare(`INSERT INTO ${replies} (id,review_id,body) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`).bind(data.id,parent,body).run();
    const stored = await c.env.DB.prepare(`SELECT review_id,body FROM ${replies} WHERE id=?`).bind(data.id).first<{review_id:string;body:string}>();
    if (!stored || stored.review_id!==parent || stored.body!==body) return c.json({error:'提交编号冲突，请重新打开回复区'},409);
    const count = await c.env.DB.prepare(`SELECT count(*) AS n FROM ${replies} WHERE review_id=? AND status='published'`).bind(parent).first<{n:number}>();
    return c.json({received:true,replyCount:count?.n ?? 0},201);
  });
}
export default app;
