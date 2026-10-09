import type { TeacherCatalog as TeacherCatalogResponse } from '../shared/catalog';
import { Icon } from './icons';
import { ErrorState } from './ui';
import { useData } from './use-data';

export function TeacherCatalog({ q, offset }: { q: string; offset: number }) {
  const { data, error, retry } = useData<TeacherCatalogResponse>(
    q ? `/api/teachers?q=${encodeURIComponent(q)}&offset=${offset}` : null,
  );
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
