import { Hono, type Context } from 'hono';
import { reportReasons, supplementKinds } from '../shared/community.ts';
import { checkWriteRequest, limitWrite, readVisitor, type AppEnv } from './visitor.ts';
import { readBody } from './request-body.ts';
import { contextInput, objectInput, sourceUrl, textInput } from './community-input.ts';
import { isResourceId, isUuid } from './validation.ts';
import { reviewTargets } from './review-targets.ts';

const community = new Hono<AppEnv>();
community.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.set('visitorId', await readVisitor(c));
  await next();
});

async function report(c: Context<AppEnv>, kind: string, id: string) {
  const rejected = checkWriteRequest(c);
  if (rejected) return rejected;
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value);
  if (
    !data ||
    Object.keys(data).some((key) => !['id', 'reason', 'details'].includes(key)) ||
    !isUuid(data.id) ||
    typeof data.reason !== 'string' ||
    !Object.hasOwn(reportReasons, data.reason) ||
    typeof data.details !== 'string' ||
    data.details.length > 1000 ||
    data.details.includes('\0')
  )
    return c.json({ error: '请填写有效的举报原因，说明最多1000字。' }, 400);
  const limited = await limitWrite(c, 'publish');
  if (limited) return limited;
  await c.env.DB.prepare(
    `INSERT INTO content_reports(id,target_kind,target_id,visitor_id,reason,details)
    VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
  )
    .bind(data.id, kind, id, c.get('visitorId')!, data.reason, data.details.trim())
    .run();
  const stored = await c.env.DB.prepare(
    'SELECT target_kind,target_id,visitor_id FROM content_reports WHERE id=?',
  )
    .bind(data.id)
    .first<{ target_kind: string; target_id: string; visitor_id: string }>();
  if (
    stored &&
    (stored.target_kind !== kind ||
      stored.target_id !== id ||
      stored.visitor_id !== c.get('visitorId'))
  )
    return c.json({ error: '举报编号冲突，请重新打开表单。' }, 409);
  return c.json({ received: true }, 202);
}

community.use('/courses/:id/supplements*', async (c, next) => {
  if (!isResourceId(c.req.param('id') ?? '')) return c.json({ error: '参数不合法' }, 400);
  const found = await c.env.DB.prepare('SELECT id FROM courses WHERE id=? AND is_listed=1')
    .bind(Number(c.req.param('id')))
    .first();
  if (!found) return c.json({ error: '课程不存在' }, 404);
  await next();
});
community.get('/courses/:id/supplements', async (c) => {
  const query = c.req.queries(),
    offset = query.offset?.[0] ?? '0';
  if (
    Object.entries(query).some(([key, values]) => key !== 'offset' || values.length !== 1) ||
    !/^(0|[1-9]\d*)$/.test(offset) ||
    Number(offset) > 100000
  )
    return c.json({ error: '参数不合法' }, 400);
  const columns =
    'id,kind,body,source_url AS sourceUrl,term,teacher_name AS teacherName,created_at';
  const [entries, mine] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${columns} FROM course_supplements WHERE course_id=? AND status='published' ORDER BY created_at DESC,id LIMIT 21 OFFSET ?`,
    ).bind(Number(c.req.param('id')), Number(offset)),
    c.env.DB.prepare(
      `SELECT ${columns},status FROM course_supplements WHERE course_id=? AND visitor_id=? AND status<>'published' ORDER BY created_at DESC,id LIMIT 20`,
    ).bind(Number(c.req.param('id')), c.get('visitorId') ?? ''),
  ]);
  return c.json({
    supplements: entries.results.slice(0, 20),
    mine: mine.results,
    offset: Number(offset),
    hasMore: entries.results.length > 20,
  });
});
community.post('/courses/:id/supplements', async (c) => {
  const rejected = checkWriteRequest(c);
  if (rejected) return rejected;
  if (Object.keys(c.req.queries()).length) return c.json({ error: '参数不合法' }, 400);
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value),
    context = data && contextInput(data),
    url = sourceUrl(data?.sourceUrl);
  if (
    !data ||
    !context ||
    url === false ||
    Object.keys(data).some(
      (key) => !['id', 'kind', 'body', 'sourceUrl', 'term', 'teacherName'].includes(key),
    ) ||
    !isUuid(data.id) ||
    typeof data.kind !== 'string' ||
    !Object.hasOwn(supplementKinds, data.kind) ||
    !textInput(data.body, 2000)
  )
    return c.json({ error: '请填写有效的补充内容；来源链接须为HTTPS，学期和教师为选填。' }, 400);
  const limited = await limitWrite(c, 'publish');
  if (limited) return limited;
  await c.env.DB.prepare(
    `INSERT INTO course_supplements(id,course_id,visitor_id,kind,body,source_url,term,teacher_name)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      data.id,
      Number(c.req.param('id')),
      c.get('visitorId')!,
      data.kind,
      (data.body as string).trim(),
      url,
      context.term,
      context.teacherName,
    )
    .run();
  const stored = await c.env.DB.prepare(
    'SELECT course_id,visitor_id,kind,body,source_url,term,teacher_name FROM course_supplements WHERE id=?',
  )
    .bind(data.id)
    .first<{
      course_id: number;
      visitor_id: string;
      kind: string;
      body: string;
      source_url: string | null;
      term: string | null;
      teacher_name: string | null;
    }>();
  if (
    !stored ||
    stored.course_id !== Number(c.req.param('id')) ||
    stored.visitor_id !== c.get('visitorId') ||
    stored.kind !== data.kind ||
    stored.body !== (data.body as string).trim() ||
    stored.source_url !== url ||
    stored.term !== context.term ||
    stored.teacher_name !== context.teacherName
  )
    return c.json({ error: '提交编号冲突，请重新打开补充表单。' }, 409);
  return c.json({ received: true, status: 'pending' }, 202);
});
community.post('/courses/:id/supplements/:supplementId/reports', async (c) => {
  if (!isUuid(c.req.param('supplementId')) || Object.keys(c.req.queries()).length)
    return c.json({ error: '参数不合法' }, 400);
  const parent = await c.env.DB.prepare(
    "SELECT id FROM course_supplements WHERE id=? AND course_id=? AND status='published'",
  )
    .bind(c.req.param('supplementId'), Number(c.req.param('id')))
    .first();
  if (!parent) return c.json({ error: '补充资料不存在' }, 404);
  return report(c, 'supplement', c.req.param('supplementId'));
});

for (const { kind, reviews, replies, foreignKey } of reviewTargets) {
  for (const reply of [false, true]) {
    const path = `/${kind}/:id/reviews/:reviewId${reply ? '/replies/:replyId' : ''}/reports`;
    community.post(path, async (c) => {
      const id = c.req.param('id') ?? '',
        reviewId = c.req.param('reviewId'),
        replyId = c.req.param('replyId');
      if (
        !isResourceId(id) ||
        !isUuid(reviewId) ||
        (reply && !isUuid(replyId)) ||
        Object.keys(c.req.queries()).length
      )
        return c.json({ error: '参数不合法' }, 400);
      const found = await c.env.DB.prepare(
        `SELECT r.id FROM ${reviews} r JOIN ${kind} t ON t.id=r.${foreignKey}
        ${reply ? `JOIN ${replies} p ON p.review_id=r.id AND p.id=? AND p.status='published'` : ''}
        WHERE r.id=? AND t.id=? AND r.status='published' AND r.withdrawn_at IS NULL ${kind === 'courses' ? 'AND t.is_listed=1' : ''}`,
      )
        .bind(...(reply ? [replyId!] : []), reviewId, Number(id))
        .first();
      if (!found) return c.json({ error: '内容不存在' }, 404);
      return report(
        c,
        kind === 'courses'
          ? reply
            ? 'course_reply'
            : 'course_review'
          : reply
            ? 'teacher_reply'
            : 'teacher_review',
        reply ? replyId! : reviewId,
      );
    });
  }
}
export default community;
