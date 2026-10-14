import { courseSorts, type CourseCategory, type CourseSort } from '../shared/catalog.ts';
import { isElectiveTypeFilter, type ElectiveTypeFilter } from '../shared/electives.ts';

export const pageSize = 20;
export type CatalogFilters = {
  q: string;
  category: CourseCategory | '';
  electiveType: ElectiveTypeFilter;
  department: string;
  program: string;
  planYear: string;
  sort: CourseSort;
  offset: number;
};
export type CatalogRoute = CatalogFilters & { page: 'catalog'; home: boolean };
export type Route =
  | CatalogRoute
  | { page: 'detail'; kind: 'courses' | 'teachers'; id: string; from: string }
  | { page: 'guide' }
  | { page: 'admin' }
  | { page: 'teachers'; q: string; offset: number }
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
  if (patch.program !== undefined && patch.planYear === undefined) value.planYear = '';
  if (patch.category !== undefined && patch.category !== 'major') {
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
  if (value.program) value.category = 'major';
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

export function parseRoute(hash: string, teachersEnabled = false): Route {
  const fragment = (hash || '#/').slice(1);
  const separator = fragment.indexOf('?');
  const path = separator < 0 ? fragment : fragment.slice(0, separator);
  const query = separator < 0 ? '' : fragment.slice(separator + 1);
  // Retired bookmark links open the catalog rather than a dead page.
  if (path === '/saved') return { page: 'catalog', home: true, ...defaultFilters };
  if (!teachersEnabled && /^\/teachers(?:\/|$)/.test(path))
    return { page: 'catalog', home: true, ...defaultFilters };
  const params = new URLSearchParams(query);
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    return { page: 'not-found' };
  if (path === '/guide' && !query) return { page: 'guide' };
  if (path === '/admin' && !query) return { page: 'admin' };
  const detail = /^\/(courses|teachers)\/(-?[1-9]\d*)$/.exec(path);
  if (detail) {
    if (
      !Number.isSafeInteger(Number(detail[2])) ||
      [...params.keys()].some((key) => key !== 'from')
    )
      return { page: 'not-found' };
    const candidate = params.get('from') ?? '#/';
    // A return link may only point to a valid internal catalog, never an external URL.
    const from =
      /^#\/(?:courses)?(?:\?|$)/.test(candidate) &&
      candidate.length <= 1000 &&
      parseRoute(candidate, teachersEnabled).page === 'catalog'
        ? candidate
        : '#/';
    return { page: 'detail', kind: detail[1] as 'courses' | 'teachers', id: detail[2], from };
  }
  if (
    !['/', '/courses', '/teachers'].includes(path) ||
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
    !['', 'major', 'elective'].includes(category) ||
    !isElectiveTypeFilter(electiveType) ||
    (electiveType && category === 'major') ||
    !Object.hasOwn(courseSorts, sort) ||
    program.length > 100 ||
    program.includes('\0') ||
    (params.has('program') && !program.trim()) ||
    (program && (category === 'elective' || electiveType)) ||
    (params.has('planYear') && (!program || !/^20\d{2}$/.test(planYear)))
  )
    return { page: 'not-found' };
  if (path === '/teachers') return { page: 'teachers', q, offset: Number(rawOffset) };
  return {
    page: 'catalog',
    home: path === '/',
    q,
    category: program ? 'major' : electiveType ? 'elective' : (category as CourseCategory | ''),
    electiveType,
    department,
    program,
    planYear,
    sort: sort as CourseSort,
    offset: Number(rawOffset),
  };
}
