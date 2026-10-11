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
  const materialsJoin = `LEFT JOIN (
    SELECT course_id, department, max(source_year) AS departmentSourceYear
    FROM course_materials WHERE kind = 'syllabus' GROUP BY course_id, department
  ) m ON m.course_id = c.id AND m.department = c.department`;
  const [entries, count, departments, statistics, programRows, planRows] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT c.id, c.code, c.name, c.department, c.category, e.elective_type AS electiveType, m.departmentSourceYear,
      r.average, coalesce(r.reviewCount, 0) AS reviewCount
      FROM courses c ${electiveJoin} ${materialsJoin} LEFT JOIN (
        SELECT course_id, avg(rating) AS average, count(*) AS reviewCount
        FROM course_reviews WHERE status = 'published' AND withdrawn_at IS NULL GROUP BY course_id
      ) r ON r.course_id = c.id WHERE ${where}
      ORDER BY ${ordering[sort]} LIMIT ? OFFSET ?`,
    ).bind(...bindings, limit + 1, offset),
    c.env.DB.prepare(`SELECT count(*) AS total FROM courses c ${electiveJoin} WHERE ${where}`).bind(
      ...bindings,
    ),
    c.env.DB.prepare(
      'SELECT department AS name, count(*) AS count FROM courses WHERE is_listed = 1 GROUP BY department ORDER BY department',
    ),
    c.env.DB.prepare(`SELECT count(*) AS courseCount,
      (SELECT count(*) FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE c.is_listed = 1 AND r.status = 'published' AND r.withdrawn_at IS NULL) AS reviewCount,
      (SELECT count(DISTINCT r.course_id) FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE c.is_listed = 1 AND r.status = 'published' AND r.withdrawn_at IS NULL) AS reviewedCourseCount
      FROM courses WHERE is_listed = 1`),
    c.env.DB
      .prepare(`SELECT DISTINCT m.program AS name, m.source_year AS year FROM course_materials m
      JOIN courses c ON c.id=m.course_id WHERE c.is_listed=1 AND c.category='major' AND m.kind='curriculum' AND m.program IS NOT NULL ORDER BY m.program, m.source_year DESC`),
    c.env.DB.prepare(
      `SELECT DISTINCT m.course_id AS courseId, m.program, m.source_year AS sourceYear, m.credits, m.requirement
      FROM course_materials m JOIN courses c ON c.id=m.course_id ${electiveJoin}
      WHERE ${where} AND m.kind='curriculum' AND m.program=? AND (? = '' OR m.source_year=CAST(? AS INTEGER))`,
    ).bind(...bindings, program, planYear, planYear),
  ]);
  const programs = new Map<string, number[]>();
  for (const row of programRows.results as { name: string; year: number }[]) {
    programs.set(row.name, [...(programs.get(row.name) ?? []), row.year]);
  }
  const response: CourseCatalog = {
    courses: (entries.results as CourseSummary[])
      .slice(0, limit)
      .map((course) => ({
        ...course,
        ...(program
          ? {
              planRecords: (
                planRows.results as (NonNullable<CourseSummary['planRecords']>[number] & {
                  courseId: number;
                })[]
              )
                .filter((row) => row.courseId === course.id)
                .map(({ courseId: _courseId, ...record }) => record),
            }
          : {}),
      })),
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
