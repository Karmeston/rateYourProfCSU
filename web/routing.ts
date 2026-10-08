import { courseSorts, type CourseCategory, type CourseSort } from '../shared/catalog.ts';

export const pageSize = 20;
export type CatalogFilters = {
  q: string;
  category: CourseCategory | '';
  department: string;
  sort: CourseSort;
  offset: number;
};
export type CatalogRoute = CatalogFilters & { page: 'catalog' | 'saved'; home: boolean };
export type Route =
  | CatalogRoute
  | { page: 'detail'; kind: 'courses' | 'teachers'; id: string; from: string }
  | { page: 'guide' }
  | { page: 'teachers'; q: string; offset: number }
  | { page: 'not-found' };
export const defaultFilters: CatalogFilters = {
  q: '',
  category: '',
  department: '',
  sort: 'default',
  offset: 0,
};

export function catalogHref(
  filters: CatalogFilters & { page?: string },
  patch: Partial<CatalogFilters> = {},
) {
  const value = { ...filters, ...patch };
  const query = new URLSearchParams();
  if (value.q) query.set('q', value.q);
  if (value.category) query.set('category', value.category);
  if (value.department) query.set('department', value.department);
  if (value.sort !== 'default') query.set('sort', value.sort);
  if (value.offset) query.set('offset', String(value.offset));
  return `#/${filters.page === 'saved' ? 'saved' : 'courses'}${query.size ? `?${query}` : ''}`;
}

export function parseRoute(hash: string, teachersEnabled = false): Route {
  const fragment = (hash || '#/').slice(1);
  const separator = fragment.indexOf('?');
  const path = separator < 0 ? fragment : fragment.slice(0, separator);
  const query = separator < 0 ? '' : fragment.slice(separator + 1);
  if (!teachersEnabled && /^\/teachers(?:\/|$)/.test(path))
    return { page: 'catalog', home: true, ...defaultFilters };
  const params = new URLSearchParams(query);
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    return { page: 'not-found' };
  if (path === '/guide' && !query) return { page: 'guide' };
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
      /^#\/(?:courses|saved)?(?:\?|$)/.test(candidate) &&
      candidate.length <= 1000 &&
      ['catalog', 'saved'].includes(parseRoute(candidate, teachersEnabled).page)
        ? candidate
        : '#/';
    return { page: 'detail', kind: detail[1] as 'courses' | 'teachers', id: detail[2], from };
  }
  if (
    !['/', '/courses', '/saved', '/teachers'].includes(path) ||
    [...params.keys()].some(
      (key) => !['q', 'category', 'department', 'sort', 'offset'].includes(key),
    )
  )
    return { page: 'not-found' };
  const rawOffset = params.get('offset') ?? '0';
  const q = params.get('q')?.trim() ?? '';
  const department = params.get('department') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'default';
  if (
    !/^(0|[1-9]\d*)$/.test(rawOffset) ||
    Number(rawOffset) > 100000 ||
    q.length > 100 ||
    q.includes('\0') ||
    department.length > 100 ||
    department.includes('\0') ||
    !['', 'major', 'elective'].includes(category) ||
    !Object.hasOwn(courseSorts, sort)
  )
    return { page: 'not-found' };
  if (path === '/teachers') return { page: 'teachers', q, offset: Number(rawOffset) };
  return {
    page: path === '/saved' ? 'saved' : 'catalog',
    home: path === '/',
    q,
    category: category as CourseCategory | '',
    department,
    sort: sort as CourseSort,
    offset: Number(rawOffset),
  };
}
