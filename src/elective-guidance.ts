import type { ElectiveDetails } from '../shared/electives.ts';

export async function readElectiveDetails(db: D1Database, courseId: number): Promise<ElectiveDetails> {
  const evidenceColumns = 'source_url AS sourceUrl, source_label AS sourceLabel, source_locator AS sourceLocator';
  const [facts, offerings, rules] = await db.batch([
    db.prepare(`SELECT elective_type AS electiveType, credits, applicable_programs AS applicablePrograms,
      ${evidenceColumns} FROM elective_course_facts WHERE course_id = ?`).bind(courseId),
    db.prepare(`SELECT start_year AS startYear, semester, mode, platform, origin_university AS originUniversity, ${evidenceColumns}
      FROM elective_course_offerings WHERE course_id = ? ORDER BY start_year DESC, semester DESC`).bind(courseId),
    db.prepare(`SELECT plan_id AS planId, module, outcome, reason, ${evidenceColumns}
      FROM elective_credit_rules WHERE course_id = ? ORDER BY id`).bind(courseId),
  ]);
  return {
    facts: (facts.results[0] as ElectiveDetails['facts']) ?? null,
    offerings: offerings.results as ElectiveDetails['offerings'],
    creditRules: rules.results as ElectiveDetails['creditRules'],
  };
}
