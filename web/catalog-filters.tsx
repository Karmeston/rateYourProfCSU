import { useState } from 'react';
import {
  courseCategoryFilters,
  courseCategories,
  courseSorts,
  type CourseCatalog,
} from '../shared/catalog';
import { electiveTypes, type ElectiveTypeFilter } from '../shared/electives';
import { isMinorProgram } from '../shared/course-directory';
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
  const knownTypes = facets?.electiveTypes ?? [];
  // With no classified elective, the only other choice would match every course.
  const showElectiveTypes = knownTypes.length > 0 || !!route.electiveType;
  const colleges = facets?.colleges ?? [];
  const college = colleges.find((item) => item.name === route.college);
  const needsCollege = colleges.length > 0 && !route.college && !route.program;
  const programs = needsCollege ? [] : route.college ? college?.programs ?? [] : facets?.programs ?? [];
  const [showMinor, setShowMinor] = useState(false);
  const visiblePrograms = programs.filter(
    (item) => showMinor || item.name === route.program || !isMinorProgram(item.name),
  );
  const hasMinorOptions =
    route.category !== 'elective' &&
    (!!route.college || !colleges.length) &&
    programs.some((item) => isMinorProgram(item.name));
  const programPlaceholder = route.college
    ? '全部主修专业'
    : colleges.length ? '请先选择学院' : '选择你的专业';
  const showTeachingUnits = !route.college && !route.program && departments.length > 0;
  const categories = route.category === 'unknown' ? courseCategoryFilters : courseCategories;
  return (
    <div className="catalog-filters">
      <nav className="category-filter" aria-label="课程类型">
        {[['', '全部课程'], ...Object.entries(categories)].map(([value, label]) => (
          <a
            key={value}
            href={href({ category: value as CatalogRoute['category'] })}
            aria-current={!route.college && !route.program && route.category === value ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="catalog-filter-fields">
        {route.category !== 'elective' && !!colleges.length && (
          <label>
            培养学院
            <select
              value={route.college}
              onChange={(event) => change({ college: event.target.value, program: '' })}
            >
              <option value="">全部学院</option>
              {route.college && !college && <option>{route.college}</option>}
              {colleges.map(({ name }) => <option key={name}>{name}</option>)}
            </select>
          </label>
        )}
        {route.category !== 'elective' && (
          <label>
            专业／班型
            <select
              value={route.program}
              onChange={(event) => change({ program: event.target.value })}
              disabled={needsCollege}
            >
              <option value="">{programPlaceholder}</option>
              {route.program && !programs.some((item) => item.name === route.program) && (
                <option>{route.program}</option>
              )}
              {visiblePrograms.map((item) => (
                <option key={item.name} value={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
        )}
        {route.category === 'elective' && showElectiveTypes && (
          <label>
            公选课类别
            <select
              value={route.electiveType}
              onChange={(event) =>
                change({ electiveType: event.target.value as ElectiveTypeFilter })
              }
            >
              <option value="">全部类别</option>
              {route.electiveType && route.electiveType !== 'unknown' && !knownTypes.includes(route.electiveType) && (
                <option value={route.electiveType}>{electiveTypes[route.electiveType]}</option>
              )}
              {knownTypes.map((value) => (
                <option key={value} value={value}>
                  {electiveTypes[value]}
                </option>
              ))}
              <option value="unknown">类别待核实</option>
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
      {(hasMinorOptions || showTeachingUnits) && (
        <details className="catalog-extra" open={route.department ? true : undefined}>
          <summary>更多筛选</summary>
          {hasMinorOptions && (
            <label>
              <input type="checkbox" checked={showMinor} onChange={(event) => setShowMinor(event.target.checked)} />
              显示辅修方案
            </label>
            )}
          {showTeachingUnits && (
            <label>
              原始开课单位
              <select value={route.department} onChange={(event) => change({ department: event.target.value })}>
                <option value="">全部开课单位</option>
                {route.department && !departments.some((item) => item.name === route.department) && <option>{route.department}</option>}
                {departments.map(({ name }) => (
                  <option key={name} value={name}>{name === '待核实' ? '未标注开课单位' : name}</option>
                ))}
              </select>
              <small>按来源中的单位名称精确筛选，包含院系、教研室，不等同于学院培养方案。</small>
            </label>
          )}
        </details>
      )}
    </div>
  );
}
