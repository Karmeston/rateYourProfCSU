import { Hono } from 'hono';
import { readBody } from './request-body.ts';
import interactions from './review-interactions.ts';
import { checkWriteRequest, readVisitor, limitWrite, type AppEnv } from './visitor.ts';
import { reviewTargets } from './review-targets.ts';
import { isResourceId, isUuid } from './validation.ts';
import { contextInput, objectInput, textInput } from './community-input.ts';
import type { OwnReview } from '../shared/community.ts';

const reviews = new Hono<AppEnv>();
const pageSize = 20;
type Review = { id: string; rating: number; body: string; created_at: string };
type RatingCount = { rating: number; count: number };

reviews.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.set('visitorId', await readVisitor(c));
  await next();
});

for (const { kind, reviews: table, foreignKey, votes, replies } of reviewTargets) {
  const visibility = kind === 'courses' ? ' AND is_listed = 1' : '';
  // 表名仅来自上面的固定配置，所有外部值都使用参数绑定。
  reviews.get(`/${kind}/:id/reviews`, async (c) => {
    const rawId = c.req.param('id');
    const query = c.req.queries();
    const rawOffset = query.offset?.[0] ?? '0';
    const sort = query.sort?.[0] ?? 'latest';
    const rating = query.rating?.[0] ?? '';
    if (
      !isResourceId(rawId) ||
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
    const [counts, entries, own] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT rating, count(*) AS count FROM ${table} WHERE ${foreignKey} = ? AND status = 'published' AND withdrawn_at IS NULL GROUP BY rating`,
      ).bind(id),
      c.env.DB.prepare(
        `SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, r.term, r.teacher_name AS teacherName,
        coalesce(r.visitor_id=?,0) AS isMine,
        (SELECT count(*) FROM ${votes} v WHERE v.review_id=r.id AND v.value=1) AS likes,
        (SELECT count(*) FROM ${votes} v WHERE v.review_id=r.id AND v.value=-1) AS dislikes,
        coalesce((SELECT value FROM ${votes} v WHERE v.review_id=r.id AND v.voter_id=?),0) AS myVote,
        (SELECT count(*) FROM ${replies} p WHERE p.review_id=r.id AND p.status='published') AS replyCount
        FROM ${table} r WHERE ${foreignKey} = ? AND status = 'published' AND withdrawn_at IS NULL AND (? = '' OR rating = ?)
        ORDER BY ${sort === 'helpful' ? 'likes DESC, dislikes ASC,' : ''} created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ).bind(
        c.get('visitorId') ?? '',
        c.get('visitorId') ?? '',
        id,
        rating,
        rating,
        pageSize + 1,
        offset,
      ),
      c.env.DB.prepare(
        `SELECT id,rating,body,status,revision,withdrawn_at,term,teacher_name AS teacherName
        FROM ${table} WHERE ${foreignKey}=? AND visitor_id=?`,
      ).bind(id, c.get('visitorId') ?? ''),
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
      myReview: own.results[0] ?? null,
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
    if (!isResourceId(rawId) || Object.keys(c.req.queries()).length)
      return c.json({ error: '查询参数不合法' }, 400);
    const input = await readBody(c.req.raw);
    if ('error' in input) return c.json({ error: input.error }, input.status);
    const value = input.value;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return c.json({ error: '评价格式不正确' }, 400);
    const data = value as Record<string, unknown>;
    if (
      Object.keys(data).some(
        (key) => !['id', 'rating', 'body', 'term', 'teacherName'].includes(key),
      ) ||
      !isUuid(data.id) ||
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
    const context = contextInput(data);
    if (!context) return c.json({ error: '学期或任课教师格式不正确' }, 400);
    const id = Number(rawId);
    const body = data.body.trim();
    const target = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id = ?${visibility}`)
      .bind(id)
      .first();
    if (!target) return c.json({ error: '评价对象不存在' }, 404);
    const limited = await limitWrite(c, 'publish');
    if (limited) return limited;
    // Both the request ID and visitor/target unique index make concurrent retries safe.
    await c.env.DB.prepare(
      `INSERT INTO ${table} (id, ${foreignKey}, rating, body, visitor_id, term, teacher_name, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'published') ON CONFLICT DO NOTHING`,
    )
      .bind(data.id, id, data.rating, body, c.get('visitorId')!, context.term, context.teacherName)
      .run();
    const stored = await c.env.DB.prepare(
      `SELECT ${foreignKey} AS target_id, rating, body, visitor_id, term, teacher_name FROM ${table} WHERE id = ?`,
    )
      .bind(data.id)
      .first<{
        target_id: number;
        rating: number;
        body: string;
        visitor_id: string;
        term: string | null;
        teacher_name: string | null;
      }>();
    if (!stored)
      return c.json(
        { code: 'REVIEW_EXISTS', error: '你已评价过此课程，请刷新后修改或重新发布自己的评价。' },
        409,
      );
    if (
      stored.target_id !== id ||
      stored.visitor_id !== c.get('visitorId') ||
      stored.rating !== data.rating ||
      stored.body !== body ||
      stored.term !== context.term ||
      stored.teacher_name !== context.teacherName
    )
      return c.json({ error: '提交编号冲突，请刷新后查看自己的评价。' }, 409);
    return c.json({ received: true }, 202);
  });

  for (const method of ['PUT', 'DELETE'] as const) {
    reviews.on(method, `/${kind}/:id/reviews/:reviewId`, async (c) => {
      const rejected = checkWriteRequest(c);
      if (rejected) return rejected;
      if (
        !isResourceId(c.req.param('id')) ||
        !isUuid(c.req.param('reviewId')) ||
        Object.keys(c.req.queries()).length
      )
        return c.json({ error: '参数不合法' }, 400);
      const input = await readBody(c.req.raw);
      if ('error' in input) return c.json({ error: input.error }, input.status);
      const data = objectInput(input.value);
      const context = data && contextInput(data);
      if (
        !data ||
        !Number.isSafeInteger(data.revision) ||
        (data.revision as number) < 0 ||
        Object.keys(data).some(
          (key) =>
            !(
              method === 'DELETE'
                ? ['revision']
                : ['revision', 'rating', 'body', 'term', 'teacherName']
            ).includes(key),
        ) ||
        (method === 'PUT' &&
          (!context ||
            !Number.isInteger(data.rating) ||
            (data.rating as number) < 1 ||
            (data.rating as number) > 5 ||
            !textInput(data.body, 2000)))
      )
        return c.json({ error: '评价格式或版本不正确' }, 400);
      const limited = await limitWrite(c, 'publish');
      if (limited) return limited;
      const id = Number(c.req.param('id'));
      const target = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id=?${visibility}`)
        .bind(id)
        .first();
      if (!target) return c.json({ error: '评价对象不存在' }, 404);
      const current = await c.env.DB.prepare(
        `SELECT id,rating,body,status,revision,withdrawn_at,term,teacher_name AS teacherName
        FROM ${table} WHERE id=? AND ${foreignKey}=? AND visitor_id=?`,
      )
        .bind(c.req.param('reviewId'), id, c.get('visitorId')!)
        .first<OwnReview>();
      if (!current) return c.json({ error: '无法操作此评价' }, 404);
      const sameContent =
        current.rating === data.rating &&
        current.body === (typeof data.body === 'string' ? data.body.trim() : '') &&
        current.term === context?.term &&
        current.teacherName === context?.teacherName;
      if (current.revision !== data.revision) {
        if (
          current.revision === Number(data.revision) + 1 &&
          (method === 'DELETE' ? current.withdrawn_at : sameContent && !current.withdrawn_at)
        )
          return c.json({ received: true, revision: current.revision, status: current.status });
        return c.json({ error: '评价已发生变化，请刷新后再操作。' }, 409);
      }
      const result =
        method === 'DELETE'
          ? await c.env.DB.prepare(
              `UPDATE ${table} SET withdrawn_at=coalesce(withdrawn_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          revision=revision+1 WHERE id=? AND visitor_id=? AND revision=?`,
            )
              .bind(current.id, c.get('visitorId')!, data.revision)
              .run()
          : await c.env.DB.prepare(
              `UPDATE ${table} SET rating=?,body=?,term=?,teacher_name=?,withdrawn_at=NULL,
          status=CASE WHEN status='rejected' THEN 'pending' ELSE status END,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1 WHERE id=? AND visitor_id=? AND revision=?`,
            )
              .bind(
                data.rating,
                (data.body as string).trim(),
                context!.term,
                context!.teacherName,
                current.id,
                c.get('visitorId')!,
                data.revision,
              )
              .run();
      if (!result.meta.changes) return c.json({ error: '评价已发生变化，请刷新后再操作。' }, 409);
      return c.json({
        received: true,
        revision: current.revision + 1,
        status: method === 'PUT' && current.status === 'rejected' ? 'pending' : current.status,
      });
    });
  }
}

reviews.route('/', interactions);
export default reviews;
