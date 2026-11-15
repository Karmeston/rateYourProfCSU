import type { Course, CourseCatalog, CourseCategory, CourseSummary } from './catalog.ts';
import type { ElectiveType } from './electives.ts';

export type DirectorySnapshot = {
  version: 1;
  departments: string[];
  courses: [id: number, name: string, code: string | null, department: number, category: CourseCategory | null, electiveType: ElectiveType | null][];
  programs: [name: string, versions: [year: number | null, courseIds: number[]][]][];
};

export type CourseRating = [id: number, average: number, count: number];
type DirectoryCourse = Omit<Course, 'departmentSourceYear'>;

export function openDirectory(snapshot: DirectorySnapshot) {
  if (snapshot.version !== 1) throw new Error('Unsupported course directory');
  const departments = snapshot.departments.map((name) => ({ name, count: 0 }));
  const courses = snapshot.courses.map(([id, name, code, index, category, electiveType]) => {
    const department = departments[index];
    department.count++;
    return { id, name, code, department: department.name, category, electiveType };
  });
  const programs = new Map(
    snapshot.programs.map(([name, versions]) => [
      name,
      new Map(versions.map(([year, ids]) => [year === null ? 'unknown' : String(year), ids])),
    ]),
  );
  const facets: CourseCatalog['facets'] = {
    departments,
    programs: snapshot.programs.map(([name, versions]) => ({ name, years: versions.map(([year]) => year) })),
  };
  return { courses, programs, facets };
}

type SearchFilters = Pick<import('./catalog.ts').CourseCatalogPage, 'q' | 'category' | 'electiveType' | 'department' | 'program' | 'planYear' | 'sort' | 'offset'>;
type Directory = ReturnType<typeof openDirectory>;
const nameOrder = new Intl.Collator('zh-CN', { numeric: true });

export function searchDirectory(
  { courses, programs }: Directory,
  filters: SearchFilters,
  limit: number,
  ratings: readonly CourseRating[] = [],
) {
  const { q, program, planYear, category, department, electiveType, sort, offset } = filters;
  const years = programs.get(program);
  const members = program
    ? new Set(planYear ? years?.get(planYear) : [...(years?.values() ?? [])].flat())
    : null;
  const term = q.trim().toLowerCase();
  const matched = courses.filter((course) =>
    (!members || members.has(course.id)) &&
    (!category || course.category === (category === 'unknown' ? null : category)) &&
    (!department || course.department === department) &&
    (!electiveType || course.electiveType === (electiveType === 'unknown' ? null : electiveType)) &&
    (!term || course.name.toLowerCase().includes(term) || course.code?.toLowerCase().includes(term)),
  );
  const byId = new Map(ratings.map(([id, average, reviewCount]) => [id, { average, reviewCount }]));
  const average = (course: DirectoryCourse) => byId.get(course.id)?.average ?? -1;
  const count = (course: DirectoryCourse) => byId.get(course.id)?.reviewCount ?? 0;
  if (sort === 'name') matched.sort((a, b) => nameOrder.compare(a.name, b.name) || a.id - b.id);
  if (sort === 'rating') matched.sort((a, b) => average(b) - average(a) || count(b) - count(a) || a.id - b.id);
  if (sort === 'reviews') matched.sort((a, b) => count(b) - count(a) || average(b) - average(a) || a.id - b.id);
  const page: CourseSummary[] = matched.slice(offset, offset + limit).map((course) => ({
    ...course,
    departmentSourceYear: null,
    average: byId.get(course.id)?.average ?? null,
    reviewCount: count(course),
  }));
  return { courses: page, total: matched.length, hasMore: offset + limit < matched.length };
}
