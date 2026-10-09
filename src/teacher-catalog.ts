import { Hono } from 'hono';
import type { Teacher, TeacherCatalog } from '../shared/catalog.ts';
import type { AppEnv } from './visitor.ts';
import { isResourceId } from './validation.ts';

const teachers = new Hono<AppEnv>();

// Preserve the teacher endpoint query and response shape, including the empty category field.
function parseQuery(query: Record<string, string[]>) {
  if (Object.keys(query).some((key) => !['limit', 'offset', 'q'].includes(key)))
    return null;
  const values = { limit: 20, offset: 0, q: '', category: '' };
  for (const key of ['limit', 'offset'] as const) {
    const input = query[key];
    if (!input) continue;
    if (input.length !== 1 || !/^(0|[1-9]\d*)$/.test(input[0])) return null;
    values[key] = Number(input[0]);
  }
  if (!Number.isSafeInteger(values.limit) || values.limit < 1 || values.limit > 100) return null;
  if (!Number.isSafeInteger(values.offset) || values.offset < 0 || values.offset > 100000)
    return null;
  if (query.q) {
    if (query.q.length !== 1 || query.q[0].length > 100) return null;
    values.q = query.q[0].trim();
  }
  return values;
}

teachers.get('/', async (c) => {
  const page = parseQuery(c.req.queries());
  if (!page) return c.json({ error: '查询参数不合法' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, department, profile_url FROM teachers WHERE instr(name, ?) > 0 ORDER BY id ASC LIMIT ? OFFSET ?',
  )
    .bind(page.q, page.limit + 1, page.offset)
    .all<Teacher>();
  c.header('Cache-Control', 'private, max-age=60');
  const response: TeacherCatalog = {
    teachers: results.slice(0, page.limit),
    ...page,
    hasMore: results.length > page.limit,
  };
  return c.json(response);
});

teachers.get('/:id', async (c) => {
  if (!isResourceId(c.req.param('id')) || Object.keys(c.req.queries()).length)
    return c.json({ error: '查询参数不合法' }, 400);
  const teacher = await c.env.DB.prepare(
    'SELECT id, name, department, profile_url FROM teachers WHERE id = ?',
  )
    .bind(Number(c.req.param('id')))
    .first<Teacher>();
  if (!teacher) return c.json({ error: '教师不存在' }, 404);
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ teacher });
});

export default teachers;
