import { Hono } from 'hono';
import type { CourseCatalog, CourseSort, CourseSummary } from '../shared/catalog.ts';

const catalog = new Hono<{ Bindings: Env }>();
const ordering: Record<CourseSort, string> = {
  default: 'id ASC',
  rating: 'average IS NULL ASC, average DESC, reviewCount DESC, id ASC',
  reviews: 'reviewCount DESC, average DESC, id ASC',
  name: 'name COLLATE NOCASE ASC, id ASC',
};

function parseQuery(query: Record<string, string[]>) {
  const allowed = ['limit', 'offset', 'q', 'category', 'department', 'sort', 'ids'];
  if (Object.entries(query).some(([key, values]) => !allowed.includes(key) || values.length !== 1))
    return null;
  const limit = query.limit?.[0] ?? '20';
  const offset = query.offset?.[0] ?? '0';
  if (
    ![limit, offset].every((value) => /^(0|[1-9]\d*)$/.test(value)) ||
    Number(limit) < 1 ||
    Number(limit) > 100 ||
    Number(offset) > 100000
  )
    return null;
  const q = query.q?.[0].trim() ?? '';
  const department = query.department?.[0].trim() ?? '';
  const category = query.category?.[0] ?? '';
  const sort = query.sort?.[0] ?? 'default';
  if (
    q.length > 100 ||
    q.includes('\0') ||
    department.length > 100 ||
    department.includes('\0') ||
    (query.department && !department) ||
    (query.category && !['major', 'elective'].includes(category)) ||
    !Object.hasOwn(ordering, sort)
  )
    return null;
  const ids = query.ids ? query.ids[0].split(',') : [];
  if (
    query.ids &&
    (!ids.length ||
      ids.length > 100 ||
      ids.some((id) => !/^-?[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))))
  )
    return null;
  return {
    limit: Number(limit),
    offset: Number(offset),
    q,
    department,
    category,
    sort: sort as CourseSort,
    ids: [...new Set(ids.map(Number))],
  };
}

catalog.get('/', async (c) => {
  const page = parseQuery(c.req.queries());
  if (!page) return c.json({ error: '查询参数不合法' }, 400);
  const { limit, offset, q, category, department, sort, ids } = page;
  // SQL fragments only come from fixed sort options or generated placeholders.
  const where = `is_listed = 1 AND (instr(lower(name), lower(?)) > 0 OR instr(lower(coalesce(code, '')), lower(?)) > 0)
    AND (? = '' OR category = ?) AND (? = '' OR department = ?)
    ${ids.length ? `AND id IN (${ids.map(() => '?').join(',')})` : ''}`;
  const bindings = [q, q, category, category, department, department, ...ids];
  const [entries, count, departments, statistics] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT c.id, c.code, c.name, c.department, c.category,
      r.average, coalesce(r.reviewCount, 0) AS reviewCount
      FROM courses c LEFT JOIN (
        SELECT course_id, avg(rating) AS average, count(*) AS reviewCount
        FROM course_reviews WHERE status = 'published' GROUP BY course_id
      ) r ON r.course_id = c.id WHERE ${where}
      ORDER BY ${ordering[sort]} LIMIT ? OFFSET ?`,
    ).bind(...bindings, limit + 1, offset),
    c.env.DB.prepare(`SELECT count(*) AS total FROM courses WHERE ${where}`).bind(...bindings),
    c.env.DB.prepare(
      'SELECT department AS name, count(*) AS count FROM courses WHERE is_listed = 1 GROUP BY department ORDER BY department',
    ),
    c.env.DB.prepare(`SELECT count(*) AS courseCount,
      (SELECT count(*) FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE c.is_listed = 1 AND r.status = 'published') AS reviewCount,
      (SELECT count(DISTINCT r.course_id) FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE c.is_listed = 1 AND r.status = 'published') AS reviewedCourseCount
      FROM courses WHERE is_listed = 1`),
  ]);
  const response: CourseCatalog = {
    courses: (entries.results as CourseSummary[]).slice(0, limit),
    limit,
    offset,
    q,
    category,
    department,
    sort,
    total: (count.results[0] as { total: number }).total,
    hasMore: entries.results.length > limit,
    facets: { departments: departments.results as CourseCatalog['facets']['departments'] },
    stats: statistics.results[0] as CourseCatalog['stats'],
  };
  c.header('Cache-Control', 'private, max-age=60');
  return c.json(response);
});

export default catalog;
