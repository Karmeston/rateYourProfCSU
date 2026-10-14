import { Hono } from 'hono';
import auth, { checkAdminWrite, readAdmin } from './admin-auth.ts';
import type { AppEnv } from './visitor.ts';
import { readBody } from './request-body.ts';
import { objectInput, textInput } from './community-input.ts';
import { isUuid } from './validation.ts';
import { contentItem, contentPage, isModerationKind, statusesFor } from './admin-content.ts';
import { overview } from './admin-overview.ts';
import { moderate, ModerationError } from './moderation.ts';

const admin = new Hono<AppEnv>();
admin.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  await next();
});
admin.route('/', auth);
admin.use('*', async (c, next) => {
  const id = await readAdmin(c);
  if (!id) return c.json({ error: '请先登录管理后台' }, 401);
  c.set('adminId', id);
  await next();
});
function pageInput(query: Record<string, string[]>, allowed: string[]) {
  return !Object.entries(query).some(
    ([key, values]) => !allowed.includes(key) || values.length !== 1,
  );
}
admin.get('/overview', async (c) => {
  const query = c.req.queries(),
    days = query.days?.[0] ?? '7';
  if (!pageInput(query, ['days']) || !['7', '30'].includes(days))
    return c.json({ error: '参数不合法' }, 400);
  return c.json(await overview(c.env.DB, Number(days)));
});
admin.get('/content', async (c) => {
  const query = c.req.queries(),
    kind = query.kind?.[0] ?? 'supplement',
    status = query.status?.[0] ?? (kind === 'report' ? 'open' : 'pending'),
    offset = query.offset?.[0] ?? '0',
    q = query.q?.[0]?.trim() ?? '';
  if (
    !pageInput(query, ['kind', 'status', 'offset', 'q']) ||
    !isModerationKind(kind) ||
    !['all', ...statusesFor(kind)].includes(status) ||
    !/^(0|[1-9]\d*)$/.test(offset) ||
    Number(offset) > 100000 ||
    q.length > 100 ||
    q.includes('\0')
  )
    return c.json({ error: '参数不合法' }, 400);
  return c.json(await contentPage(c.env.DB, kind, status, q, Number(offset)));
});
admin.get('/content/:kind/:id', async (c) => {
  const kind = c.req.param('kind'),
    id = c.req.param('id');
  if (
    !isModerationKind(kind) ||
    !/^[a-f0-9-]{36}$/i.test(id) ||
    Object.keys(c.req.queries()).length
  )
    return c.json({ error: '参数不合法' }, 400);
  const item = await contentItem(c.env.DB, kind, id);
  return item ? c.json({ item }) : c.json({ error: '记录不存在' }, 404);
});
admin.post('/moderate', async (c) => {
  const rejected = checkAdminWrite(c);
  if (rejected) return rejected;
  if (!c.env.ADMIN_WRITE_LIMITER) return c.json({ error: '后台暂时不可用' }, 503);
  if (!(await c.env.ADMIN_WRITE_LIMITER.limit({ key: `moderate:${c.get('adminId')}` })).success) {
    c.header('Retry-After', '60');
    return c.json({ error: '操作过快，请稍等一分钟' }, 429);
  }
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value);
  if (
    !data ||
    Object.keys(data).some(
      (key) => !['kind', 'id', 'action', 'revision', 'reason', 'requestId'].includes(key),
    ) ||
    !isModerationKind(data.kind) ||
    typeof data.id !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(data.id) ||
    typeof data.action !== 'string' ||
    !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 0 ||
    !textInput(data.reason, 500) ||
    !isUuid(data.requestId) ||
    Object.keys(c.req.queries()).length
  )
    return c.json({ error: '请填写有效的操作、版本和处理理由' }, 400);
  try {
    return c.json(
      await moderate(c.env.DB, {
        kind: data.kind,
        id: data.id,
        action: data.action,
        revision: data.revision as number,
        reason: data.reason as string,
        requestId: data.requestId,
        actor: 'admin',
      }),
    );
  } catch (error) {
    if (error instanceof ModerationError && error.code === 'conflict')
      return c.json({ error: '内容或操作已发生变化，请刷新核对后处理' }, 409);
    if (error instanceof ModerationError && error.code === 'invalid')
      return c.json({ error: '此操作不合法' }, 400);
    throw error;
  }
});
admin.get('/audit', async (c) => {
  const query = c.req.queries(),
    offset = query.offset?.[0] ?? '0';
  if (!pageInput(query, ['offset']) || !/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 100000)
    return c.json({ error: '参数不合法' }, 400);
  const rows = await c.env.DB.prepare(
    'SELECT id,target_kind,target_id,action,reason,actor,target_revision,created_at FROM moderation_actions ORDER BY created_at DESC,id LIMIT 21 OFFSET ?',
  )
    .bind(Number(offset))
    .all();
  return c.json({
    items: rows.results.slice(0, 20),
    offset: Number(offset),
    hasMore: rows.results.length > 20,
  });
});
export default admin;
