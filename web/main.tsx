import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Course = { id: number; code: string | null; name: string; department: string };
type Offering = { id: number; teacher_id: number; teacher_name: string; teacher_department: string; term_id: number; start_year: number; semester: number };
type Page = { limit: number; offset: number; hasMore: boolean };
type Courses = Page & { courses: Course[] };
type Details = Page & { course: Course; offerings: Offering[] };
const pageSize = 20;

// 页面切换时取消旧请求，避免慢请求把新页面的数据覆盖。
function useData<T>(url: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    setState({});
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? '没有找到这门课程。' : '暂时无法加载，请稍后重试。');
        const data = await response.json() as T;
        if (!controller.signal.aborted) setState({ data });
      } catch (error) {
        if (timedOut) setState({ error: '连接超时，请重试。' });
        else if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : '网络连接失败，请重试。' });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [url, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

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

function Catalog({ offset }: { offset: number }) {
  const { data, error, retry } = useData<Courses>(`/api/courses?limit=${pageSize}&offset=${offset}`);
  return <>
    <div className="page-heading"><h1>课程</h1></div>
    {!data ? <Notice error={error} retry={retry} /> : <>
      {data.courses.length ? <ul className="course-list">{data.courses.map((course) => <li key={course.id}>
        <a className="course-link" href={`#/courses/${course.id}`}>
          <div><p className="metadata">{course.department}</p><h2>{course.name}</h2>
            <p className="metadata">课程代码：{course.code ?? '暂无'}</p>{course.id < 0 && <Demo />}</div>
          <span className="link-label" aria-hidden="true">→</span>
        </a>
      </li>)}</ul> : <p className="notice">暂无课程</p>}
      <Pager page={data} href={(value) => `#/?offset=${value}`} />
    </>}
  </>;
}

function CourseDetail({ id, offset }: { id: string; offset: number }) {
  const { data, error, retry } = useData<Details>(`/api/courses/${id}/offerings?limit=${pageSize}&offset=${offset}`);
  useEffect(() => {
    if (data) document.title = `${data.course.name} · 课前了解`;
  }, [data]);
  const groups = new Map<number, Offering[]>();
  for (const row of data?.offerings ?? []) {
    const group = groups.get(row.term_id) ?? [];
    group.push(row);
    groups.set(row.term_id, group);
  }
  return <>
    <a className="back-link" href="#/">← 返回课程列表</a>
    {!data ? <Notice error={error} retry={retry} /> : <>
      <div className="page-heading"><p className="eyebrow">{data.course.department}</p>
        <h1>{data.course.name}</h1><p>课程代码：{data.course.code ?? '暂无'}</p>
        {data.course.id < 0 && <Demo />}</div>
      <h2>授课教师</h2>
      {!data.offerings.length && <p className="notice">暂无授课记录</p>}
      {[...groups.entries()].map(([termId, rows]) => <section className="term" key={termId} aria-labelledby={`term-${termId}`}>
        <h3 id={`term-${termId}`}>{rows[0].start_year}–{rows[0].start_year + 1} 学年 <span>第{rows[0].semester === 1 ? '一' : '二'}学期</span></h3>
        <ul className="teacher-list">{rows.map((row) => <li key={row.id}>
          <div><h4>{row.teacher_name}</h4><p className="metadata">{row.teacher_department}</p></div>
          <span className="empty-label">暂无教学体验</span>
        </li>)}</ul>
      </section>)}
      <Pager page={data} href={(value) => `#/courses/${id}?offset=${value}`} />
    </>}
  </>;
}

function App() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  useEffect(() => {
    document.title = '课程浏览 · 课前了解';
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [hash]);
  const [path, query = ''] = hash.slice(1).split('?');
  const match = /^\/courses\/(-?[1-9]\d*)$/.exec(path);
  const value = new URLSearchParams(query).get('offset') ?? '0';
  const offset = Number(value);
  const valid = /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(offset) && offset <= 100000;
  return <>
    <header><div className="header-inner"><a className="brand" href="#/">课前了解</a></div></header>
    <main ref={main} tabIndex={-1} key={hash}>
      {!valid || (path !== '/' && !match) ? <div className="notice"><h1>页面不存在</h1><a href="#/">返回课程列表</a></div>
        : match ? <CourseDetail id={match[1]} offset={offset} /> : <Catalog offset={offset} />}
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
