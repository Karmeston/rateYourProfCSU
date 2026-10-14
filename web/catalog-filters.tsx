import { courseCategories, courseSorts, type CourseCatalog } from '../shared/catalog';
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
  const years = facets?.programs.find((item) => item.name === route.program)?.years ?? [];
  return (
    <div className="catalog-filters">
      <nav className="category-filter" aria-label="课程类型">
        {[['', '全部课程'], ...Object.entries(courseCategories)].map(([value, label]) => (
          <a
            key={value}
            href={href({ category: value as CatalogRoute['category'] })}
            aria-current={route.category === value ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="catalog-filter-fields">
        <label>
          学院（含资料来源）
          <select
            value={route.department}
            onChange={(event) => change({ department: event.target.value })}
          >
            <option value="">全部学院</option>
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
        {route.category === 'elective' ? (
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
        ) : (
          <label>
            培养方案专业
            <select
              value={route.program}
              onChange={(event) => change({ program: event.target.value })}
            >
              <option value="">全部专业</option>
              {route.program && !facets?.programs.some((item) => item.name === route.program) && (
                <option>{route.program}</option>
              )}
              {facets?.programs.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
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
              {route.planYear && !years.includes(Number(route.planYear)) && (
                <option value={route.planYear}>
                  {route.planYear}版{facets ? '（未收录）' : ''}
                </option>
              )}
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}版
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
      {route.program && (
        <p className="fine-print catalog-plan-note">
          按已收录方案记录筛选，可能含辅修表；不代表当期开课或个人选课资格。
        </p>
      )}
    </div>
  );
}
