import { useEffect, useState } from 'react';
import { courseCategories, type CoursePage } from '../shared/catalog';
import { ElectiveGuidance } from './elective-guidance';
import { Icon } from './icons';
import { Reviews } from './reviews';
import { ErrorState } from './ui';
import { useData } from './use-data';
import { CourseSupplements } from './course-supplements';

export function Detail({ id, from }: { id: string; from: string }) {
  const { data, error, retry } = useData<{ course: CoursePage }>(
    `/api/courses/${id}?view=page`,
  );
  const course = data?.course;
  const [shareMessage, setShareMessage] = useState('');
  const [copyUrl, setCopyUrl] = useState('');
  useEffect(() => {
    if (course && String(course.id) !== id)
      window.location.replace(`#/courses/${course.id}?from=${encodeURIComponent(from)}`);
  }, [course, id, from]);
  useEffect(() => {
    if (course) document.title = `${course.name} · rateMyProfCSU`;
  }, [course]);
  useEffect(() => {
    if (!shareMessage) return;
    const timer = window.setTimeout(() => setShareMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [shareMessage]);
  async function share() {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#/courses/${course?.id ?? id}`;
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
        返回课程列表
      </a>
      {!course ? (
        error ? (
          <ErrorState message={error} retry={retry} />
        ) : (
          <div className="detail-loading" role="status">
            正在加载课程…
          </div>
        )
      ) : (
        <>
          <section className="detail-heading">
            <div>
              <div className="detail-labels">
                {course.category && (
                  <span className={`category-badge ${course.category}`}>
                    <i />
                    {courseCategories[course.category]}
                  </span>
                )}
                {course.id < 0 && <span className="demo-badge">虚构演示数据</span>}
              </div>
              <h1>{course.name}</h1>
              <div className="detail-meta">
                {course.department !== '待核实' && (
                  <span>
                    <Icon name="book" size={17} />
                    {course.department}
                  </span>
                )}
                {course.code && <span>课程代码 · {course.code}</span>}
              </div>
            </div>
            <div className="detail-actions">
              <button className="secondary-button" onClick={() => void share()}>
                <Icon name="share" size={17} />
                分享课程
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
          {course.category === 'elective' && <ElectiveGuidance course={course} />}
          <CourseSupplements id={String(course.id)} />
          <Reviews id={String(course.id)} name={course.name} />
        </>
      )}
    </div>
  );
}
