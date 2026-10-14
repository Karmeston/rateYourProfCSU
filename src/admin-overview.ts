import type { AdminOverview } from '../shared/admin.ts';
import { trafficDay } from './traffic.ts';

export async function overview(
  db: D1Database,
  days: number,
  now = Date.now(),
): Promise<AdminOverview> {
  const today = trafficDay(now),
    start = trafficDay(now, days - 1);
  const [daily, pages, popular, first, content] = await db.batch([
    db
      .prepare(
        'SELECT day,sum(views) AS views FROM traffic_daily WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      )
      .bind(start, today),
    db
      .prepare(
        'SELECT page,sum(views) AS views FROM traffic_daily WHERE day BETWEEN ? AND ? GROUP BY page ORDER BY views DESC,page',
      )
      .bind(start, today),
    db
      .prepare(
        `SELECT c.id,c.name,sum(t.views) AS views FROM traffic_daily t JOIN courses c ON c.id=t.target_id
      WHERE t.day BETWEEN ? AND ? AND t.page='course' AND c.is_listed=1 GROUP BY c.id,c.name ORDER BY views DESC,c.id LIMIT 10`,
      )
      .bind(start, today),
    db.prepare('SELECT min(day) AS day FROM traffic_daily'),
    db.prepare(`SELECT (SELECT count(*) FROM courses WHERE is_listed=1) AS courses,
      (SELECT count(*) FROM course_reviews r JOIN courses c ON c.id=r.course_id WHERE c.is_listed=1 AND r.status='published' AND r.withdrawn_at IS NULL)
      +(SELECT count(*) FROM teacher_reviews WHERE status='published' AND withdrawn_at IS NULL) AS reviews,
      (SELECT count(*) FROM course_reviews r JOIN courses c ON c.id=r.course_id WHERE c.is_listed=1 AND r.status='pending' AND r.withdrawn_at IS NULL)
      +(SELECT count(*) FROM teacher_reviews WHERE status='pending' AND withdrawn_at IS NULL) AS pendingReviews,
      (SELECT count(*) FROM course_supplements s JOIN courses c ON c.id=s.course_id WHERE c.is_listed=1 AND s.status='pending' AND s.withdrawn_at IS NULL) AS pendingSupplements,
      (SELECT count(*) FROM content_reports WHERE status='open') AS openReports`),
  ]);
  const byDay = new Map(
    (daily.results as { day: string; views: number }[]).map((row) => [row.day, row.views]),
  );
  const series = Array.from({ length: days }, (_, i) => {
    const day = trafficDay(now, days - 1 - i);
    return { day, views: byDay.get(day) ?? 0 };
  });
  return {
    days,
    today,
    views: series.reduce((sum, row) => sum + row.views, 0),
    todayViews: byDay.get(today) ?? 0,
    firstDay: (first.results[0] as { day: string | null }).day,
    daily: series,
    pages: pages.results as AdminOverview['pages'],
    popularCourses: popular.results as AdminOverview['popularCourses'],
    content: content.results[0] as AdminOverview['content'],
  };
}
