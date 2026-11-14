import {
  courseCategoryFilters,
  courseCategories,
  courseSorts,
  planVersionLabel,
  type CourseCatalog,
} from '../shared/catalog';
import { electiveTypes, type ElectiveTypeFilter } from '../shared/electives';
import { catalogHref, type CatalogRoute, type CatalogFilters } from './routing';

export function CatalogFiltersPanel({
  route,
  facets,
}: {
  route: CatalogRoute;
  facets?: CourseCatalog['facets'];
}) {
  const href = (patch: Partial<CatalogFilters>) => catalogHref(route, { ...patch, offset: 0 });
  const change = (patch: Partial<CatalogFilters>) => {
    window.location.hash = href(patch);
  };
  const departments = facets?.departments ?? [];
  const programs = facets?.programs ?? [];
  const years = programs.find((item) => item.name === route.program)?.years ?? [];
  const categories = route.category === 'unknown' ? courseCategoryFilters : courseCategories;
  return (
    <div className="catalog-filters">
      <nav className="category-filter" aria-label="课程类型">
        {[['', '全部课程'], ...Object.entries(categories)].map(([value, label]) => (
          <a
            key={value}
            href={href({ category: value as CatalogRoute['category'] })}
            aria-current={!route.program && route.category === value ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="catalog-filter-fields">
        <label>
          按专业查课
          <select
            value={route.program}
            onChange={(event) => change({ program: event.target.value })}
          >
            <option value="">选择你的专业</option>
            {route.program && !programs.some((item) => item.name === route.program) && (
              <option>{route.program}</option>
            )}
            {programs.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {route.category === 'elective' && (
          <label>
            公选课类别
            <select
              value={route.electiveType}
              onChange={(event) =>
                change({ electiveType: event.target.value as ElectiveTypeFilter })
              }
            >
              <option value="">全部类别</option>
              {Object.entries(electiveTypes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="unknown">类别待核实</option>
            </select>
          </label>
        )}
        {!route.program && (
          <label>
            学院／教学单位
            <select
              value={route.department}
              onChange={(event) => change({ department: event.target.value })}
            >
              <option value="">全部教学单位</option>
              {route.department && !departments.some((item) => item.name === route.department) && (
                <option>{route.department}</option>
              )}
              {departments.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name === '待核实' ? '学院待补充' : item.name} · {item.count}
                </option>
              ))}
            </select>
          </label>
        )}
        {route.program && (
          <label>
            方案版本
            <select
              value={route.planYear}
              onChange={(event) => change({ planYear: event.target.value })}
            >
              <option value="">全部已收录版本</option>
              {route.planYear &&
                !years.includes(route.planYear === 'unknown' ? null : Number(route.planYear)) && (
                  <option value={route.planYear}>
                    {planVersionLabel(route.planYear)}
                    {facets ? '（未收录）' : ''}
                  </option>
                )}
              {years.map((year) => (
                <option key={year ?? 'unknown'} value={year ?? 'unknown'}>
                  {planVersionLabel(year)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          排序方式
          <select
            value={route.sort}
            onChange={(event) => change({ sort: event.target.value as CatalogRoute['sort'] })}
          >
            {Object.entries(courseSorts).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
