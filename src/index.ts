import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

type Course = { id: number; code: string | null; name: string; department: string };
type Offering = {
  id: number;
  teacher_id: number;
  teacher_name: string;
  teacher_department: string;
  term_id: number;
  start_year: number;
  semester: number;
};

// 只接受十进制整数字符串，避免 parseInt 静默接受小数或多余字符。
function pagination(query: Record<string, string[]>) {
  if (Object.keys(query).some((key) => !['limit', 'offset'].includes(key))) return null;
  const values = { limit: 20, offset: 0 };
  for (const key of ['limit', 'offset'] as const) {
    const input = query[key];
    if (!input) continue;
    if (input.length !== 1 || !/^(0|[1-9]\d*)$/.test(input[0])) return null;
    values[key] = Number(input[0]);
  }
  if (!Number.isSafeInteger(values.limit) || values.limit < 1 || values.limit > 100) return null;
  if (!Number.isSafeInteger(values.offset) || values.offset < 0 || values.offset > 100000) return null;
  return values;
}

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.get('/api/courses', async (c) => {
  const page = pagination(c.req.queries());
  if (!page) return c.json({ error: '仅支持 limit（1–100）和 offset（0–100000）整数参数，且不可重复' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT id, code, name, department FROM courses ORDER BY id ASC LIMIT ? OFFSET ?',
  ).bind(page.limit + 1, page.offset).all<Course>();
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ courses: results.slice(0, page.limit), ...page, hasMore: results.length > page.limit });
});

app.get('/api/courses/:id/offerings', async (c) => {
  const rawId = c.req.param('id');
  const id = Number(rawId);
  // 负数 ID 用于现有本地演示数据。
  if (!/^-?[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id)) {
    return c.json({ error: '课程 ID 必须是非零安全整数' }, 400);
  }
  const page = pagination(c.req.queries());
  if (!page) return c.json({ error: '仅支持 limit（1–100）和 offset（0–100000）整数参数，且不可重复' }, 400);
  const course = await c.env.DB.prepare(
    'SELECT id, code, name, department FROM courses WHERE id = ?',
  ).bind(id).first<Course>();
  if (!course) return c.json({ error: '课程不存在' }, 404);
  const { results } = await c.env.DB.prepare(`
    SELECT o.id, t.id AS teacher_id, t.name AS teacher_name,
      t.department AS teacher_department, s.id AS term_id, s.start_year, s.semester
    FROM course_offerings o
    JOIN teachers t ON t.id = o.teacher_id
    JOIN terms s ON s.id = o.term_id
    WHERE o.course_id = ?
    ORDER BY s.start_year DESC, s.semester DESC, o.id ASC
    LIMIT ? OFFSET ?
  `).bind(id, page.limit + 1, page.offset).all<Offering>();
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ course, offerings: results.slice(0, page.limit), ...page, hasMore: results.length > page.limit });
});

app.onError((error, c) => {
  console.error('Request failed', error);
  return c.json({ error: '服务暂时不可用，请稍后重试' }, 500);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
