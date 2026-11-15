import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readPublicDirectory(db) {
  // This allowlist is the complete public export. No user, review, or raw source fields.
  const courses = db.prepare(`SELECT c.id, c.name, c.code, c.department, c.category,
    e.elective_type AS electiveType FROM courses c
    LEFT JOIN elective_course_facts e ON e.course_id=c.id AND c.category='elective'
    WHERE c.is_listed=1 ORDER BY c.id`).all();
  const departments = [...new Set(courses.map((row) => row.department))].sort();
  const departmentIndices = new Map(departments.map((name, index) => [name, index]));
  const planRows = db.prepare(`SELECT p.program, p.source_year AS year, p.course_id AS id
    FROM course_materials p JOIN courses c ON c.id=p.course_id
    WHERE p.kind='curriculum' AND p.program IS NOT NULL AND c.is_listed=1
    UNION
    SELECT p.program, p.source_year AS year, p.course_id AS id
    FROM course_catalog_records p JOIN courses c ON c.id=p.course_id
    WHERE p.program IS NOT NULL AND c.is_listed=1
    ORDER BY program, year DESC, id`).all();
  const programs = new Map();
  for (const { program, year, id } of planRows) {
    if (!programs.has(program)) programs.set(program, new Map());
    const versions = programs.get(program);
    if (!versions.has(year)) versions.set(year, []);
    versions.get(year).push(id);
  }
  return {
    version: 1,
    departments,
    courses: courses.map(({ id, name, code, department, category, electiveType }) =>
      [id, name, code, departmentIndices.get(department), category, electiveType]),
    programs: [...programs].map(([program, years]) => [program, [...years]]),
  };
}

function serializeDirectory({ version, departments, courses, programs }) {
  // Keep each row compact while letting Git show additions and edits individually.
  const lines = (rows) => rows.map((row) => JSON.stringify(row)).join(',\n');
  return `{"version":${version},"departments":${JSON.stringify(departments)},"courses":[\n${lines(courses)}\n],"programs":[\n${lines(programs)}\n]}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--snapshot')
    throw new Error('用法：node scripts/prepare-public-directory.mjs --snapshot <核验过的 D1 导出 SQL>');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(process.argv[3], 'utf8'));
    const directory = readPublicDirectory(db);
    if (!directory.courses.length || !directory.programs.length) throw new Error('课程或方案为空');
    writeFileSync(new URL('../data/course-data/public-directory.json', import.meta.url),
      serializeDirectory(directory));
    console.log(`课程 ${directory.courses.length}，专业与班型 ${directory.programs.length}`);
  } finally {
    db.close();
  }
}
