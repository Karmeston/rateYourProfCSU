import { Hono } from 'hono';
import courseCatalog from './course-catalog.ts';
import teacherCatalog from './teacher-catalog.ts';
import reviews from './reviews.ts';
import visitor, { type AppEnv } from './visitor.ts';
import community from './community.ts';
import admin from './admin.ts';
import traffic, { pruneTraffic } from './traffic.ts';
import { protectPublicData } from './quota-guard.ts';
import { monitorService } from './service-monitor.ts';
import { redirectCourseAlias } from './course-aliases.ts';
export { QuotaGuard } from './quota-guard.ts';

const app = new Hono<AppEnv>();
app.use('/api/*', monitorService);

app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.use('/api/courses/*', protectPublicData);
app.use('/api/teachers/*', protectPublicData);
app.use('/api/courses/*', redirectCourseAlias);
app.route('/api/admin', admin);
app.route('/api/traffic', traffic);
app.route('/api/courses', courseCatalog);
app.route('/api/teachers', teacherCatalog);
app.route('/api', visitor);
app.route('/api', reviews);
app.route('/api', community);

app.onError((error, c) => {
  if (/D1.*daily row (?:read|write) limit/is.test(error.message)) {
    c.set('serviceEvent', 'd1_limit');
    const now = new Date();
    const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    c.header('Cache-Control', 'no-store');
    c.header('Retry-After', String(Math.ceil((reset - now.getTime()) / 1000)));
    return c.json({
      code: 'D1_DAILY_LIMIT',
      error: '今日数据库使用额度已用完，请在北京时间早上 8 点额度重置后重试。',
    }, 503);
  }
  console.error('Request failed', error);
  return c.json({ error: '服务暂时不可用，请稍后重试' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));
export default Object.assign(app, {
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pruneTraffic(env.DB));
  },
});
