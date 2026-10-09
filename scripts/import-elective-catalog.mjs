import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const electiveCatalog = JSON.parse(readFileSync(new URL('../data/course-data/public-electives-current.json', import.meta.url), 'utf8'));
const sourceLabel = '2026—2027学年第一学期MOOC课程信息';

function checkedRecords(source) {
  if (source.term !== '2026-2027-1' || !Array.isArray(source.courses) || source.courses.length !== 18)
    throw new Error('此导入器只接受已核对的2026秋季18门MOOC名单');
  const codes = new Set();
  return source.courses.map((course) => {
    const required = ['code', 'name', 'offering_department', 'platform', 'origin_university'];
    if (required.some((key) => typeof course[key] !== 'string' || !course[key].trim() || course[key].length > 100)
      || course.code.length > 64 || codes.has(course.code)
      || course.credits !== 2 || course.catalog_category !== 'elective'
      || course.term !== source.term || course.current_term_confirmed !== true
      || !Array.isArray(course.needs_review) || course.needs_review.length
      || !['超星', '智慧树'].includes(course.platform)
      || course.locator?.table !== 1 || !Number.isInteger(course.locator?.row) || course.locator.row < 2)
      throw new Error('课程字段不完整、重复或尚未审核');
    const url = new URL(course.source_url);
    if (url.protocol !== 'https:' || url.hostname !== 'oa.csu.edu.cn'
      || url.searchParams.get('JLNM') !== 'C2A7465AF8944A2D8B8BBD47419A99D1')
      throw new Error('课程来源不属于已核对的当期官方通知');
    codes.add(course.code);
    return { ...course, sourceLabel, sourceLocator: `附件1，表1第${course.locator.row}行` };
  });
}

// Preflight the entire source, then write one atomic D1 batch. Existing data is never overwritten.
export async function importElectiveCatalog(db, source = electiveCatalog) {
  const records = checkedRecords(source);
  const [courses, facts, offerings] = await db.batch([
    db.prepare('SELECT id, code, name, department, category FROM courses'),
    db.prepare('SELECT c.code, f.* FROM elective_course_facts f JOIN courses c ON c.id = f.course_id'),
    db.prepare('SELECT c.code, o.* FROM elective_course_offerings o JOIN courses c ON c.id = o.course_id WHERE start_year = 2026 AND semester = 1'),
  ]);
  for (const record of records) {
    const existing = courses.results.find((row) => row.code === record.code);
    if (existing && (existing.id < 0 || existing.name !== record.name || existing.department !== record.offering_department || existing.category !== 'elective'))
      throw new Error(`课程代码 ${record.code} 已被不同资料占用，请人工核对`);
    const fact = facts.results.find((row) => row.code === record.code);
    const offering = offerings.results.find((row) => row.code === record.code);
    const evidence = { source_url: record.source_url, source_label: record.sourceLabel, source_locator: record.sourceLocator };
    for (const [row, expected] of [
      [fact, { credits: record.credits, ...evidence }],
      [offering, { mode: 'mooc', platform: record.platform, origin_university: record.origin_university, ...evidence }],
    ]) {
      if (row && Object.entries(expected).some(([key, value]) => row[key] !== value))
        throw new Error(`课程 ${record.code} 存在不同的课程资料或开课依据，请人工核对`);
    }
  }
  const statements = records.flatMap((record) => {
    const evidence = [record.source_url, record.sourceLabel, record.sourceLocator];
    return [
      db.prepare(`INSERT INTO courses (id, code, name, department, category)
        VALUES ((SELECT max(0, coalesce(max(id), 0)) + 1 FROM courses), ?, ?, ?, 'elective')
        ON CONFLICT(code) DO NOTHING`).bind(record.code, record.name, record.offering_department),
      db.prepare(`INSERT INTO elective_course_facts (course_id, credits, source_url, source_label, source_locator)
        SELECT id, ?, ?, ?, ? FROM courses WHERE code = ? ON CONFLICT(course_id) DO NOTHING`)
        .bind(record.credits, ...evidence, record.code),
      db.prepare(`INSERT INTO elective_course_offerings (course_id, start_year, semester, mode, platform, origin_university, source_url, source_label, source_locator)
        SELECT id, 2026, 1, 'mooc', ?, ?, ?, ?, ? FROM courses WHERE code = ?
        ON CONFLICT(course_id, start_year, semester) DO NOTHING`)
        .bind(record.platform, record.origin_university, ...evidence, record.code),
    ];
  });
  const result = await db.batch(statements);
  return { courses: records.length, insertedCourses: result.filter((_, index) => index % 3 === 0).reduce((sum, row) => sum + row.meta.changes, 0) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--persist-to') throw new Error('用法：node scripts/import-elective-catalog.mjs --persist-to <项目内本地D1目录>');
  const project = fileURLToPath(new URL('../', import.meta.url));
  const path = resolve(project, args[1]);
  const withinProject = relative(project, path);
  if (!withinProject || withinProject.startsWith('..') || isAbsolute(withinProject)) throw new Error('本地D1目录必须位于本项目内');
  const { getPlatformProxy } = await import('wrangler');
  // Wrangler's --persist-to points to the parent; getPlatformProxy expects the versioned directory.
  const platform = await getPlatformProxy({
    configPath: resolve(project, 'wrangler.jsonc'),
    persist: { path: resolve(path, 'v3') },
    remoteBindings: false,
  });
  try {
    console.log(JSON.stringify(await importElectiveCatalog(platform.env.DB)));
  } finally {
    await platform.dispose();
  }
}
