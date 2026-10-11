import { useEffect, useRef, useState } from 'react';
import {
  courseCategories,
  courseSorts,
  type CourseCatalog,
  type CourseSummary,
} from '../shared/catalog';
import { electiveTypes, type ElectiveTypeFilter } from '../shared/electives';
import { Icon } from './icons';
import {
  catalogHref,
  defaultFilters,
  pageSize,
  type CatalogFilters,
  type CatalogRoute,
} from './routing';
import { Stars } from './reviews';
import { EmptyState, ErrorState, LoadingCards } from './ui';
import { useData } from './use-data';

function Search({ route }: { route: CatalogRoute }) {
  const [query, setQuery] = useState(route.q);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(route.q), [route.q]);
  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        window.location.hash = catalogHref(route, { q: query.trim(), offset: 0 });
      }}
    >
      <Icon name="search" size={22} />
      <input
        ref={input}
        id="course-search"
        type="search"
        maxLength={100}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="搜索课程名称或代码"
        placeholder="搜索课程名称或代码"
      />
      {query ? (
        <button
          className="icon-button"
          type="button"
          aria-label="清空搜索输入"
          onClick={() => {
            setQuery('');
            input.current?.focus();
          }}
        >
          <Icon name="close" />
        </button>
      ) : (
        <kbd>/</kbd>
      )}
      <button className="primary-button" type="submit">
        搜索 <Icon name="arrow" size={17} />
      </button>
    </form>
  );
}

function CourseCard({ course, from }: { course: CourseSummary; from: string }) {
  return (
    <li className="course-card">
      <div className="card-top">
        <span className={`category-badge ${course.category ?? 'unknown'}`}>
          <i />
          {course.category ? courseCategories[course.category] : '待分类'}
        </span>
        {course.category === 'elective' && (
          <span className="elective-type-label">
            {course.electiveType ? electiveTypes[course.electiveType] : '类别待核实'}
          </span>
        )}
      </div>
      <div className="card-content">
        <h2>
          <a
            className="course-link"
            href={`#/courses/${course.id}?from=${encodeURIComponent(from)}`}
          >
            {course.name}
          </a>
        </h2>
        <p className="metadata">
          {course.department === '待核实' ? '开课学院待补充' : course.department}
          {course.departmentSourceYear != null && ` · ${course.departmentSourceYear}大纲学院`}
        </p>
        <div className="card-code">
          {course.code ?? '课程代码待补充'}
          {course.id < 0 && <span className="demo-badge">演示</span>}
        </div>
        {course.planRecords?.map((record, index) => (
          <p className="fine-print" key={index}>
            {record.sourceYear}版 · {record.requirement ?? '属性待核实'} ·{' '}
            {record.credits == null ? '学分待核实' : `${record.credits}学分`}
          </p>
        ))}
      </div>
      <div className="card-footer">
        {course.average === null ? (
          <div className="unrated">
            <span>—</span>
            <div>暂无评价</div>
          </div>
        ) : (
          <div
            className="catalog-rating"
            aria-label={`${course.average.toFixed(1)} 分，${course.reviewCount} 条评价`}
          >
            <strong>{course.average.toFixed(1)}</strong>
            <div>
              <Stars rating={course.average} />
              <small>{course.reviewCount} 条评价</small>
            </div>
          </div>
        )}
        <Icon name="arrow" size={19} />
      </div>
    </li>
  );
}

export function Catalog({ route }: { route: CatalogRoute }) {
  const href = (patch: Partial<CatalogFilters>) => catalogHref(route, patch);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(route.offset),
    q: route.q,
    sort: route.sort,
  });
  if (route.category) params.set('category', route.category);
  if (route.electiveType) params.set('electiveType', route.electiveType);
  if (route.department) params.set('department', route.department);
  if (route.program) params.set('program', route.program);
  if (route.planYear) params.set('planYear', route.planYear);
  const { data, error, retry } = useData<CourseCatalog>(`/api/courses?${params}`);
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('csu-catalog-view') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  function changeView(value: 'grid' | 'list') {
    setView(value);
    try {
      localStorage.setItem('csu-catalog-view', value);
    } catch {
      /* 当前页面仍可切换布局。 */
    }
  }
  const filtered = !!(
    route.q ||
    route.category ||
    route.electiveType ||
    route.department ||
    route.program
  );
  const title = route.q ? `“${route.q}”的搜索结果` : '课程广场';
  const departments = data?.facets.departments ?? [];
  return (
    <div className="catalog-page">
      <section className="catalog-intro">
        <h1>课程广场</h1>
        <Search route={route} />
      </section>
      <div className="catalog-layout">
        <section className="catalog-content" aria-label={title}>
          <div className="section-heading">
            <div>
              {route.q && <strong className="results-title">{title}</strong>}
              <span className="result-count" role="status">
                {data ? `${data.total} 门课程` : '正在查找…'}
              </span>
            </div>
            <div className="view-toggle" role="group" aria-label="课程展示方式">
              <button
                aria-label="网格视图"
                aria-pressed={view === 'grid'}
                onClick={() => changeView('grid')}
              >
                <Icon name="grid" size={18} />
              </button>
              <button
                aria-label="列表视图"
                aria-pressed={view === 'list'}
                onClick={() => changeView('list')}
              >
                <Icon name="list" size={18} />
              </button>
            </div>
          </div>
          <div className="catalog-toolbar">
            <nav className="category-filter" aria-label="课程类型">
              {[['', '全部课程'], ...Object.entries(courseCategories)].map(([value, label]) => (
                <a
                  key={value}
                  href={href({ category: value as CatalogRoute['category'], offset: 0 })}
                  aria-current={route.category === value ? 'page' : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="select-filters">
              {route.category === 'elective' && (
                <label className="elective-type-filter">
                  <span className="sr-only">公选课类别</span>
                  <select
                    value={route.electiveType}
                    onChange={(event) => {
                      window.location.hash = href({
                        electiveType: event.target.value as ElectiveTypeFilter,
                        offset: 0,
                      });
                    }}
                  >
                    <option value="">全部公选课类别</option>
                    {Object.entries(electiveTypes).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                    <option value="unknown">类别待核实</option>
                  </select>
                </label>
              )}
              <label>
                <span className="sr-only">学院（含资料来源）</span>
                <select
                  value={route.department}
                  onChange={(event) => {
                    window.location.hash = href({ department: event.target.value, offset: 0 });
                  }}
                >
                  <option value="">全部学院</option>
                  {route.department &&
                    !departments.some((department) => department.name === route.department) && (
                      <option value={route.department}>{route.department}</option>
                    )}
                  {departments.map((department) => (
                    <option key={department.name} value={department.name}>
                      {department.name === '待核实' ? '学院待补充' : department.name} ·{' '}
                      {department.count}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">排序方式</span>
                <select
                  value={route.sort}
                  onChange={(event) => {
                    window.location.hash = href({
                      sort: event.target.value as CatalogRoute['sort'],
                      offset: 0,
                    });
                  }}
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
          {route.category !== 'elective' && (
            <div className="program-filters">
              <label>
                培养方案专业
                <select
                  value={route.program}
                  onChange={(event) => {
                    window.location.hash = href({ program: event.target.value, offset: 0 });
                  }}
                >
                  <option value="">全部专业</option>
                  {route.program &&
                    !data?.facets.programs.some((item) => item.name === route.program) && (
                      <option>{route.program}</option>
                    )}
                  {data?.facets.programs.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {route.program && (
                <label>
                  方案版本
                  <select
                    value={route.planYear}
                    onChange={(event) => {
                      window.location.hash = href({ planYear: event.target.value, offset: 0 });
                    }}
                  >
                    <option value="">全部已收录版本</option>
                    {route.planYear &&
                      !data?.facets.programs
                        .find((item) => item.name === route.program)
                        ?.years.includes(Number(route.planYear)) && (
                        <option value={route.planYear}>{route.planYear}版（未收录）</option>
                      )}
                    {data?.facets.programs
                      .find((item) => item.name === route.program)
                      ?.years.map((year) => (
                        <option key={year} value={year}>
                          {year}版
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {route.program && (
                <span className="fine-print">
                  按已收录方案记录筛选，可能含辅修表；不代表当期开课或个人选课资格。
                </span>
              )}
            </div>
          )}
          {filtered && (
            <div className="filter-chips" aria-label="已选筛选条件">
              {route.q && (
                <a href={href({ q: '', offset: 0 })} aria-label="移除搜索条件">
                  搜索：{route.q}
                  <Icon name="close" size={13} />
                </a>
              )}
              {route.category && (
                <a href={href({ category: '', offset: 0 })} aria-label="移除课程类型筛选">
                  {courseCategories[route.category]}
                  <Icon name="close" size={13} />
                </a>
              )}
              {route.department && (
                <a href={href({ department: '', offset: 0 })} aria-label="移除学院筛选">
                  {route.department}
                  <Icon name="close" size={13} />
                </a>
              )}
              {route.electiveType && (
                <a href={href({ electiveType: '', offset: 0 })} aria-label="移除公选课类别筛选">
                  {route.electiveType === 'unknown'
                    ? '类别待核实'
                    : electiveTypes[route.electiveType]}
                  <Icon name="close" size={13} />
                </a>
              )}
              {route.program && (
                <a href={href({ program: '', offset: 0 })} aria-label="移除专业筛选">
                  {route.program}
                  {route.planYear && ` · ${route.planYear}版`}
                  <Icon name="close" size={13} />
                </a>
              )}
              <a className="clear-filters" href={catalogHref(defaultFilters)}>
                清除筛选
              </a>
            </div>
          )}
          {error ? (
            <ErrorState message={error} retry={retry} />
          ) : !data ? (
            <LoadingCards />
          ) : data.courses.length ? (
            <>
              <ul className={`course-list ${view === 'grid' ? 'course-grid' : 'course-rows'}`}>
                {data.courses.map((course) => (
                  <CourseCard key={course.id} course={course} from={catalogHref(route)} />
                ))}
              </ul>
              <div className="catalog-bottom">
                <span>
                  显示 {route.offset + 1}–{route.offset + data.courses.length} / {data.total} 门课程
                </span>
                {(route.offset > 0 || data.hasMore) && (
                  <nav className="pagination" aria-label="课程分页">
                    {route.offset > 0 ? (
                      <a href={href({ offset: Math.max(0, route.offset - pageSize) })}>上一页</a>
                    ) : (
                      <span>上一页</span>
                    )}
                    <span>第 {Math.floor(route.offset / pageSize) + 1} 页</span>
                    {data.hasMore ? (
                      <a href={href({ offset: route.offset + pageSize })}>下一页</a>
                    ) : (
                      <span>下一页</span>
                    )}
                  </nav>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title={
                route.offset
                  ? '这一页已经没有课程了'
                  : filtered
                    ? '没有找到匹配的课程'
                    : '课程目录正在准备中'
              }
              action={
                <a
                  className="secondary-button"
                  href={route.offset ? href({ offset: 0 }) : catalogHref(defaultFilters)}
                >
                  {route.offset ? '回到第一页' : '查看全部课程'}
                </a>
              }
            >
              {filtered
                ? '试试更短的关键词，或移除部分筛选条件。'
                : '已收录且可展示的课程会出现在这里。'}
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
