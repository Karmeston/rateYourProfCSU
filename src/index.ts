import { Hono } from 'hono';
import reviews from './reviews.ts';

const app = new Hono<{ Bindings: Env }>();
type Course = { id: number; code: string | null; name: string; department: string; category: 'major' | 'elective' | null };
type Teacher = { id: number; name: string; department: string; profile_url: string | null };

// 两个入口共用分页验证，SQL 和返回字段分别定义。
function browseQuery(query: Record<string, string[]>, course = false) {
  if (Object.keys(query).some((key) => !['limit', 'offset', 'q', ...(course ? ['category'] : [])].includes(key))) return null;
  const values = { limit: 20, offset: 0, q: '', category: '' };
  if (query.category) {
    if (query.category.length !== 1 || !['major', 'elective'].includes(query.category[0])) return null;
    values.category = query.category[0];
  }
  for (const key of ['limit', 'offset'] as const) {
    const input = query[key];
    if (!input) continue;
    if (input.length !== 1 || !/^(0|[1-9]\d*)$/.test(input[0])) return null;
    values[key] = Number(input[0]);
  }
  if (!Number.isSafeInteger(values.limit) || values.limit < 1 || values.limit > 100) return null;
  if (!Number.isSafeInteger(values.offset) || values.offset < 0 || values.offset > 100000) return null;
  if (query.q) {
    if (query.q.length !== 1 || query.q[0].length > 100) return null;
    values.q = query.q[0].trim();
  }
  return values;
}

function validId(raw: string) {
  return /^-?[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw));
}

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.get('/api/courses', async (c) => {
  const page = browseQuery(c.req.queries(), true);
  if (!page) return c.json({ error: '查询参数不合法' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT id, code, name, department, category FROM courses WHERE is_listed = 1 AND instr(name, ?) > 0 AND (? = ? OR category = ?) ORDER BY id ASC LIMIT ? OFFSET ?',
  ).bind(page.q, page.category, '', page.category, page.limit + 1, page.offset).all<Course>();
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ courses: results.slice(0, page.limit), ...page, hasMore: results.length > page.limit });
});

app.get('/api/teachers', async (c) => {
  const page = browseQuery(c.req.queries());
  if (!page) return c.json({ error: '查询参数不合法' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, department, profile_url FROM teachers WHERE instr(name, ?) > 0 ORDER BY id ASC LIMIT ? OFFSET ?',
  ).bind(page.q, page.limit + 1, page.offset).all<Teacher>();
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ teachers: results.slice(0, page.limit), ...page, hasMore: results.length > page.limit });
});

app.get('/api/courses/:id', async (c) => {
  if (!validId(c.req.param('id')) || Object.keys(c.req.queries()).length) return c.json({ error: '查询参数不合法' }, 400);
  const course = await c.env.DB.prepare(
    'SELECT id, code, name, department, category FROM courses WHERE id = ? AND is_listed = 1',
  ).bind(Number(c.req.param('id'))).first<Course>();
  if (!course) return c.json({ error: '课程不存在' }, 404);
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ course });
});

app.get('/api/teachers/:id', async (c) => {
  if (!validId(c.req.param('id')) || Object.keys(c.req.queries()).length) return c.json({ error: '查询参数不合法' }, 400);
  const teacher = await c.env.DB.prepare(
    'SELECT id, name, department, profile_url FROM teachers WHERE id = ?',
  ).bind(Number(c.req.param('id'))).first<Teacher>();
  if (!teacher) return c.json({ error: '教师不存在' }, 404);
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ teacher });
});

app.route('/api', reviews);

app.onError((error, c) => {
  console.error('Request failed', error);
  return c.json({ error: '服务暂时不可用，请稍后重试' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));
export default app;
