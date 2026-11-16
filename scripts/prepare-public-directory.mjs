import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { academicPlanLabel, normalizeName } from './prepare-academic-catalog.mjs';

const withoutCollege = '归属未标注';
const normalizeCollege = (name) => name.trim().replace(/\(([^()]*)\)/g, '（$1）');
const identity = (code, name) => JSON.stringify([code, normalizeName(name)]);

export function readPublicDirectory(db, { plans = [], official = [] } = {}) {
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
  const ownerRows = new Map();
  function addOwner(program, year, college, ids) {
    if (!college?.trim() || !programs.get(program)?.has(year)) return;
    const key = JSON.stringify([program, year]);
    const owners = ownerRows.get(key) ?? new Map();
    college = normalizeCollege(college);
    const membership = owners.get(college) ?? new Set();
    for (const id of ids) membership.add(id);
    owners.set(college, membership);
    ownerRows.set(key, owners);
  }
  const idsByIdentity = new Map(courses.filter((row) => row.code)
    .map((row) => [identity(row.code, row.name), row.id]));
  for (const plan of plans) {
    if (!plan.courses.length) continue;
    const ids = plan.courses.flatMap((row) => {
      const id = idsByIdentity.get(identity(row.code, row.name));
      return id === undefined ? [] : [id];
    });
    addOwner(academicPlanLabel(plan), Number(plan.year), plan.college, ids);
  }
  // Older published plans explicitly carry their own college. Course teaching units are never used.
  for (const { program, year, college, id } of db.prepare(`SELECT p.program, p.source_year AS year,
    p.department AS college, p.course_id AS id FROM course_materials p JOIN courses c ON c.id=p.course_id
    WHERE p.kind='curriculum' AND p.program IS NOT NULL AND c.is_listed=1`).all()) {
    addOwner(program, year, college, [id]);
  }
  const officialOwners = new Map();
  for (const { name, department } of official) {
    const key = normalizeName(name);
    const owners = officialOwners.get(key) ?? new Set();
    owners.add(normalizeCollege(department));
    officialOwners.set(key, owners);
  }
  const colleges = new Map();
  for (const [program, years] of programs) {
    for (const [year, ids] of years) {
      const owners = ownerRows.get(JSON.stringify([program, year]));
      const officialMatches = officialOwners.get(normalizeName(program));
      const fallback = officialMatches?.size === 1 ? [...officialMatches][0] : withoutCollege;
      const entries = owners?.size ? [...owners] : [[fallback, new Set()]];
      for (const [college, knownIds] of entries) {
        const overrides = entries.length > 1 ? ids.filter((id) => knownIds.has(id)) : null;
        if (overrides?.length === 0) continue;
        const group = colleges.get(college) ?? new Map();
        const versions = group.get(program) ?? [];
        versions.push(overrides ? [year, overrides] : [year]);
        group.set(program, versions);
        colleges.set(college, group);
      }
    }
  }
  return {
    version: 2,
    departments,
    courses: courses.map(({ id, name, code, department, category, electiveType }) =>
      [id, name, code, departmentIndices.get(department), category, electiveType]),
    programs: [...programs].map(([program, years]) => [program, [...years]]),
    colleges: [...colleges].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
      .map(([college, members]) => [college, [...members]]),
  };
}

function serializeDirectory({ version, departments, courses, programs, colleges }) {
  // Keep each row compact while letting Git show additions and edits individually.
  const lines = (rows) => rows.map((row) => JSON.stringify(row)).join(',\n');
  return `{"version":${version},"departments":${JSON.stringify(departments)},"courses":[\n${lines(courses)}\n],"programs":[\n${lines(programs)}\n],"colleges":[\n${lines(colleges)}\n]}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--snapshot')
    throw new Error('用法：node scripts/prepare-public-directory.mjs --snapshot <核验过的 D1 导出 SQL>');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(process.argv[3], 'utf8'));
    const read = (path) => JSON.parse(readFileSync(new URL('../data/course-data/' + path, import.meta.url), 'utf8'));
    const directory = readPublicDirectory(db, {
      plans: read('pending/academic-20261107/plan-courses-20261107.json').plans,
      official: read('official-programs-2026.json').programs,
    });
    if (!directory.courses.length || !directory.programs.length) throw new Error('课程或方案为空');
    writeFileSync(new URL('../data/course-data/public-directory.json', import.meta.url),
      serializeDirectory(directory));
    console.log(`课程 ${directory.courses.length}，专业与班型 ${directory.programs.length}`);
  } finally {
    db.close();
  }
}
