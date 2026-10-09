import { Hono } from 'hono';
import { readBody } from './request-body.ts';
import interactions from './review-interactions.ts';
import { checkWriteRequest, readVisitor, limitWrite, type AppEnv } from './visitor.ts';

const reviews = new Hono<AppEnv>();
const pageSize = 20;
const targets = [
  { kind: 'teachers', table: 'teacher_reviews', foreignKey: 'teacher_id' },
  { kind: 'courses', table: 'course_reviews', foreignKey: 'course_id' },
] as const;
type Review = { id: string; rating: number; body: string; created_at: string };
type RatingCount = { rating: number; count: number };

reviews.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.set('visitorId', await readVisitor(c));
  await next();
});

for (const { kind, table, foreignKey } of targets) {
  const visibility = kind === 'courses' ? ' AND is_listed = 1' : '';
  // 表名仅来自上面的固定配置，所有外部值都使用参数绑定。
  reviews.get(`/${kind}/:id/reviews`, async (c) => {
    const rawId = c.req.param('id');
    const query = c.req.queries();
    const rawOffset = query.offset?.[0] ?? '0';
    const sort = query.sort?.[0] ?? 'latest';
    const rating = query.rating?.[0] ?? '';
    if (
      !/^-?[1-9]\d*$/.test(rawId) ||
      !Number.isSafeInteger(Number(rawId)) ||
      Object.entries(query).some(
        ([key, values]) => !['offset', 'sort', 'rating'].includes(key) || values.length !== 1,
      ) ||
      !['latest', 'helpful'].includes(sort) ||
      (query.rating && !/^[1-5]$/.test(rating)) ||
      !/^(0|[1-9]\d*)$/.test(rawOffset) ||
      Number(rawOffset) > 100000
    ) {
      return c.json({ error: '查询参数不合法' }, 400);
    }
    const id = Number(rawId);
    const offset = Number(rawOffset);
    const target = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id = ?${visibility}`)
      .bind(id)
      .first();
    if (!target) return c.json({ error: '评价对象不存在' }, 404);
    const [counts, entries] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT rating, count(*) AS count FROM ${table} WHERE ${foreignKey} = ? AND status = 'published' GROUP BY rating`,
      ).bind(id),
      c.env.DB.prepare(
        `SELECT r.id, r.rating, r.body, r.created_at,
        (SELECT count(*) FROM ${table.slice(0, -1)}_votes v WHERE v.review_id=r.id AND v.value=1) AS likes,
        (SELECT count(*) FROM ${table.slice(0, -1)}_votes v WHERE v.review_id=r.id AND v.value=-1) AS dislikes,
        coalesce((SELECT value FROM ${table.slice(0, -1)}_votes v WHERE v.review_id=r.id AND v.voter_id=?),0) AS myVote,
        (SELECT count(*) FROM ${table.slice(0, -1)}_replies p WHERE p.review_id=r.id AND p.status='published') AS replyCount
        FROM ${table} r WHERE ${foreignKey} = ? AND status = 'published' AND (? = '' OR rating = ?)
        ORDER BY ${sort === 'helpful' ? 'likes DESC, dislikes ASC,' : ''} created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ).bind(c.get('visitorId') ?? '', id, rating, rating, pageSize + 1, offset),
    ]);
    const histogram = counts.results as RatingCount[];
    const count = histogram.reduce((sum, row) => sum + row.count, 0);
    const total = histogram.reduce((sum, row) => sum + row.rating * row.count, 0);
    const distribution = [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: histogram.find((row) => row.rating === rating)?.count ?? 0,
    }));
    return c.json({
      reviews: (entries.results as Review[]).slice(0, pageSize),
      summary: { count, average: count ? total / count : null, distribution },
      total: rating ? distribution.find((row) => row.rating === Number(rating))!.count : count,
      limit: pageSize,
      offset,
      sort,
      rating: rating ? Number(rating) : null,
      hasMore: entries.results.length > pageSize,
    });
  });

  reviews.post(`/${kind}/:id/reviews`, async (c) => {
    const rejected = checkWriteRequest(c);
    if (rejected) return rejected;
    const rawId = c.req.param('id');
    if (
      !/^-?[1-9]\d*$/.test(rawId) ||
      !Number.isSafeInteger(Number(rawId)) ||
      Object.keys(c.req.queries()).length
    )
      return c.json({ error: '查询参数不合法' }, 400);
    const input = await readBody(c.req.raw);
    if ('error' in input) return c.json({ error: input.error }, input.status);
    const value = input.value;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return c.json({ error: '评价格式不正确' }, 400);
    const data = value as Record<string, unknown>;
    if (
      Object.keys(data).some((key) => !['id', 'rating', 'body'].includes(key)) ||
      typeof data.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id) ||
      typeof data.rating !== 'number' ||
      !Number.isInteger(data.rating) ||
      data.rating < 1 ||
      data.rating > 5 ||
      typeof data.body !== 'string' ||
      !data.body.trim() ||
      data.body.length > 2000 ||
      data.body.includes('\0')
    ) {
      return c.json({ error: '请选择 1–5 星，并填写 1–2000 字的评论' }, 400);
    }
    const id = Number(rawId);
    const body = data.body.trim();
    const target = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id = ?${visibility}`)
      .bind(id)
      .first();
    if (!target) return c.json({ error: '评价对象不存在' }, 404);
    const limited = await limitWrite(c, 'publish');
    if (limited) return limited;
    // 同一个提交 ID 重试不会重复写入；不允许客户端指定审核状态。
    // 验证阶段直接公开，保留状态字段供以后启用审核。
    await c.env.DB.prepare(
      `INSERT INTO ${table} (id, ${foreignKey}, rating, body, status) VALUES (?, ?, ?, ?, 'published') ON CONFLICT(id) DO NOTHING`,
    )
      .bind(data.id, id, data.rating, body)
      .run();
    const stored = await c.env.DB.prepare(
      `SELECT ${foreignKey} AS target_id, rating, body FROM ${table} WHERE id = ?`,
    )
      .bind(data.id)
      .first<{ target_id: number; rating: number; body: string }>();
    if (!stored || stored.target_id !== id || stored.rating !== data.rating || stored.body !== body)
      return c.json({ error: '提交编号冲突，请重新打开评价表单' }, 409);
    return c.json({ received: true }, 202);
  });
}

reviews.route('/', interactions);
export default reviews;
