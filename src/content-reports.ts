import type { Context } from 'hono';
import { reportReasons } from '../shared/community.ts';
import { checkWriteRequest, limitWrite, type AppEnv } from './visitor.ts';
import { readBody } from './request-body.ts';
import { objectInput } from './community-input.ts';
import { isUuid } from './validation.ts';

export async function report(c: Context<AppEnv>, kind: string, id: string) {
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
