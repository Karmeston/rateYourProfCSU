import { Hono } from 'hono';
import type {
  Course,
  CourseCatalog,
  CourseCatalogPage,
  CourseSort,
  CourseSummary,
} from '../shared/catalog.ts';
import { readCatalogFacets } from './catalog-facets.ts';
import { readPublicCache, writePublicCache } from './public-cache.ts';
import { isElectiveTypeFilter } from '../shared/electives.ts';
import { readElectiveDetails } from './elective-guidance.ts';
import { isResourceId } from './validation.ts';
import { readCourseMaterials } from './course-materials.ts';
import { reserveQuota } from './quota-guard.ts';
import type { AppEnv } from './visitor.ts';
import type { CourseRating } from '../shared/course-directory.ts';
import { aliasCodesForQuery } from '../shared/course-aliases.ts';

const catalog = new Hono<AppEnv>();
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
    'view',
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
    (query.category && !['major', 'elective', 'unknown'].includes(category)) ||
    !isElectiveTypeFilter(electiveType) ||
    (query.electiveType && !electiveType) ||
    (electiveType && category && category !== 'elective') ||
    !Object.hasOwn(ordering, sort) ||
    program.length > 100 ||
    program.includes('\0') ||
    (query.program && !program) ||
    (program && ((category && category !== 'major') || electiveType)) ||
    (query.view && query.view[0] !== 'results') ||
    (query.planYear && (!program || !/^(20\d{2}|unknown)$/.test(planYear)))
  )
    return null;
  return {
    limit: Number(limit),
    offset: Number(offset),
    q,
    department,
    // Older program links include category=major. Membership comes from the plan itself.
    category: program ? '' : electiveType ? 'elective' : category,
    electiveType,
    program,
    planYear,
    resultsOnly: query.view?.[0] === 'results',
    sort: sort as CourseSort,
  };
}

catalog.get('/facets', async (c) => {
  if (Object.keys(c.req.queries()).length) return c.json({ error: '查询参数不合法' }, 400);
  const result = await readCatalogFacets(c);
  if (result instanceof Response) return result;
  c.header('Cache-Control', 'private, max-age=300');
  return c.json(result);
});

catalog.get('/ratings', async (c) => {
  if (Object.keys(c.req.queries()).length) return c.json({ error: '查询参数不合法' }, 400);
  const key = new URL('/api/courses/ratings?v=1', c.req.url).href;
  let ratings = await readPublicCache<CourseRating[]>(key);
  if (!ratings) {
    const blocked = await reserveQuota(c, 'content');
    if (blocked) return blocked;
    const { results } = await c.env.DB.prepare(`SELECT r.course_id AS id, avg(r.rating) AS average, count(*) AS count
      FROM course_reviews r JOIN courses c ON c.id=r.course_id
      WHERE c.is_listed=1 AND r.status='published' AND r.withdrawn_at IS NULL
      GROUP BY r.course_id ORDER BY r.course_id`).all<{ id: number; average: number; count: number }>();
    ratings = results.map(({ id, average, count }) => [id, average, count]);
    await writePublicCache(key, ratings, 60);
  }
  c.header('Cache-Control', 'private, max-age=30');
  return c.json({ ratings });
});

catalog.get('/', async (c) => {
  const page = parseQuery(c.req.queries());
  if (!page) return c.json({ error: '查询参数不合法' }, 400);
  const { limit, offset, q, category, electiveType, department, sort, program, planYear, resultsOnly } = page;
  const cacheKey = resultsOnly
    ? new URL('/api/courses/results-v2?' + new URLSearchParams({
        limit: String(limit), offset: String(offset), q, category, electiveType,
        department, sort, program, planYear,
      }), c.req.url).href
    : null;
  if (cacheKey) {
    const cached = await readPublicCache<CourseCatalogPage>(cacheKey);
    if (cached) {
      c.header('Cache-Control', 'private, max-age=15');
      return c.json(cached);
    }
  }
  const ranked = sort === 'rating' || sort === 'reviews';
  const blocked = await reserveQuota(c, resultsOnly && program && !ranked ? 'program' : 'catalog');
  if (blocked) return blocked;
  // SQL fragments only come from fixed sort options.
  const clauses = ['c.is_listed = 1'];
  const bindings: (string | number)[] = [];
  const filter = (sql: string, ...values: (string | number)[]) => {
    clauses.push(sql);
    bindings.push(...values);
  };
  if (q) {
    const aliases = aliasCodesForQuery(q);
    filter(`(instr(lower(c.name), lower(?)) > 0 OR instr(lower(coalesce(c.code, '')), lower(?)) > 0
      ${aliases.length ? 'OR c.code IN (SELECT value FROM json_each(?))' : ''})`,
    q, q, ...(aliases.length ? [JSON.stringify(aliases)] : []));
  }
  if (category === 'unknown') filter('c.category IS NULL');
  else if (category) filter('c.category = ?', category);
  if (department) filter('c.department = ?', department);
  if (electiveType === 'unknown') filter('e.elective_type IS NULL');
  else if (electiveType) filter('e.elective_type = ?', electiveType);
  if (program) {
    const year = planYear === 'unknown' ? ' AND source_year IS NULL' : planYear ? ' AND source_year=?' : '';
    const plan = planYear && planYear !== 'unknown' ? [program, Number(planYear)] : [program];
    filter(`c.id IN (
      SELECT course_id FROM course_materials WHERE kind='curriculum' AND program=?${year}
      UNION SELECT course_id FROM course_catalog_records WHERE program=?${year}
    )`, ...plan, ...plan);
  }
  const where = clauses.join(' AND ');
  const electiveJoin =
    "LEFT JOIN elective_course_facts e ON e.course_id = c.id AND c.category = 'elective'";
  const ratingsJoin = `LEFT JOIN (
    SELECT course_id, avg(rating) AS average, count(*) AS reviewCount
    FROM course_reviews WHERE status = 'published' AND withdrawn_at IS NULL GROUP BY course_id
  ) r ON r.course_id = c.id`;
  // Rating sorts need all candidates. Other sorts read ratings and source years only for this page.
  const filtered = clauses.length > 1;
  // A text search already needs to scan candidate names. Count its matches in that same pass.
  const countInPage = resultsOnly && !!q;
  const separateCount = (filtered || resultsOnly) && !countInPage;
  const facets = resultsOnly ? undefined : await readCatalogFacets(c);
  if (facets instanceof Response) return facets;
  const [entries, ...aggregates] = await c.env.DB.batch([
    c.env.DB.prepare(
      `WITH page AS (
        SELECT c.id, c.code, c.name, c.department, c.category, e.elective_type AS electiveType
        ${countInPage ? ', count(*) OVER () AS matchedCount' : ''}
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
    ...(separateCount ? [c.env.DB.prepare(
      `SELECT count(*) AS total FROM courses c ${electiveType ? electiveJoin : ''} WHERE ${where}`,
    ).bind(...bindings)] : []),
    ...(!resultsOnly ? [c.env.DB.prepare(`SELECT
      count(*) AS reviewCount, count(DISTINCT r.course_id) AS reviewedCourseCount
      FROM course_reviews r JOIN courses c ON c.id=r.course_id
      WHERE c.is_listed=1 AND r.status='published' AND r.withdrawn_at IS NULL`)] : []),
  ]);
  const [count, statistics] = separateCount ? aggregates : [undefined, ...aggregates];
  const rows = entries.results as (CourseSummary & { matchedCount?: number })[];
  let total = rows[0]?.matchedCount ?? (count?.results[0] as { total: number } | undefined)?.total;
  if (countInPage && total === undefined) {
    // An out-of-range shared URL has no row to carry the window count.
    total = offset ? (await c.env.DB.prepare(
      `SELECT count(*) AS total FROM courses c ${electiveType ? electiveJoin : ''} WHERE ${where}`,
    ).bind(...bindings).first<{ total: number }>())?.total : 0;
  }
  const courses = rows.slice(0, limit).map(({ matchedCount: _count, ...course }) => course);
  if (!resultsOnly && program && courses.length) {
    type PlanRecord = NonNullable<CourseSummary['planRecords']>[number];
    const planRows = await c.env.DB.prepare(
      `SELECT DISTINCT course_id AS courseId, program, source_year AS sourceYear, credits, requirement FROM (
        SELECT course_id, program, source_year, credits, requirement FROM course_materials WHERE kind='curriculum'
        UNION ALL SELECT course_id, program, source_year, credits, requirement FROM course_catalog_records WHERE program IS NOT NULL
      ) WHERE course_id IN (SELECT value FROM json_each(?))
        AND program=? AND (? = '' OR (? = 'unknown' AND source_year IS NULL) OR source_year=CAST(? AS INTEGER))
      ORDER BY source_year DESC, credits, requirement`,
    )
      .bind(
        JSON.stringify(courses.map((course) => course.id)),
        program,
        planYear,
        planYear,
        planYear,
      )
      .all<PlanRecord & { courseId: number }>();
    const records = new Map<number, PlanRecord[]>();
    for (const { courseId, ...record } of planRows.results) {
      const list = records.get(courseId) ?? [];
      list.push(record);
      records.set(courseId, list);
    }
    for (const course of courses) course.planRecords = records.get(course.id) ?? [];
  }
  const courseCount = facets?.departments.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const response: CourseCatalogPage = {
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
    total: total ?? courseCount,
    hasMore: entries.results.length > limit,
  };
  if (cacheKey) {
    if (courses.length) await writePublicCache(cacheKey, response, 60);
    c.header('Cache-Control', 'private, max-age=15');
    return c.json(response);
  }
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({
    ...response,
    facets,
    stats: {
      ...(statistics!.results[0] as Pick<CourseCatalog['stats'], 'reviewCount' | 'reviewedCourseCount'>),
      courseCount,
    },
  });
});

catalog.get('/:id', async (c) => {
  const query = c.req.queries();
  const compact = query.view?.[0] === 'page';
  if (
    !isResourceId(c.req.param('id')) ||
    Object.entries(query).some(([key, values]) => key !== 'view' || values.length !== 1 || !compact)
  )
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
    compact ? Promise.resolve(undefined) : readCourseMaterials(c.env.DB, course.id),
  ]);
  c.header('Cache-Control', 'private, max-age=60');
  return c.json({ course: { ...course, elective, ...(materials ? { materials } : {}) } });
});

export default catalog;
