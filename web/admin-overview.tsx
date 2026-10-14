import { useState } from 'react';
import type { AdminOverview } from '../shared/admin';
import { useData } from './use-data';
import { AdminFailure } from './admin-api';

const pageLabels: Record<string, string> = {
  catalog: '课程广场',
  course: '课程详情',
  teacher_catalog: '教师目录',
  teacher: '教师详情',
  guide: '使用指南',
};
export function AdminOverviewPanel({ relogin }: { relogin: () => void }) {
  const [days, setDays] = useState('7');
  const { data, error, status, retry } = useData<AdminOverview>(`/api/admin/overview?days=${days}`);
  const peak = Math.max(1, ...(data?.daily.map((row) => row.views) ?? []));
  return (
    <section>
      <div className="admin-toolbar">
        <h2>流量与内容概况</h2>
        <label>
          统计范围{' '}
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">近7天</option>
            <option value="30">近30天</option>
          </select>
        </label>
        <button onClick={retry}>刷新</button>
      </div>
      {error ? (
        <AdminFailure {...{ error, status, retry, relogin }} />
      ) : !data ? (
        <p role="status">正在加载统计…</p>
      ) : (
        <>
          <dl className="admin-metrics">
            {[
              ['今日浏览量', data.todayViews],
              ['所选期间浏览量', data.views],
              ['待审资料', data.content.pendingSupplements],
              ['待审评价', data.content.pendingReviews],
              ['未处理举报', data.content.openReports],
              ['公开课程', data.content.courses],
              ['公开评价', data.content.reviews],
            ].map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="fine-print">
            按北京时间自然日统计页面浏览量（PV）；
            {data.firstDay
              ? `现存记录始于${data.firstDay}。`
              : '尚无流量记录，统计从本版本上线开始。'}{' '}
            浏览量不代表独立人数，浏览器拦截或网络失败可能漏记。
          </p>
          <div className="admin-columns">
            <section>
              <h3>每日浏览量</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>浏览量</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr key={row.day}>
                      <th scope="row">{row.day}</th>
                      <td>
                        <span
                          className="admin-traffic-bar"
                          style={{
                            width: `${(100 * row.views) / peak}%`,
                          }}
                          aria-hidden="true"
                        />
                        {data.firstDay && row.day >= data.firstDay ? row.views : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h3>热门课程</h3>
              {data.popularCourses.length ? (
                <ol className="admin-ranked">
                  {data.popularCourses.map((row) => (
                    <li key={row.id}>
                      <a href={`#/courses/${row.id}`}>{row.name}</a>
                      <span>{row.views} 次</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="fine-print">所选期间暂无课程详情访问。</p>
              )}
              <h3>页面分布</h3>
              <ul className="admin-ranked">
                {data.pages.map((row) => (
                  <li key={row.page}>
                    <span>{pageLabels[row.page] ?? row.page}</span>
                    <span>{row.views} 次</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
