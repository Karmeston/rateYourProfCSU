import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName, excludedCourse } from './prepare-academic-catalog.mjs';
import { withLocalD1 } from './lib/local-d1.mjs';

export const academicCatalog = JSON.parse(
  readFileSync(new URL('../data/course-data/academic-catalog.json', import.meta.url), 'utf8'),
);
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max && !v.includes('\0');
const recordColumns = [
  'source_sha256',
  'source_sequence',
  'course_id',
  'source_type',
  'source_date',
  'source_url',
  'source_label',
  'source_page',
  'department',
  'course_kind',
  'credits',
  'total_hours',
  'program',
  'source_year',
  'requirement',
];

function checkedCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !catalog.sources || !Array.isArray(catalog.courses))
    throw new Error('教务目录格式无效');
  const codes = new Set(),
    identities = new Set();
  return catalog.courses.map((course) => {
    if (
      !text(course.code, 64) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(course.code) ||
      codes.has(course.code) ||
      !text(course.name, 200) ||
      excludedCourse(course.name) ||
      !text(course.department, 100) ||
      ![null, 'major', 'elective'].includes(course.category) ||
      !Array.isArray(course.records) ||
      !course.records.length
    )
      throw new Error('教务课程身份或分类无效');
    codes.add(course.code);
    if (
      !Array.isArray(course.classification) ||
      (course.category !== null &&
        (!course.classification.length ||
          course.classification.some(
            (proof) =>
              proof.category !== course.category ||
              !text(proof.source, 200) ||
              !(course.category === 'major'
                ? /学科|专业/.test(proof.raw)
                : /全校性选修/.test(proof.raw)),
          )))
    )
      throw new Error('课程缺少明确分类依据');
    const records = course.records.map((record) => {
      const source = catalog.sources[record.source];
      if (
        !source ||
        !/^[a-f0-9]{64}$/.test(source.sha256) ||
        source.sha256 !== record.source ||
        !['syllabus', 'curriculum', 'execution'].includes(source.kind) ||
        !/^20\d{2}-\d{2}-\d{2}$/.test(source.date) ||
        !text(source.label, 200) ||
        !/^http:\/\/csujwc\.its\.csu\.edu\.cn\/jsxsd\/pyfa\/[a-z_]+$/.test(source.url) ||
        !Number.isInteger(record.sequence) ||
        record.sequence < 1 ||
        (record.page !== null && (!Number.isInteger(record.page) || record.page < 1)) ||
        (record.department !== null && !text(record.department, 100)) ||
        (record.kind !== null && !text(record.kind, 100)) ||
        !Number.isFinite(record.credits) ||
        record.credits < 0 ||
        record.credits > 100 ||
        (record.hours !== null &&
          (!Number.isFinite(record.hours) || record.hours < 0 || record.hours > 10000)) ||
        (record.program !== null && (source.kind !== 'curriculum' || !text(record.program, 100))) ||
        (record.year !== null &&
          (!Number.isInteger(record.year) || record.year < 2000 || record.year > 2100)) ||
        ![null, '必修', '选修'].includes(record.requirement)
      )
        throw new Error(`课程 ${course.code} 的教务来源记录无效`);
      const key = JSON.stringify([source.sha256, record.sequence]);
      if (identities.has(key)) throw new Error('来源行重复关联课程');
      identities.add(key);
      return [
        source.sha256,
        record.sequence,
        null,
        source.kind,
        source.date,
        source.url,
        source.label,
        record.page,
        record.department,
        record.kind,
        record.credits,
        record.hours,
        record.program,
        record.year,
        record.requirement,
      ];
    });
    return { ...course, records };
  });
}

export async function importAcademicCatalog(db, source = academicCatalog) {
  const records = checkedCatalog(source);
  const [existing, evidence] = await db.batch([
    db.prepare('SELECT id,code,name,department,category,is_listed FROM courses'),
    db.prepare('SELECT * FROM course_catalog_records'),
  ]);
  const byCode = new Map(existing.results.filter((c) => c.code).map((c) => [c.code, c]));
  const byCase = new Map(
    existing.results.filter((c) => c.code).map((c) => [c.code.toUpperCase(), c.code]),
  );
  const uncoded = new Set(
    existing.results.filter((c) => c.id > 0 && c.code === null).map((c) => normalizeName(c.name)),
  );
  const stored = new Map(
    evidence.results.map((r) => [JSON.stringify([r.source_sha256, r.source_sequence]), r]),
  );
  let nextId = Math.max(0, ...existing.results.map((c) => c.id)) + 1;
  const courses = [],
    documents = [],
    skipped = [];
  for (const course of records) {
    const current = byCode.get(course.code);
    let reason = null;
    if (current && (current.id <= 0 || normalizeName(current.name) !== normalizeName(course.name)))
      reason = 'existing_identity_conflict';
    else if (!current && byCase.has(course.code.toUpperCase())) reason = 'code_case_conflict';
    else if (!current && uncoded.has(normalizeName(course.name)))
      reason = 'uncoded_identity_needs_review';
    if (reason) {
      skipped.push({ code: course.code, name: course.name, reason });
      continue;
    }
    const id = current?.id ?? nextId++;
    if (!current) courses.push([id, course.code, course.name, course.department, course.category]);
    for (const row of course.records) {
      row[2] = id;
      const match = stored.get(JSON.stringify(row.slice(0, 2)));
      if (match) {
        if (recordColumns.some((key, index) => match[key] !== row[index]))
          throw new Error(`课程 ${course.code} 的既有教务记录存在冲突`);
      } else documents.push(row);
    }
    byCase.set(course.code.toUpperCase(), course.code);
  }
  const statements = [];
  for (const [table, columns, rows] of [
    ['courses', ['id', 'code', 'name', 'department', 'category'], courses],
    ['course_catalog_records', recordColumns, documents],
  ]) {
    // One JSON parameter per small batch avoids D1's parameter limit and oversized SQL.
    const size = 50;
    for (let i = 0; i < rows.length; i += size) {
      const batch = rows.slice(i, i + size);
      statements.push(
        db
          .prepare(
            `INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map((_, index) => `json_extract(value, '$[${index}]')`).join(',')} FROM json_each(?)`,
          )
          .bind(JSON.stringify(batch)),
      );
    }
  }
  if (statements.length) await db.batch(statements);
  return {
    courses: records.length,
    insertedCourses: courses.length,
    insertedRecords: documents.length,
    skipped,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(await withLocalD1(process.argv.slice(2), (db) => importAcademicCatalog(db))),
  );
