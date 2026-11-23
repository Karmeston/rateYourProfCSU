import { useEffect, useMemo, useState } from 'react';
import snapshotUrl from '../data/course-data/public-directory.json?url';
import type { CourseCatalog, CourseCatalogPage } from '../shared/catalog';
import {
  latestPlanYear,
  openDirectory,
  searchDirectory,
  type CourseRating,
  type DirectoryCourse,
  type DirectorySnapshot,
} from '../shared/course-directory';
import { pageSize, type CatalogRoute } from './routing';
import { useData } from './use-data';

// Development can use a small or empty local D1 without pointing at production course IDs.
export const staticDirectoryEnabled = import.meta.env.MODE !== 'local-d1';

function localCatalogUrl(route: CatalogRoute, plans: CourseCatalog['facets']['programs'] | undefined) {
  if (route.program && !plans) return null;
  const params = new URLSearchParams({
    view: 'results',
    limit: String(pageSize),
    offset: String(route.offset),
    q: route.q,
    sort: route.sort,
  });
  for (const key of ['category', 'electiveType', 'department', 'program'] as const)
    if (route[key]) params.set(key, route[key]);
  const plan = plans?.find(({ name }) => name === route.program);
  const year = latestPlanYear(plan?.years ?? []);
  if (year !== undefined) params.set('planYear', year === null ? 'unknown' : String(year));
  return `/api/courses?${params}`;
}

export function useDirectory(route: CatalogRoute) {
  const snapshot = useData<DirectorySnapshot>(staticDirectoryEnabled ? snapshotUrl : null, 'default');
  const localFacets = useData<CourseCatalog['facets']>(
    staticDirectoryEnabled ? null : '/api/courses/facets', 'default',
  );
  const local = useData<CourseCatalogPage>(
    staticDirectoryEnabled ? null : localCatalogUrl(route, localFacets.data?.programs), 'default',
  );
  const localPlansError = route.program ? localFacets.error : undefined;
  const ranked = route.sort === 'rating' || route.sort === 'reviews';
  const ratings = useData<{ ratings: CourseRating[] }>(
    staticDirectoryEnabled && ranked ? '/api/courses/ratings' : null, 'default',
  );
  const directory = useMemo(() => {
    if (!snapshot.data) return null;
    try {
      return openDirectory(snapshot.data);
    } catch {
      return null;
    }
  }, [snapshot.data]);
  const results = useMemo(
    () => directory && searchDirectory(directory, route, pageSize, ratings.data?.ratings),
    [directory, route, ratings.data],
  );

  return {
    data: staticDirectoryEnabled ? results : local.data,
    facets: staticDirectoryEnabled ? directory?.facets : localFacets.data,
    error: staticDirectoryEnabled
      ? snapshot.error ?? (snapshot.data && !directory ? '课程目录版本暂不可用，请刷新页面。' : undefined)
      : localPlansError ?? local.error,
    retry: staticDirectoryEnabled ? snapshot.retry : localPlansError ? localFacets.retry : local.retry,
    showRatings: !staticDirectoryEnabled || !!ratings.data,
    ratingsLoading: staticDirectoryEnabled && ranked && !ratings.data && !ratings.error,
    ratingsError: ratings.error,
    retryRatings: ratings.retry,
  };
}

// One parsed copy per page load; the hashed snapshot itself comes from the browser cache.
let directoryCourses: Promise<Map<number, DirectoryCourse>> | undefined;
function loadDirectoryCourses() {
  directoryCourses ??= fetch(snapshotUrl, { signal: AbortSignal.timeout(20000) })
    .then((response) => {
      if (!response.ok) throw new Error('Directory unavailable');
      return response.json() as Promise<DirectorySnapshot>;
    })
    .then((snapshot) => new Map(openDirectory(snapshot).courses.map((course) => [course.id, course])));
  directoryCourses.catch(() => {
    directoryCourses = undefined;
  });
  return directoryCourses;
}

// Course details without elective guidance come from the static directory, saving an API call.
// undefined: still loading; null: use the API (not listed here, elective, or snapshot failed).
export function useDirectoryCourse(id: string): DirectoryCourse | null | undefined {
  const [state, setState] = useState<{ id: string; course: DirectoryCourse | null }>();
  useEffect(() => {
    if (!staticDirectoryEnabled) return;
    let active = true;
    void loadDirectoryCourses()
      .then((courses) => courses.get(Number(id)) ?? null, () => null)
      .then((course) => {
        if (active) setState({ id, course: course?.category === 'elective' ? null : course });
      });
    return () => {
      active = false;
    };
  }, [id]);
  if (!staticDirectoryEnabled) return null;
  return state?.id === id ? state.course : undefined;
}
