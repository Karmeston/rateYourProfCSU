import { Hono } from 'hono';
import {
  supplementKinds,
  type OwnSupplement,
  type SupplementContent,
} from '../shared/community.ts';
import { checkWriteRequest, limitWrite, type AppEnv } from './visitor.ts';
import { readBody } from './request-body.ts';
import { contextInput, objectInput, sourceUrl, textInput } from './community-input.ts';
import { isResourceId, isUuid } from './validation.ts';
import { report } from './content-reports.ts';

const supplements = new Hono<AppEnv>();
const columns =
  'id,kind,body,source_url AS sourceUrl,term,teacher_name AS teacherName,created_at,updated_at';
const ownColumns = `${columns},status,revision,withdrawn_at`;
const contentKeys = ['kind', 'body', 'sourceUrl', 'term', 'teacherName'];

function contentInput(data: Record<string, unknown>): SupplementContent | null {
  const context = contextInput(data),
    url = sourceUrl(data.sourceUrl);
  return context &&
    url !== false &&
    typeof data.kind === 'string' &&
    Object.hasOwn(supplementKinds, data.kind) &&
    textInput(data.body, 2000)
    ? {
        ...context,
        kind: data.kind as SupplementContent['kind'],
        body: (data.body as string).trim(),
        sourceUrl: url,
      }
    : null;
}
function sameContent(stored: SupplementContent, content: SupplementContent) {
  return (
    stored.kind === content.kind &&
    stored.body === content.body &&
    stored.sourceUrl === content.sourceUrl &&
    stored.term === content.term &&
    stored.teacherName === content.teacherName
  );
}

supplements.use('*', async (c, next) => {
  if (!isResourceId(c.req.param('id') ?? '')) return c.json({ error: '参数不合法' }, 400);
  const found = await c.env.DB.prepare('SELECT id FROM courses WHERE id=? AND is_listed=1')
    .bind(Number(c.req.param('id')))
    .first();
  if (!found) return c.json({ error: '课程不存在' }, 404);
  await next();
});

supplements.get('/', async (c) => {
  const query = c.req.queries(),
    offset = query.offset?.[0] ?? '0',
    mineOffset = query.mineOffset?.[0] ?? '0';
  if (
    Object.entries(query).some(
      ([key, values]) => !['offset', 'mineOffset'].includes(key) || values.length !== 1,
    ) ||
    ![offset, mineOffset].every((value) => /^(0|[1-9]\d*)$/.test(value) && Number(value) <= 100000)
  )
    return c.json({ error: '参数不合法' }, 400);
  const visitor = c.get('visitorId');
  const queries = [
    c.env.DB.prepare(
      `SELECT ${columns} FROM course_supplements WHERE course_id=? AND status='published' AND withdrawn_at IS NULL
    ORDER BY created_at DESC,id LIMIT 21 OFFSET ?`,
    ).bind(Number(c.req.param('id')), Number(offset)),
  ];
  if (visitor)
    queries.push(
      c.env.DB.prepare(
        `SELECT ${ownColumns} FROM course_supplements WHERE course_id=? AND visitor_id=?
    ORDER BY created_at DESC,id LIMIT 21 OFFSET ?`,
      ).bind(Number(c.req.param('id')), visitor, Number(mineOffset)),
    );
  const [entries, mine] = await c.env.DB.batch(queries);
  return c.json({
    supplements: entries.results.slice(0, 20),
    mine: mine?.results.slice(0, 20) ?? [],
    offset: Number(offset),
    mineOffset: Number(mineOffset),
    hasMore: entries.results.length > 20,
    hasMoreMine: (mine?.results.length ?? 0) > 20,
  });
});

supplements.post('/', async (c) => {
  const rejected = checkWriteRequest(c);
  if (rejected) return rejected;
  if (Object.keys(c.req.queries()).length) return c.json({ error: '参数不合法' }, 400);
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value),
    content = data && contentInput(data);
  if (
    !data ||
    !content ||
    !isUuid(data.id) ||
    Object.keys(data).some((key) => !['id', ...contentKeys].includes(key))
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
      content.kind,
      content.body,
      content.sourceUrl,
      content.term,
      content.teacherName,
    )
    .run();
  const stored = await c.env.DB.prepare(
    `SELECT ${ownColumns} FROM course_supplements WHERE id=? AND course_id=? AND visitor_id=?`,
  )
    .bind(data.id, Number(c.req.param('id')), c.get('visitorId')!)
    .first<OwnSupplement>();
  if (!stored || !sameContent(stored, content))
    return c.json({ error: '提交编号冲突，请重新打开补充表单。' }, 409);
  return c.json({ received: true, status: stored.status, withdrawn_at: stored.withdrawn_at }, 202);
});

for (const method of ['PUT', 'DELETE'] as const) {
  supplements.on(method, '/:supplementId', async (c) => {
    const rejected = checkWriteRequest(c);
    if (rejected) return rejected;
    if (!isUuid(c.req.param('supplementId')) || Object.keys(c.req.queries()).length)
      return c.json({ error: '参数不合法' }, 400);
    const input = await readBody(c.req.raw);
    if ('error' in input) return c.json({ error: input.error }, input.status);
    const data = objectInput(input.value),
      content = data && contentInput(data);
    if (
      !data ||
      !Number.isSafeInteger(data.revision) ||
      (data.revision as number) < 0 ||
      Object.keys(data).some(
        (key) => !(method === 'DELETE' ? ['revision'] : ['revision', ...contentKeys]).includes(key),
      ) ||
      (method === 'PUT' && !content)
    )
      return c.json({ error: '补充内容或版本不正确' }, 400);
    const limited = await limitWrite(c, 'publish');
    if (limited) return limited;
    const current = await c.env.DB.prepare(
      `SELECT ${ownColumns} FROM course_supplements WHERE id=? AND course_id=? AND visitor_id=?`,
    )
      .bind(c.req.param('supplementId'), Number(c.req.param('id')), c.get('visitorId')!)
      .first<OwnSupplement>();
    if (!current) return c.json({ error: '无法操作此补充资料' }, 404);
    if (current.revision !== data.revision) {
      // Confirm only the immediately following, identical result; moderation changes remain conflicts.
      if (
        current.revision === Number(data.revision) + 1 &&
        (method === 'DELETE'
          ? current.withdrawn_at
          : content &&
            sameContent(current, content) &&
            current.status === 'pending' &&
            !current.withdrawn_at)
      )
        return c.json({ received: true, revision: current.revision, status: current.status });
      return c.json({ error: '资料已发生变化，请刷新后再操作。' }, 409);
    }
    const result =
      method === 'DELETE'
        ? await c.env.DB.prepare(
            `UPDATE course_supplements SET
          withdrawn_at=coalesce(withdrawn_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),revision=revision+1,moderation_id=NULL
          WHERE id=? AND course_id=? AND visitor_id=? AND revision=?`,
          )
            .bind(current.id, Number(c.req.param('id')), c.get('visitorId')!, data.revision)
            .run()
        : await c.env.DB.prepare(
            `UPDATE course_supplements SET kind=?,body=?,source_url=?,term=?,teacher_name=?,
          status='pending',withdrawn_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1,moderation_id=NULL
          WHERE id=? AND course_id=? AND visitor_id=? AND revision=?`,
          )
            .bind(
              content!.kind,
              content!.body,
              content!.sourceUrl,
              content!.term,
              content!.teacherName,
              current.id,
              Number(c.req.param('id')),
              c.get('visitorId')!,
              data.revision,
            )
            .run();
    if (!result.meta.changes) return c.json({ error: '资料已发生变化，请刷新后再操作。' }, 409);
    return c.json({
      received: true,
      revision: current.revision + 1,
      status: method === 'PUT' ? 'pending' : current.status,
    });
  });
}

supplements.post('/:supplementId/reports', async (c) => {
  if (!isUuid(c.req.param('supplementId')) || Object.keys(c.req.queries()).length)
    return c.json({ error: '参数不合法' }, 400);
  const parent = await c.env.DB.prepare(
    "SELECT id FROM course_supplements WHERE id=? AND course_id=? AND status='published' AND withdrawn_at IS NULL",
  )
    .bind(c.req.param('supplementId'), Number(c.req.param('id')))
    .first();
  if (!parent) return c.json({ error: '补充资料不存在' }, 404);
  return report(c, 'supplement', c.req.param('supplementId'));
});
export default supplements;
