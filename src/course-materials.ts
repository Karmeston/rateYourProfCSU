import type { CourseMaterial } from '../shared/course-materials.ts';

export async function readCourseMaterials(db: D1Database, courseId: number) {
  const { results } = await db.prepare(`SELECT kind, source_year AS sourceYear, department, program,
    credits, requirement, source_url AS sourceUrl, source_label AS sourceLabel, source_locator AS sourceLocator
    FROM course_materials WHERE course_id = ? ORDER BY kind, source_year DESC, program, id`)
    .bind(courseId).all<CourseMaterial>();
  return results;
}
