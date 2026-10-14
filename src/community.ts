import { Hono } from 'hono';
import { readVisitor, type AppEnv } from './visitor.ts';
import { isResourceId, isUuid } from './validation.ts';
import { reviewTargets } from './review-targets.ts';
import supplements from './course-supplements.ts';
import { report } from './content-reports.ts';

const community = new Hono<AppEnv>();
community.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.set('visitorId', await readVisitor(c));
  await next();
});

community.route('/courses/:id/supplements', supplements);

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
