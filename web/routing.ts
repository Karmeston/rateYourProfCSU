import { courseSorts, type CourseCategoryFilter, type CourseSort } from '../shared/catalog.ts';
import { isElectiveTypeFilter, type ElectiveTypeFilter } from '../shared/electives.ts';

// A full page fills both the desktop three-column and tablet two-column grids.
export const pageSize = 24;
export type CatalogFilters = {
  q: string;
  category: CourseCategoryFilter;
  electiveType: ElectiveTypeFilter;
  department: string;
  program: string;
  planYear: string;
  sort: CourseSort;
  offset: number;
};
export type CatalogRoute = CatalogFilters & { page: 'catalog' };
export type Route =
  | CatalogRoute
  | { page: 'detail'; id: string; from: string }
  | { page: 'guide' }
  | { page: 'admin' }
  | { page: 'not-found' };
export const defaultFilters: CatalogFilters = {
  q: '',
  category: '',
  electiveType: '',
  department: '',
  program: '',
  planYear: '',
  sort: 'default',
  offset: 0,
};

export function catalogHref(filters: CatalogFilters, patch: Partial<CatalogFilters> = {}) {
  const value = { ...filters, ...patch };
  if (patch.program !== undefined && patch.program !== filters.program) {
    if (patch.planYear === undefined) value.planYear = '';
    if (value.program) {
      value.category = '';
      value.electiveType = '';
      if (patch.department === undefined) value.department = '';
    }
  }
  if (patch.category !== undefined && patch.program === undefined) {
    value.program = '';
    value.planYear = '';
  }
  if (!value.program) value.planYear = '';
  if (
    patch.category !== undefined &&
    patch.category !== 'elective' &&
    patch.electiveType === undefined
  )
    value.electiveType = '';
  if (value.electiveType) {
    value.category = 'elective';
    value.program = '';
    value.planYear = '';
  }
  if (value.program) value.category = '';
  const query = new URLSearchParams();
  if (value.q) query.set('q', value.q);
  if (value.category) query.set('category', value.category);
  if (value.electiveType) query.set('electiveType', value.electiveType);
  if (value.department) query.set('department', value.department);
  if (value.program) query.set('program', value.program);
  if (value.planYear) query.set('planYear', value.planYear);
  if (value.sort !== 'default') query.set('sort', value.sort);
  if (value.offset) query.set('offset', String(value.offset));
  return `#/courses${query.size ? `?${query}` : ''}`;
}

export function parseRoute(hash: string): Route {
  const fragment = (hash || '#/').slice(1);
  const separator = fragment.indexOf('?');
  const path = separator < 0 ? fragment : fragment.slice(0, separator);
  const query = separator < 0 ? '' : fragment.slice(separator + 1);
  // Retired saved and teacher pages still open the course catalog.
  if (path === '/saved' || /^\/teachers(?:\/|$)/.test(path))
    return { page: 'catalog', ...defaultFilters };
  const params = new URLSearchParams(query);
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    return { page: 'not-found' };
  if (path === '/guide' && !query) return { page: 'guide' };
  if (path === '/admin' && !query) return { page: 'admin' };
  const detail = /^\/courses\/(-?[1-9]\d*)$/.exec(path);
  if (detail) {
    if (
      !Number.isSafeInteger(Number(detail[1])) ||
      [...params.keys()].some((key) => key !== 'from')
    )
      return { page: 'not-found' };
    const candidate = params.get('from') ?? '#/';
    // A return link may only point to a valid internal catalog, never an external URL.
    const from =
      /^#\/(?:courses)?(?:\?|$)/.test(candidate) &&
      candidate.length <= 1000 &&
      parseRoute(candidate).page === 'catalog'
        ? candidate
        : '#/';
    return { page: 'detail', id: detail[1], from };
  }
  if (
    !['/', '/courses'].includes(path) ||
    [...params.keys()].some(
      (key) =>
        ![
          'q',
          'category',
          'electiveType',
          'department',
          'sort',
          'offset',
          'program',
          'planYear',
        ].includes(key),
    )
  )
    return { page: 'not-found' };
  const rawOffset = params.get('offset') ?? '0';
  const q = params.get('q')?.trim() ?? '';
  const department = params.get('department') ?? '';
  const category = params.get('category') ?? '';
  const electiveType = params.get('electiveType') ?? '';
  const sort = params.get('sort') ?? 'default';
  const program = params.get('program') ?? '';
  const planYear = params.get('planYear') ?? '';
  if (
    !/^(0|[1-9]\d*)$/.test(rawOffset) ||
    Number(rawOffset) > 100000 ||
    q.length > 100 ||
    q.includes('\0') ||
    department.length > 100 ||
    department.includes('\0') ||
    !['', 'major', 'elective', 'unknown'].includes(category) ||
    !isElectiveTypeFilter(electiveType) ||
    (electiveType && category && category !== 'elective') ||
    !Object.hasOwn(courseSorts, sort) ||
    program.length > 100 ||
    program.includes('\0') ||
    (params.has('program') && !program.trim()) ||
    (program && ((category && category !== 'major') || electiveType)) ||
    (params.has('planYear') && (!program || !/^(20\d{2}|unknown)$/.test(planYear)))
  )
    return { page: 'not-found' };
  return {
    page: 'catalog',
    q,
    category: program ? '' : electiveType ? 'elective' : (category as CourseCategoryFilter),
    electiveType,
    department,
    program,
    planYear,
    sort: sort as CourseSort,
    // Old shared links may use a 20-row offset; keep them on a complete current page.
    offset: Math.floor(Number(rawOffset) / pageSize) * pageSize,
  };
}
