import { Hono } from 'hono';
import { objectInput } from './community-input.ts';
import { isResourceId, isUuid } from './validation.ts';
import { readBody } from './request-body.ts';
import { checkWriteRequest, type AppEnv } from './visitor.ts';
import { managementNetworkKey } from './admin-auth.ts';

export function trafficDay(now = Date.now(), offset = 0) {
  return new Date(now + 8 * 3600000 - offset * 86400000).toISOString().slice(0, 10);
}
const traffic = new Hono<AppEnv>();
traffic.post('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  const rejected = checkWriteRequest(c);
  if (rejected) return rejected;
  if (!c.env.TRAFFIC_LIMITER || !c.env.VISITOR_SECRET) return c.body(null, 503);
  const network = await managementNetworkKey(c);
  if (!network) return c.body(null, 503);
  if (!(await c.env.TRAFFIC_LIMITER.limit({ key: `traffic:${network}` })).success)
    return c.body(null, 429);
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value);
  if (
    !data ||
    Object.keys(data).some((key) => !['id', 'page', 'targetId'].includes(key)) ||
    !isUuid(data.id) ||
    typeof data.page !== 'string' ||
    !['catalog', 'course', 'teacher_catalog', 'teacher', 'guide'].includes(data.page) ||
    !Number.isSafeInteger(data.targetId) ||
    Object.keys(c.req.queries()).length
  )
    return c.body(null, 400);
  if (data.page === 'course' || data.page === 'teacher') {
    if (!isResourceId(String(data.targetId))) return c.body(null, 400);
    const table = data.page === 'course' ? 'courses' : 'teachers';
    const target = await c.env.DB.prepare(
      `SELECT id FROM ${table} WHERE id=?${table === 'courses' ? ' AND is_listed=1' : ''}`,
    )
      .bind(data.targetId)
      .first();
    if (!target) return c.body(null, 404);
  } else if (data.targetId !== 0) return c.body(null, 400);
  const day = trafficDay(),
    token = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO traffic_receipts(id,day,token) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',
    ).bind(data.id, day, token),
    c.env.DB.prepare(
      `INSERT INTO traffic_daily(day,page,target_id,views)
      SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM traffic_receipts WHERE id=? AND token=?)
      ON CONFLICT(day,page,target_id) DO UPDATE SET views=views+1`,
    ).bind(day, data.page, data.targetId, data.id, token),
  ]);
  return c.body(null, 204);
});
export async function pruneTraffic(db: D1Database, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM traffic_receipts WHERE day<?').bind(trafficDay(now, 1)),
    db.prepare('DELETE FROM traffic_daily WHERE day<?').bind(trafficDay(now, 179)),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(Math.floor(now / 1000)),
  ]);
}
export default traffic;
