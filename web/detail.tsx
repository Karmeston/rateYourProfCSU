import { useEffect, useState } from 'react';
import { courseCategories, type CourseDetail, type Teacher } from '../shared/catalog';
import { ElectiveGuidance } from './elective-guidance';
import { CourseMaterials } from './course-materials';
import { Icon } from './icons';
import { Reviews } from './reviews';
import { ErrorState } from './ui';
import { useData } from './use-data';

function profileLink(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function Detail({
  kind,
  id,
  from,
}: {
  kind: 'courses' | 'teachers';
  id: string;
  from: string;
}) {
  const { data, error, retry } = useData<{ course?: CourseDetail; teacher?: Teacher }>(
    `/api/${kind}/${id}`,
  );
  const row = kind === 'courses' ? data?.course : data?.teacher;
  const course = data?.course;
  const profile = profileLink(data?.teacher?.profile_url);
  const [shareMessage, setShareMessage] = useState('');
  const [copyUrl, setCopyUrl] = useState('');
  useEffect(() => {
    if (row) document.title = `${row.name} · rateMyProfCSU`;
  }, [row]);
  useEffect(() => {
    if (!shareMessage) return;
    const timer = window.setTimeout(() => setShareMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [shareMessage]);
  async function share() {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#/${kind}/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage('链接已复制');
      setCopyUrl('');
    } catch {
      setCopyUrl(url);
    }
  }
  return (
    <div className="detail-page">
      <a className="back-link" href={from}>
        <span className="back-arrow">
          <Icon name="arrow" size={17} />
        </span>{' '}
        返回
        {kind === 'teachers' ? '教师搜索' : '课程列表'}
      </a>
      {!row ? (
        error ? (
          <ErrorState message={error} retry={retry} />
        ) : (
          <div className="detail-loading" role="status">
            正在加载课程资料…
          </div>
        )
      ) : (
        <>
          <section className="detail-heading">
            <div>
              <div className="detail-labels">
                <span className={`category-badge ${course?.category ?? 'unknown'}`}>
                  <i />
                  {course?.category
                    ? courseCategories[course.category]
                    : kind === 'teachers'
                      ? '教师主页'
                      : '课程'}
                </span>
                {row.id < 0 && <span className="demo-badge">虚构演示数据</span>}
              </div>
              <h1>{row.name}</h1>
              <div className="detail-meta">
                <span>
                  <Icon name="book" size={17} />
                  {row.department === '待核实' ? '开课学院待补充' : row.department}
                  {course?.departmentSourceYear != null && ` · ${course.departmentSourceYear}大纲学院`}
                </span>
                {course?.code && <span>课程代码 · {course.code}</span>}
                {profile && (
                  <a href={profile} target="_blank" rel="noopener noreferrer">
                    官网主页 ↗
                  </a>
                )}
              </div>
            </div>
            <div className="detail-actions">
              <button className="secondary-button" onClick={() => void share()}>
                <Icon name="share" size={17} />
                分享{course ? '课程' : '主页'}
              </button>
              <span className="share-message" role="status">
                {shareMessage}
              </span>
            </div>
          </section>
          {copyUrl && (
            <div className="share-fallback">
              <label>
                复制此链接分享
                <input
                  aria-label="课程分享链接"
                  readOnly
                  value={copyUrl}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                className="icon-button"
                aria-label="关闭分享链接"
                onClick={() => setCopyUrl('')}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {course?.category === 'elective' && <ElectiveGuidance course={course} />}
          {course && course.category !== 'elective' && course.materials.length > 0 && <CourseMaterials course={course} />}
          {course && course.category !== 'elective' && course.materials.length === 0 && (
            <details className="course-info">
              <summary>
                课程资料 <span className="fine-print">待补充</span>
              </summary>
              <dl className="course-facts">
                {['课程学分', '适用专业', '考核方式', '课程大纲'].map((label) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className="pending">待补充</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <Reviews kind={kind} id={id} name={row.name} />
        </>
      )}
    </div>
  );
}
