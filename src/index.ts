import { Hono } from 'hono';
import courseCatalog from './course-catalog.ts';
import teacherCatalog from './teacher-catalog.ts';
import reviews from './reviews.ts';
import visitor, { type AppEnv } from './visitor.ts';
import community from './community.ts';

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.route('/api/courses', courseCatalog);
app.route('/api/teachers', teacherCatalog);
app.route('/api', visitor);
app.route('/api', reviews);
app.route('/api', community);

app.onError((error, c) => {
  console.error('Request failed', error);
  return c.json({ error: '服务暂时不可用，请稍后重试' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));
export default app;
