import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLocalD1 } from './lib/local-d1.mjs';

export const majorCatalog = JSON.parse(readFileSync(new URL('../data/course-data/major-catalog.json', import.meta.url), 'utf8'));
const compact = (value) => value.replace(/\s+/g, '');
const text = (value, max = 200) => typeof value === 'string' && value.trim() && value.length <= max && !value.includes('\0');
function officialUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && (url.hostname === 'csu.edu.cn' || url.hostname.endsWith('.csu.edu.cn'));
}

function checkedRecords(catalog) {
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.courses) || !catalog.sources)
    throw new Error('专业课目录格式无效');
  const codes = new Set();
  return catalog.courses.map((course) => {
    if (!/^\d{6}[A-Z]\d{2}$/.test(course.code) || codes.has(course.code)
      || !text(course.name) || !text(course.department, 100) || !Array.isArray(course.materials)
      || /形势与政策|改革开放史|毛泽东|思想道德|习近平|马克思主义基本原理|中国近现代史纲要/.test(course.name))
      throw new Error('课程代码、名称、学院无效，或属于排除课程');
    codes.add(course.code);
    let syllabus = false, plan = false;
    const materials = course.materials.map((record) => {
      const source = catalog.sources[record.source_id];
      if (!source || !text(record.name) || compact(record.name) !== compact(course.name)
        || !text(record.locator) || !text(source.label) || !text(source.department, 100)
        || !Number.isInteger(source.year) || source.year < 2000 || source.year > 2100
        || !/^[a-f0-9]{64}$/.test(source.sha256) || !officialUrl(source.url) || !officialUrl(source.file_url)
        || (record.program !== null && !text(record.program))
        || (record.credits !== null && (!Number.isFinite(record.credits) || record.credits < 0 || record.credits > 40))
        || ![null, '必修', '选修'].includes(record.requirement))
        throw new Error(`课程 ${course.code} 来源、版本或原表资料无效`);
      if (source.kind === 'major_syllabus') {
        if (source.department !== course.department || !/学科|专业/.test(record.category_raw ?? ''))
          throw new Error('大纲没有明确的学科或专业课程分类');
        syllabus = true;
      } else if (source.kind === 'undergraduate_plan') {
        if (!record.program || (source.year < 2023 && !(source.department === '计算机学院' && source.year >= 2018)))
          throw new Error('方案不属于已核对的收录范围');
        plan = true;
      } else throw new Error('来源类型无效');
      const identity = JSON.stringify([course.code, record.source_id, record.program, record.credits, record.requirement]);
      return {
        id: createHash('sha256').update(identity).digest('hex'),
        values: [record.source_id, source.kind === 'major_syllabus' ? 'syllabus' : 'curriculum', source.year,
          source.department, record.program, record.credits, record.requirement,
          source.url, source.label, record.locator],
      };
    });
    if (!syllabus || !plan) throw new Error(`课程 ${course.code} 缺少大纲与培养方案的交叉依据`);
    return { ...course, materials };
  });
}

// Local maintenance only: validate every record before one atomic batch, preserving
// existing IDs, reviews, departments and visibility. Uncoded names need manual identity review.
export async function importMajorCatalog(db, source = majorCatalog) {
  const records = checkedRecords(source);
  const [existing, documents] = await db.batch([
    db.prepare('SELECT id, code, name, department, category, is_listed FROM courses'),
    db.prepare('SELECT * FROM course_materials'),
  ]);
  const byCode = new Map(existing.results.filter((row) => row.code).map((row) => [row.code, row]));
  const byDocument = new Map(documents.results.map((row) => [row.id, row]));
  const skipped = [], courses = [], materials = [];
  let nextId = existing.results.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1;
  for (const record of records) {
    const current = byCode.get(record.code);
    if (current && (current.id <= 0 || compact(current.name) !== compact(record.name) || current.category !== 'major'))
      throw new Error(`课程代码 ${record.code} 已被不同资料占用，请人工核对`);
    if (!current && existing.results.some((row) => row.id > 0 && row.code === null && compact(row.name) === compact(record.name))) {
      skipped.push({ code: record.code, name: record.name, reason: '同名无代码记录需核对身份' });
      continue;
    }
    const id = current?.id ?? nextId++;
    if (!current) courses.push([id, record.code, record.name, record.department]);
    for (const document of record.materials) {
      const stored = byDocument.get(document.id);
      if (stored) {
        const columns = ['source_id', 'kind', 'source_year', 'department', 'program', 'credits', 'requirement', 'source_url', 'source_label', 'source_locator'];
        if (stored.course_id !== id || columns.some((column, index) => stored[column] !== document.values[index]))
          throw new Error(`课程 ${record.code} 既有来源资料存在冲突`);
      } else materials.push([document.id, id, ...document.values]);
    }
  }
  const statements = [];
  for (const [rows, columns, table] of [
    [courses, ['id', 'code', 'name', 'department'], 'courses'],
    [materials, ['id', 'course_id', 'source_id', 'kind', 'source_year', 'department', 'program', 'credits', 'requirement', 'source_url', 'source_label', 'source_locator'], 'course_materials'],
  ]) {
    const size = Math.floor(96 / columns.length);
    for (let offset = 0; offset < rows.length; offset += size) {
      const batch = rows.slice(offset, offset + size);
      const fields = table === 'courses' ? [...columns, 'category'] : columns;
      const values = batch.map(() => `(${columns.map(() => '?').join(', ')}${table === 'courses' ? ", 'major'" : ''})`);
      statements.push(db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES ${values.join(', ')}`).bind(...batch.flat()));
    }
  }
  if (statements.length) await db.batch(statements);
  return { courses: records.length, insertedCourses: courses.length, insertedMaterials: materials.length, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await withLocalD1(process.argv.slice(2), (db) => importMajorCatalog(db))));
}
