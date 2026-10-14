import { Hono } from 'hono';
import type { Course, CourseCatalog, CourseSort, CourseSummary } from '../shared/catalog.ts';
import { isElectiveTypeFilter } from '../shared/electives.ts';
import { readElectiveDetails } from './elective-guidance.ts';
import { isResourceId } from './validation.ts';
import { readCourseMaterials } from './course-materials.ts';

const catalog = new Hono<{ Bindings: Env }>();
const ordering: Record<CourseSort, string> = {
  default: 'id ASC',
  rating: 'average IS NULL ASC, average DESC, reviewCount DESC, id ASC',
  reviews: 'reviewCount DESC, average DESC, id ASC',
  name: 'name COLLATE NOCASE ASC, id ASC',
};

function parseQuery(query: Record<string, string[]>) {
  const allowed = [
    'limit',
    'offset',
    'q',
    'category',
    'electiveType',
    'department',
    'sort',
    'program',
    'planYear',
  ];
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
  const electiveType = query.electiveType?.[0] ?? '';
  const sort = query.sort?.[0] ?? 'default';
  const program = query.program?.[0].trim() ?? '';
  const planYear = query.planYear?.[0] ?? '';
  if (
    q.length > 100 ||
    q.includes('\0') ||
    department.length > 100 ||
    department.includes('\0') ||
    (query.department && !department) ||
    (query.category && !['major', 'elective'].includes(category)) ||
    !isElectiveTypeFilter(electiveType) ||
    (query.electiveType && !electiveType) ||
    (electiveType && category === 'major') ||
    !Object.hasOwn(ordering, sort) ||
    program.length > 100 ||
    program.includes('\0') ||
    (query.program && !program) ||
    (program && (category === 'elective' || electiveType)) ||
    (query.planYear && (!program || !/^20\d{2}$/.test(planYear)))
  )
    return null;
  return {
    limit: Number(limit),
    offset: Number(offset),
    q,
    department,
    category: program ? 'major' : electiveType ? 'elective' : category,
    electiveType,
    program,
    planYear,
    sort: sort as CourseSort,
  };
}

catalog.get('/', async (c) => {
  const page = parseQuery(c.req.queries());
  if (!page) return c.json({ error: '查询参数不合法' }, 400);
  const { limit, offset, q, category, electiveType, department, sort, program, planYear } = page;
  // SQL fragments only come from fixed sort options.
  const where = `c.is_listed = 1 AND (instr(lower(c.name), lower(?)) > 0 OR instr(lower(coalesce(c.code, '')), lower(?)) > 0)
    AND (? = '' OR c.category = ?) AND (? = '' OR c.department = ?)
    AND (? = '' OR (? = 'unknown' AND e.elective_type IS NULL) OR e.elective_type = ?)
    AND (? = '' OR EXISTS (SELECT 1 FROM course_materials p WHERE p.course_id=c.id AND p.kind='curriculum'
      AND p.program=? AND (? = '' OR p.source_year=CAST(? AS INTEGER))))`;
  const bindings = [
    q,
    q,
    category,
    category,
    department,
    department,
    electiveType,
    electiveType,
    electiveType,
    program,
    program,
    planYear,
    planYear,
  ];
  const electiveJoin =
    "LEFT JOIN elective_course_facts e ON e.course_id = c.id AND c.category = 'elective'";
  const ranked = sort === 'rating' || sort === 'reviews';
  const ratingsJoin = `LEFT JOIN (
    SELECT course_id, avg(rating) AS average, count(*) AS reviewCount
    FROM course_reviews WHERE status = 'published' AND withdrawn_at IS NULL GROUP BY course_id
  ) r ON r.course_id = c.id`;
  // Rating sorts need all candidates. Other sorts read ratings and source years only for this page.
  const [entries, count, departments, statistics, programRows] = await c.env.DB.batch([
    c.env.DB.prepare(
      `WITH page AS (
        SELECT c.id, c.code, c.name, c.department, c.category, e.elective_type AS electiveType
        ${ranked ? ', r.average, coalesce(r.reviewCount, 0) AS reviewCount' : ''}
        FROM courses c ${electiveJoin} ${ranked ? ratingsJoin : ''} WHERE ${where}
        ORDER BY ${ordering[sort]} LIMIT ? OFFSET ?
      )
      SELECT page.*,
        (SELECT max(source_year) FROM course_materials m WHERE m.course_id=page.id
          AND m.kind='syllabus' AND m.department=page.department) AS departmentSourceYear
        ${
          ranked
            ? ''
            : `,
          (SELECT avg(rating) FROM course_reviews r WHERE r.course_id=page.id AND r.status='published' AND r.withdrawn_at IS NULL) AS average,
          (SELECT count(*) FROM course_reviews r WHERE r.course_id=page.id AND r.status='published' AND r.withdrawn_at IS NULL) AS reviewCount`
        }
      FROM page ORDER BY ${ordering[sort]}`,
    ).bind(...bindings, limit + 1, offset),
    c.env.DB.prepare(`SELECT count(*) AS total FROM courses c ${electiveJoin} WHERE ${where}`).bind(
      ...bindings,
    ),
    c.env.DB.prepare(
      'SELECT department AS name, count(*) AS count FROM courses WHERE is_listed = 1 GROUP BY department ORDER BY department',
    ),
    c.env.DB.prepare(`SELECT
      (SELECT count(*) FROM courses WHERE is_listed=1) AS courseCount,
      count(*) AS reviewCount, count(DISTINCT r.course_id) AS reviewedCourseCount
      FROM course_reviews r JOIN courses c ON c.id=r.course_id
      WHERE c.is_listed=1 AND r.status='published' AND r.withdrawn_at IS NULL`),
    c.env.DB
      .prepare(`SELECT DISTINCT m.program AS name, m.source_year AS year FROM course_materials m
      JOIN courses c ON c.id=m.course_id WHERE c.is_listed=1 AND c.category='major' AND m.kind='curriculum' AND m.program IS NOT NULL ORDER BY m.program, m.source_year DESC`),
  ]);
  const courses = (entries.results as CourseSummary[]).slice(0, limit);
  if (program && courses.length) {
    type PlanRecord = NonNullable<CourseSummary['planRecords']>[number];
    const planRows = await c.env.DB.prepare(
      `SELECT DISTINCT course_id AS courseId, program, source_year AS sourceYear, credits, requirement
      FROM course_materials WHERE course_id IN (SELECT value FROM json_each(?))
        AND kind='curriculum' AND program=? AND (? = '' OR source_year=CAST(? AS INTEGER))
      ORDER BY source_year DESC, credits, requirement`,
    )
      .bind(JSON.stringify(courses.map((course) => course.id)), program, planYear, planYear)
      .all<PlanRecord & { courseId: number }>();
    const records = new Map<number, PlanRecord[]>();
    for (const { courseId, ...record } of planRows.results) {
      const list = records.get(courseId) ?? [];
      list.push(record);
      records.set(courseId, list);
    }
    for (const course of courses) course.planRecords = records.get(course.id) ?? [];
  }
  const programs = new Map<string, number[]>();
  for (const row of programRows.results as { name: string; year: number }[]) {
    programs.set(row.name, [...(programs.get(row.name) ?? []), row.year]);
  }
  const response: CourseCatalog = {
    courses,
    limit,
    offset,
    q,
    category,
    electiveType,
    department,
    program,
    planYear,
    sort,
    total: (count.results[0] as { total: number }).total,
    hasMore: entries.results.length > limit,
    facets: {
      departments: departments.results as CourseCatalog['facets']['departments'],
      programs: [...programs].map(([name, years]) => ({ name, years })),
    },
    stats: statistics.results[0] as CourseCatalog['stats'],
  };
  c.header('Cache-Control', 'private, max-age=60');
  return c.json(response);
});

catalog.get('/:id', async (c) => {
  if (!isResourceId(c.req.param('id')) || Object.keys(c.req.queries()).length)
    return c.json({ error: '查询参数不合法' }, 400);
  const course = await c.env.DB.prepare(
    `SELECT c.id, c.code, c.name, c.department, c.category, e.elective_type AS electiveType,
      (SELECT max(source_year) FROM course_materials WHERE course_id = c.id AND kind = 'syllabus' AND department = c.department) AS departmentSourceYear
      FROM courses c LEFT JOIN elective_course_facts e ON e.course_id = c.id AND c.category = 'elective'
      WHERE c.id = ? AND c.is_listed = 1`,
  )
    .bind(Number(c.req.param('id')))
    .first<Course>();
  if (!course) return c.json({ error: '课程不存在' }, 404);
  const [elective, materials] = await Promise.all([
    course.category === 'elective'
      ? readElectiveDetails(c.env.DB, course.id)
      : Promise.resolve(null),
    readCourseMaterials(c.env.DB, course.id),
  ]);
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ course: { ...course, elective, materials } });
});

export default catalog;
