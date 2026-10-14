import { moderationKinds, type AdminItem, type ModerationKind } from '../shared/admin.ts';
import { moderationTargets } from './moderation.ts';

export function isModerationKind(value: unknown): value is ModerationKind {
  return typeof value === 'string' && Object.hasOwn(moderationKinds, value);
}
export const statusesFor = (kind: ModerationKind) =>
  kind === 'report' ? ['open', 'resolved', 'dismissed'] : ['pending', 'published', 'rejected'];

function selectContent(kind: ModerationKind) {
  const table = moderationTargets[kind].table;
  if (kind === 'report')
    return `SELECT r.id,r.status,r.revision,r.details AS body,r.created_at,
    r.target_kind,r.target_id,r.reason,NULL AS name,NULL AS resourceId,NULL AS resourceKind,NULL AS withdrawn_at
    FROM content_reports r`;
  const teacher = kind.startsWith('teacher'),
    resource = teacher ? 'teachers' : 'courses';
  const foreign = teacher ? 'teacher_id' : 'course_id';
  if (kind.endsWith('reply')) {
    const reviews = teacher ? 'teacher_reviews' : 'course_reviews';
    return `SELECT r.id,r.status,r.revision,r.body,r.created_at,c.name,c.id AS resourceId,
      '${resource}' AS resourceKind,p.withdrawn_at FROM ${table} r
      JOIN ${reviews} p ON p.id=r.review_id JOIN ${resource} c ON c.id=p.${foreign}`;
  }
  return `SELECT r.id,r.status,r.revision,r.body,r.created_at,c.name,c.id AS resourceId,
    '${resource}' AS resourceKind,r.withdrawn_at,r.term,r.teacher_name AS teacherName,
    ${kind === 'supplement' ? 'r.kind AS supplementKind,r.source_url AS sourceUrl' : 'r.rating'}
    FROM ${table} r JOIN ${resource} c ON c.id=r.${foreign}`;
}
function decorate(kind: ModerationKind, row: Record<string, unknown>): AdminItem {
  const actions = Object.keys(moderationTargets[kind].actions).filter(
    (action) => !row.withdrawn_at || !['approve', 'restore'].includes(action),
  );
  return { ...row, kind, actions } as AdminItem;
}
export async function contentPage(
  db: D1Database,
  kind: ModerationKind,
  status: string,
  q: string,
  offset: number,
) {
  const where = `(?='all' OR r.status=?) AND (instr(lower(r.body),lower(?))>0 OR instr(lower(coalesce(c.name,'')),lower(?))>0)`;
  const reportWhere = `(?='all' OR r.status=?) AND instr(lower(r.details),lower(?))>0`;
  const bindings = kind === 'report' ? [status, status, q] : [status, status, q, q];
  const active =
    status === 'pending' && kind !== 'report'
      ? ` AND ${kind.endsWith('reply') ? 'p' : 'r'}.withdrawn_at IS NULL${kind.startsWith('teacher') ? '' : ' AND c.is_listed=1'}`
      : '';
  const query = `${selectContent(kind)} WHERE ${kind === 'report' ? reportWhere : where}${active}`;
  const [rows, count] = await db.batch([
    db.prepare(`${query} ORDER BY r.created_at,r.id LIMIT 21 OFFSET ?`).bind(...bindings, offset),
    db.prepare(`SELECT count(*) AS total FROM (${query})`).bind(...bindings),
  ]);
  return {
    items: (rows.results as Record<string, unknown>[])
      .slice(0, 20)
      .map((row) => decorate(kind, row)),
    total: (count.results[0] as { total: number }).total,
    offset,
    hasMore: rows.results.length > 20,
  };
}
export async function contentItem(db: D1Database, kind: ModerationKind, id: string) {
  const row = await db
    .prepare(`${selectContent(kind)} WHERE r.id=?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? decorate(kind, row) : null;
}
