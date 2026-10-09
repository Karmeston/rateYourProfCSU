import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { Catalog } from './catalog';
import { Detail } from './detail';
import { teacherPagesEnabled } from './features';
import { Guide } from './guide';
import { Icon } from './icons';
import { parseRoute } from './routing';
import { EmptyState, ErrorState } from './ui';
import { useData } from './use-data';

function TeacherCatalog({ q, offset }: { q: string; offset: number }) {
  const { data, error, retry } = useData<{
    teachers: { id: number; name: string; department: string }[];
    hasMore: boolean;
  }>(q ? `/api/teachers?q=${encodeURIComponent(q)}&offset=${offset}` : null);
  return (
    <section className="catalog-intro">
      <h1>教师搜索</h1>
      <form
        className="search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          window.location.hash = `#/teachers?q=${encodeURIComponent(String(new FormData(event.currentTarget).get('q') ?? '').trim())}`;
        }}
      >
        <Icon name="search" />
        <input name="q" aria-label="搜索教师" maxLength={100} type="search" defaultValue={q} />
        <button className="primary-button">搜索</button>
      </form>
      {error ? (
        <ErrorState message={error} retry={retry} />
      ) : data ? (
        <>
          <ul className="teacher-list">
            {data.teachers.map((teacher) => (
              <li key={teacher.id}>
                <a href={`#/teachers/${teacher.id}`}>
                  <h2>{teacher.name}</h2>
                  <p>{teacher.department}</p>
                </a>
              </li>
            ))}
          </ul>
          <nav className="pagination" aria-label="教师分页">
            {offset > 0 && (
              <a href={`#/teachers?q=${encodeURIComponent(q)}&offset=${offset - 20}`}>上一页</a>
            )}
            {data.hasMore && (
              <a href={`#/teachers?q=${encodeURIComponent(q)}&offset=${offset + 20}`}>下一页</a>
            )}
          </nav>
        </>
      ) : q ? (
        <p role="status">正在加载…</p>
      ) : (
        <p>输入姓名，查找教师。</p>
      )}
    </section>
  );
}

function App() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  const main = useRef<HTMLElement>(null);
  const searchRequested = useRef(false);
  const route = parseRoute(hash, teacherPagesEnabled);
  const path = hash.split('?')[0];
  useEffect(() => {
    const changed = () => setHash(window.location.hash || '#/');
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('dialog[open]')
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return;
      event.preventDefault();
      const search = document.getElementById('course-search');
      if (search) search.focus();
      else {
        searchRequested.current = true;
        window.location.hash = '#/courses';
      }
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('keydown', shortcut);
    };
  }, []);
  useEffect(() => {
    main.current?.focus();
    window.scrollTo(0, 0);
    if (searchRequested.current) {
      document.getElementById('course-search')?.focus();
      searchRequested.current = false;
    }
  }, [path]);
  useEffect(() => {
    if (route.page !== 'detail')
      document.title = `${route.page === 'guide' ? '使用指南' : '课程广场'} · rateMyProfCSU`;
  }, [route.page]);
  const active =
    route.page === 'detail' ? (route.kind === 'teachers' ? 'teachers' : 'catalog') : route.page;
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#/" aria-label="rateMyProfCSU 首页">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              rateMyProf<span className="brand-csu">CSU</span>
              <small>中南大学课程评价</small>
            </span>
          </a>
          <nav className="primary-nav" aria-label="主导航">
            <a href="#/" aria-current={active === 'catalog' ? 'page' : undefined}>
              课程广场
            </a>
            <a href="#/guide" aria-current={active === 'guide' ? 'page' : undefined}>
              使用指南
            </a>
            {teacherPagesEnabled && (
              <a href="#/teachers" aria-current={active === 'teachers' ? 'page' : undefined}>
                教师
              </a>
            )}
          </nav>
        </div>
      </header>
      <main id="main-content" ref={main} tabIndex={-1}>
        {route.page === 'catalog' ? (
          <Catalog route={route} />
        ) : route.page === 'detail' ? (
          <Detail
            key={`${route.kind}/${route.id}`}
            kind={route.kind}
            id={route.id}
            from={route.from}
          />
        ) : route.page === 'guide' ? (
          <Guide />
        ) : route.page === 'teachers' ? (
          <TeacherCatalog q={route.q} offset={route.offset} />
        ) : (
          <EmptyState
            title="这个页面暂时找不到"
            action={
              <a className="primary-button" href="#/">
                返回课程广场
              </a>
            }
          >
            链接可能有误，回到课程广场继续探索。
          </EmptyState>
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
