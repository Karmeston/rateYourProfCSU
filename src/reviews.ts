import { Hono } from 'hono';

const reviews = new Hono<{ Bindings: Env }>();
const pageSize = 20;
const targets = [
  { kind: 'teachers', table: 'teacher_reviews', foreignKey: 'teacher_id' },
  { kind: 'courses', table: 'course_reviews', foreignKey: 'course_id' },
] as const;
type Review = { id: string; rating: number; body: string; created_at: string };
type RatingCount = { rating: number; count: number };

// 不信任 Content-Length，按实际读取字节限制请求体。
async function readBody(request: Request) {
  if (!request.body) return { error: '请填写评价', status: 400 as const };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return { error: '评价内容过长', status: 413 as const };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { error: '请求格式不正确', status: 400 as const };
  } finally { reader.releaseLock(); }
}

reviews.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

for (const { kind, table, foreignKey } of targets) {
  const visibility = kind === 'courses' ? ' AND is_listed = 1' : '';
  // 表名仅来自上面的固定配置，所有外部值都使用参数绑定。
  reviews.get(`/${kind}/:id/reviews`, async (c) => {
    const rawId = c.req.param('id');
    const query = c.req.queries();
    const rawOffset = query.offset?.[0] ?? '0';
    if (!/^-?[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))
      || Object.keys(query).some((key) => key !== 'offset') || (query.offset && query.offset.length !== 1)
      || !/^(0|[1-9]\d*)$/.test(rawOffset) || Number(rawOffset) > 100000) {
      return c.json({ error: '查询参数不合法' }, 400);
    }
    const id = Number(rawId);
    const offset = Number(rawOffset);
    const target = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id = ?${visibility}`).bind(id).first();
    if (!target) return c.json({ error: '评价对象不存在' }, 404);
    const [counts, entries] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT rating, count(*) AS count FROM ${table} WHERE ${foreignKey} = ? AND status = 'published' GROUP BY rating`).bind(id),
      c.env.DB.prepare(`SELECT id, rating, body, created_at FROM ${table} WHERE ${foreignKey} = ? AND status = 'published' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(id, pageSize + 1, offset),
    ]);
    const histogram = counts.results as RatingCount[];
    const count = histogram.reduce((sum, row) => sum + row.count, 0);
    const total = histogram.reduce((sum, row) => sum + row.rating * row.count, 0);
    const distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: histogram.find((row) => row.rating === rating)?.count ?? 0 }));
    return c.json({ reviews: (entries.results as Review[]).slice(0, pageSize), summary: { count, average: count ? total / count : null, distribution }, limit: pageSize, offset, hasMore: entries.results.length > pageSize });
  });

  reviews.post(`/${kind}/:id/reviews`, async (c) => {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: '不支持跨站提交' }, 403);
    if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: '请使用 JSON 提交' }, 415);
    const rawId = c.req.param('id');
    if (!/^-?[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Object.keys(c.req.queries()).length) return c.json({ error: '查询参数不合法' }, 400);
    const input = await readBody(c.req.raw);
    if ('error' in input) return c.json({ error: input.error }, input.status);
    const value = input.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return c.json({ error: '评价格式不正确' }, 400);
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some((key) => !['id', 'rating', 'body'].includes(key))
      || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)
      || typeof data.rating !== 'number' || !Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5
      || typeof data.body !== 'string' || !data.body.trim() || data.body.length > 2000 || data.body.includes('\0')) {
      return c.json({ error: '请选择 1–5 星，并填写 1–2000 字的评论' }, 400);
    }
    const id = Number(rawId);
    const body = data.body.trim();
    const target = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id = ?${visibility}`).bind(id).first();
    if (!target) return c.json({ error: '评价对象不存在' }, 404);
    // 同一个提交 ID 重试不会重复写入；不允许客户端指定审核状态。
    // 验证阶段直接公开，保留状态字段供以后启用审核。
    await c.env.DB.prepare(`INSERT INTO ${table} (id, ${foreignKey}, rating, body, status) VALUES (?, ?, ?, ?, 'published') ON CONFLICT(id) DO NOTHING`).bind(data.id, id, data.rating, body).run();
    const stored = await c.env.DB.prepare(`SELECT ${foreignKey} AS target_id, rating, body FROM ${table} WHERE id = ?`).bind(data.id).first<{ target_id: number; rating: number; body: string }>();
    if (!stored || stored.target_id !== id || stored.rating !== data.rating || stored.body !== body) return c.json({ error: '提交编号冲突，请重新打开评价表单' }, 409);
    return c.json({ received: true }, 202);
  });
}

export default reviews;
