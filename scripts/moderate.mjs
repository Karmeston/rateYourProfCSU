import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLocalD1 } from './lib/local-d1.mjs';

const targets = {
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

export async function moderate(db, { kind, id, action, revision, reason }) {
  const target = Object.hasOwn(targets, kind) ? targets[kind] : null;
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
    reason.includes('\0')
  )
    throw new Error('类型、操作、编号、版本或处理理由不合法');
  const token = randomUUID();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE ${target.table} SET status=?,revision=revision+1,moderation_id=? WHERE id=? AND revision=?`,
      )
      .bind(target.actions[action], token, id, revision),
    db
      .prepare(
        `INSERT INTO moderation_actions(id,target_kind,target_id,action,reason)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${target.table} WHERE id=? AND moderation_id=?)`,
      )
      .bind(token, kind, id, action, reason.trim(), id, token),
  ]);
  if (!result[0].meta.changes) throw new Error('记录不存在或版本已变化，请重新inspect后处理');
  return { id, kind, status: target.actions[action], revision: revision + 1 };
}

export async function inspect(db, kind, id) {
  const target = Object.hasOwn(targets, kind) ? targets[kind] : null;
  if (!target || typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id))
    throw new Error('类型或编号不合法');
  const row = await db.prepare(`SELECT * FROM ${target.table} WHERE id=?`).bind(id).first();
  if (!row) throw new Error('记录不存在');
  const { visitor_id: _visitor, moderation_id: _moderation, ...content } = row;
  return content;
}

export async function queue(db) {
  const [reports, supplements, courses, teachers] = await db.batch([
    db.prepare(
      "SELECT id,target_kind,target_id,reason,details,revision,created_at FROM content_reports WHERE status='open' ORDER BY created_at LIMIT 50",
    ),
    db.prepare(
      "SELECT s.id,s.course_id,c.name,s.kind,s.body,s.source_url,s.term,s.teacher_name,s.revision,s.created_at FROM course_supplements s JOIN courses c ON c.id=s.course_id WHERE s.status='pending' ORDER BY s.created_at LIMIT 50",
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    [command, kind, id, revision, reason] = args.slice(2);
  const operation =
    command === 'queue' && args.length === 3
      ? queue
      : command === 'inspect' && args.length === 5
        ? (db) => inspect(db, kind, id)
        : args.length === 7
          ? (db) => moderate(db, { kind, id, action: command, revision: Number(revision), reason })
          : null;
  if (!operation)
    throw new Error(
      '用法：--persist-to <本地目录> queue | inspect <类型> <UUID> | <操作> <类型> <UUID> <版本> <理由>',
    );
  console.log(JSON.stringify(await withLocalD1(args.slice(0, 2), operation), null, 2));
}
