import { useMemo } from 'react';
import snapshotUrl from '../data/course-data/public-directory.json?url';
import type { CourseCatalog, CourseCatalogPage } from '../shared/catalog';
import { openDirectory, searchDirectory, type CourseRating, type DirectorySnapshot } from '../shared/course-directory';
import { pageSize, type CatalogRoute } from './routing';
import { useData } from './use-data';

// Development can use a small or empty local D1 without pointing at production course IDs.
export const staticDirectoryEnabled = import.meta.env.MODE !== 'local-d1';

function localCatalogUrl(route: CatalogRoute) {
  const params = new URLSearchParams({
    view: 'results',
    limit: String(pageSize),
    offset: String(route.offset),
    q: route.q,
    sort: route.sort,
  });
  for (const key of ['category', 'electiveType', 'department', 'program', 'planYear'] as const)
    if (route[key]) params.set(key, route[key]);
  return `/api/courses?${params}`;
}

export function useDirectory(route: CatalogRoute) {
  const snapshot = useData<DirectorySnapshot>(staticDirectoryEnabled ? snapshotUrl : null, 'default');
  const local = useData<CourseCatalogPage>(staticDirectoryEnabled ? null : localCatalogUrl(route), 'default');
  const localFacets = useData<CourseCatalog['facets']>(
    staticDirectoryEnabled ? null : '/api/courses/facets', 'default',
  );
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
      : local.error,
    retry: staticDirectoryEnabled ? snapshot.retry : local.retry,
    showRatings: !staticDirectoryEnabled || !!ratings.data,
    ratingsLoading: staticDirectoryEnabled && ranked && !ratings.data && !ratings.error,
    ratingsError: ratings.error,
    retryRatings: ratings.retry,
  };
}
