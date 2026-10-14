import type { ModerationKind } from '../shared/admin.ts';
import { isUuid } from './validation.ts';

export class ModerationError extends Error {
  code: 'invalid' | 'conflict';
  constructor(code: 'invalid' | 'conflict', message: string) {
    super(message);
    this.code = code;
  }
}

export const moderationTargets: Record<
  ModerationKind,
  { table: string; actions: Record<string, string> }
> = {
  course_review: {
    table: 'course_reviews',
    actions: { hide: 'rejected', restore: 'published', approve: 'published' },
  },
  teacher_review: {
    table: 'teacher_reviews',
    actions: { hide: 'rejected', restore: 'published', approve: 'published' },
  },
  course_reply: {
    table: 'course_review_replies',
    actions: { hide: 'rejected', restore: 'published' },
  },
  teacher_reply: {
    table: 'teacher_review_replies',
    actions: { hide: 'rejected', restore: 'published' },
  },
  supplement: {
    table: 'course_supplements',
    actions: { approve: 'published', reject: 'rejected', hide: 'rejected', restore: 'published' },
  },
  report: { table: 'content_reports', actions: { resolve: 'resolved', dismiss: 'dismissed' } },
};

export async function moderate(
  db: D1Database,
  {
    kind,
    id,
    action,
    revision,
    reason,
    requestId,
    actor = 'cli',
  }: {
    kind: string;
    id: string;
    action: string;
    revision: number;
    reason: string;
    requestId?: string;
    actor?: 'cli' | 'admin';
  },
) {
  const target = Object.hasOwn(moderationTargets, kind)
    ? moderationTargets[kind as keyof typeof moderationTargets]
    : null;
  if (
    !target ||
    !Object.hasOwn(target.actions, action) ||
    typeof id !== 'string' ||
    !/^[\da-f-]{36}$/i.test(id) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof reason !== 'string' ||
    !reason.trim() ||
    reason.length > 500 ||
    reason.includes('\0') ||
    (requestId !== undefined && !isUuid(requestId))
  )
    throw new ModerationError('invalid', '类型、操作、编号、版本或处理理由不合法');
  const token = requestId ?? crypto.randomUUID();
  const activeClause =
    actor === 'admin' &&
    ['approve', 'restore'].includes(action) &&
    ['course_reviews', 'teacher_reviews', 'course_supplements'].includes(target.table)
      ? ' AND withdrawn_at IS NULL'
      : '';
  if (requestId) {
    const previous = await db
      .prepare(
        'SELECT target_kind,target_id,action,reason,actor,target_revision FROM moderation_actions WHERE id=?',
      )
      .bind(requestId)
      .first<{
        target_kind: string;
        target_id: string;
        action: string;
        reason: string;
        actor: string;
        target_revision: number | null;
      }>();
    if (previous) {
      if (
        previous.target_kind !== kind ||
        previous.target_id !== id ||
        previous.action !== action ||
        previous.reason !== reason.trim() ||
        previous.actor !== actor ||
        previous.target_revision !== revision + 1
      )
        throw new ModerationError('conflict', '操作编号冲突，请刷新后重新操作');
      return {
        id,
        kind,
        status: target.actions[action as keyof typeof target.actions],
        revision: revision + 1,
      };
    }
  }
  const result = await db.batch([
    db
      .prepare(
        `UPDATE ${target.table} SET status=?,revision=revision+1,moderation_id=? WHERE id=? AND revision=?
          AND NOT EXISTS(SELECT 1 FROM moderation_actions WHERE id=?)${activeClause}`,
      )
      .bind(target.actions[action as keyof typeof target.actions], token, id, revision, token),
    db
      .prepare(
        `INSERT INTO moderation_actions(id,target_kind,target_id,action,reason,actor,target_revision)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${target.table} WHERE id=? AND moderation_id=?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(token, kind, id, action, reason.trim(), actor, revision + 1, id, token),
  ]);
  if (!result[0].meta.changes)
    throw new ModerationError('conflict', '记录不存在或版本已变化，请重新inspect后处理');
  return {
    id,
    kind,
    status: target.actions[action as keyof typeof target.actions],
    revision: revision + 1,
  };
}

export async function inspect(db: D1Database, kind: string, id: string) {
  const target = Object.hasOwn(moderationTargets, kind)
    ? moderationTargets[kind as keyof typeof moderationTargets]
    : null;
  if (!target || typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id))
    throw new Error('类型或编号不合法');
  const row = await db
    .prepare(`SELECT * FROM ${target.table} WHERE id=?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw new Error('记录不存在');
  const { visitor_id: _visitor, moderation_id: _moderation, ...content } = row;
  return content;
}

export async function queue(db: D1Database) {
  const [reports, supplements, courses, teachers] = await db.batch([
    db.prepare(
      "SELECT id,target_kind,target_id,reason,details,revision,created_at FROM content_reports WHERE status='open' ORDER BY created_at LIMIT 50",
    ),
    db.prepare(
      "SELECT s.id,s.course_id,c.name,s.kind,s.body,s.source_url,s.term,s.teacher_name,s.revision,s.created_at FROM course_supplements s JOIN courses c ON c.id=s.course_id WHERE s.status='pending' AND s.withdrawn_at IS NULL AND c.is_listed=1 ORDER BY s.created_at,s.id LIMIT 50",
    ),
    db.prepare(
      "SELECT r.id,r.course_id,c.name,r.rating,r.body,r.term,r.teacher_name,r.revision FROM course_reviews r JOIN courses c ON c.id=r.course_id WHERE r.status='pending' AND r.withdrawn_at IS NULL ORDER BY r.created_at,r.id LIMIT 50",
    ),
    db.prepare(
      "SELECT r.id,r.teacher_id,t.name,r.rating,r.body,r.term,r.teacher_name,r.revision FROM teacher_reviews r JOIN teachers t ON t.id=r.teacher_id WHERE r.status='pending' AND r.withdrawn_at IS NULL ORDER BY r.created_at,r.id LIMIT 50",
    ),
  ]);
  return {
    reports: reports.results,
    supplements: supplements.results,
    reviews: { courses: courses.results, teachers: teachers.results },
  };
}
