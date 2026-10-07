import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { useData } from './use-data';
import { Reviews, Stars } from './reviews';
import { teacherPagesEnabled } from './features';

type Course = { id: number; code: string | null; name: string; department: string; category: 'major' | 'elective' | null; average: number | null; reviewCount: number };
type Teacher = { id: number; name: string; department: string; profile_url: string | null };
type Kind = 'teachers' | 'courses';
type Page = { limit: number; offset: number; hasMore: boolean };
type CatalogData = Page & { courses?: Course[]; teachers?: Teacher[] };
type Details = { course?: Course; teacher?: Teacher };
const pageSize = 20;


function Notice({ error, retry }: { error?: string; retry: () => void }) {
  return error
    ? <div className="notice" role="alert"><p>{error}</p><button onClick={retry}>重新加载</button></div>
    : <p className="notice" role="status">正在加载…</p>;
}

function Pager({ page, href }: { page: Page; href: (offset: number) => string }) {
  if (!page.offset && !page.hasMore) return null;
  return <nav className="pagination" aria-label="分页">
    {page.offset > 0 ? <a href={href(Math.max(0, page.offset - pageSize))}>上一页</a> : <span>上一页</span>}
    <span>第 {Math.floor(page.offset / pageSize) + 1} 页</span>
    {page.hasMore ? <a href={href(page.offset + pageSize)}>下一页</a> : <span>下一页</span>}
  </nav>;
}

function Demo() {
  return <span className="badge">虚构演示数据</span>;
}

const labels = { teachers: '教师', courses: '课程' };
const categories = { major: '专业课', elective: '公选课' };

function Catalog({ kind, offset, q, category, home = false }: { kind: Kind; offset: number; q: string; category: string; home?: boolean }) {
  const filter = kind === 'courses' && category ? `&category=${category}` : '';
  const showResults = kind === 'courses' || q.trim().length > 0;
  const { data, error, retry } = useData<CatalogData>(showResults ? `/api/${kind}?limit=${pageSize}&offset=${offset}&q=${encodeURIComponent(q.trim())}${filter}` : null);
  const rows = data?.[kind] ?? [];
  return <div className={home ? 'course-home' : !showResults ? 'search-home' : undefined}>
    <section className={home ? 'search-home course-home-search' : undefined} aria-label={home ? '课程搜索' : undefined}>
    {!home && <div className="page-heading"><h1>{!showResults ? 'rateMyProfCSU' : labels[kind]}</h1></div>}
    {kind === 'courses' && !home && <nav className="category-filter" aria-label="课程类型">{[['', '全部'], ...Object.entries(categories)].map(([value, label]) =>
      <a key={value} href={`#/courses?q=${encodeURIComponent(q)}${value ? `&category=${value}` : ''}`} aria-current={category === value ? 'page' : undefined}>{label}</a>
    )}</nav>}
    <form className="search" role="search" onSubmit={(event) => {
      event.preventDefault();
      const query = String(new FormData(event.currentTarget).get('q') ?? '').trim();
      window.location.hash = `#/${kind}?q=${encodeURIComponent(query)}${filter}`;
    }}>
      <input name="q" type="search" maxLength={100} defaultValue={q} aria-label={`搜索${labels[kind]}`} placeholder={`搜索${labels[kind]}`} />
      <button type="submit">搜索</button>
    </form>
    {home && <nav className="category-filter" aria-label="课程类型"><a href="#/courses?offset=0">全部课程</a><a href="#/courses?category=major">专业课</a><a href="#/courses?category=elective">公选课</a></nav>}
    </section>
    {showResults && (!data ? <Notice error={error} retry={retry} /> : <>
      {rows.length ? <ul className={home ? 'course-list course-grid' : 'course-list'}>{rows.map((row) => <li key={row.id}>
        <a className="course-link" href={`#/${kind}/${row.id}`}>
          <div><h2>{row.name}</h2>{'category' in row && row.category && <p className="metadata">{categories[row.category]}</p>}<p className="metadata">{row.department === '待核实' ? '开课学院待核实' : row.department}</p>{row.id < 0 && <Demo />}</div>
          {'average' in row ? <div className="catalog-rating" aria-label={row.average === null ? '暂无评分' : `${row.average.toFixed(1)} 分，${row.reviewCount} 条评价`}>
            {row.average === null ? <span className="metadata">暂无评分</span> : <><strong>{row.average.toFixed(1)}</strong><Stars rating={row.average} /><span className="metadata">{row.reviewCount} 条评价</span></>}
          </div> : <span className="link-label" aria-hidden="true">→</span>}
        </a>
      </li>)}</ul> : <p className="notice">{q ? '没有找到匹配结果' : `暂无${labels[kind]}`}</p>}
      <Pager page={data} href={(value) => home ? `#/?offset=${value}` : `#/${kind}?offset=${value}&q=${encodeURIComponent(q)}${filter}`} />
    </>)}
  </div>;
}

function Home({ offset }: { offset: number }) {
  return <Catalog kind="courses" offset={offset} q="" category="" home />;
}

// 仅允许 HTTPS 链接，避免把资料字段变成可执行 URL。
function profileLink(value: string | null | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

function Detail({ kind, id }: { kind: Kind; id: string }) {
  const { data, error, retry } = useData<Details>(`/api/${kind}/${id}`);
  const row = kind === 'teachers' ? data?.teacher : data?.course;
  const profile = profileLink(data?.teacher?.profile_url);
  useEffect(() => {
    if (row) document.title = `${row.name} · rateMyProfCSU`;
  }, [row]);
  return <>
    <a className="back-link" href={kind === 'teachers' ? '#/teachers' : '#/'}>← {kind === 'teachers' ? '返回教师搜索' : '返回首页'}</a>
    {!row ? <Notice error={error} retry={retry} /> :
      <><div className="page-heading">
        <h1>{row.name}</h1>{row.department !== '待核实' && <p>{row.department}</p>}
        {data?.course?.category && <p>{categories[data.course.category]}</p>}
        {data?.course?.code && <p>课程代码：{data.course.code}</p>}
        {profile && <a href={profile} target="_blank" rel="noopener noreferrer">官网主页 ↗</a>}
        {row.id < 0 && <Demo />}
      </div>{(kind === 'courses' || teacherPagesEnabled) && <Reviews kind={kind} id={id} name={row.name} />}</>}
  </>;
}

function App() {
  const home = teacherPagesEnabled ? '#/teachers' : '#/';
  function visibleHash() {
    const current = window.location.hash;
    if (!current || current === '#/' || current === '#/courses' || current === '#/courses?' || (!teacherPagesEnabled && /^#\/teachers(?:[/?]|$)/.test(current))) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${home}`);
      return home;
    }
    return current;
  }
  const [hash, setHash] = useState(visibleHash);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const onChange = () => setHash(visibleHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const [path, query = ''] = hash.slice(1).split('?');
  const match = /^\/(teachers|courses)(?:\/(-?[1-9]\d*))?$/.exec(path);
  const kind: Kind = match?.[1] === 'teachers' && teacherPagesEnabled ? 'teachers' : 'courses';
  const params = new URLSearchParams(query);
  const value = params.get('offset') ?? '0';
  const offset = Number(value);
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const valid = /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(offset) && offset <= 100000
    && q.length <= 100 && ['', 'major', 'elective'].includes(category) && (!match?.[2] || Number.isSafeInteger(Number(match[2])));
  useEffect(() => {
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [hash]);
  useEffect(() => {
    if (!match?.[2]) document.title = `${labels[kind]} · rateMyProfCSU`;
  }, [hash, kind]);
  return <>
    <header><div className="header-inner">
      <a className="brand" href={home}>rateMyProfCSU</a>
      {teacherPagesEnabled && <nav className="primary-nav" aria-label="浏览分类">
        {teacherPagesEnabled && <a href="#/teachers" aria-current={kind === 'teachers' ? 'page' : undefined}>教师</a>}
        <a href="#/courses" aria-current={kind === 'courses' ? 'page' : undefined}>课程</a>
      </nav>}
    </div></header>
    <main ref={main} tabIndex={-1} key={hash}>
      {!valid || (path !== '/' && !match) ? <div className="notice"><h1>页面不存在</h1><a href={home}>返回列表</a></div>
        : path === '/' ? <Home offset={offset} /> : match?.[2] ? <Detail kind={kind} id={match[2]} /> : <><a className="back-link" href={home}>← 返回首页</a><Catalog kind={kind} offset={offset} q={q} category={category} /></>}
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
