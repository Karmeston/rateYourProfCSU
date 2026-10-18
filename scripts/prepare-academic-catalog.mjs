import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const intake = 'data/course-data/pending/academic-20261018/';
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
export const normalizeName = (value) => value.normalize('NFKC').replace(/\s+/g, '');
export const excludedCourse = (name) =>
  /形势与政策|改革开放史|毛泽东|思想道德|习近平|马克思主义基本原理|中国近现代史纲要|中国共产党的历史|新中国史|社会主义发展史/.test(
    name,
  );
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const departmentName = (value) =>
  value
    ?.normalize('NFKC')
    .replace(/\(教学\)$/, '')
    .trim();
const identity = (row) => JSON.stringify([row.code, normalizeName(row.name)]);

export function prepareAcademicCatalog({ syllabus, curriculum, execution, evidence }) {
  const sources = {};
  function source(document, name, kind) {
    const hash = digest(document);
    const fetched = new Date(document.source.fetchedAt);
    if (!Number.isFinite(fetched.valueOf())) throw new Error('采集时间无效');
    sources[hash] = {
      kind,
      file: intake + name,
      sha256: hash,
      date: new Date(fetched.valueOf() + 8 * 3600000).toISOString().slice(0, 10),
      url: document.source.listUrl ?? document.source.url,
      label:
        kind === 'syllabus'
          ? '教务系统课程目录'
          : kind === 'curriculum'
            ? '统计学培养方案（版本未标注）'
            : '统计学执行计划',
    };
    return hash;
  }
  const syllabusSource = source(syllabus, 'academic-syllabus-catalog-20261018.json', 'syllabus');
  const curriculumSource = source(
    curriculum,
    'academic-own-plan-courses-20261018.json',
    'curriculum',
  );
  const executionSource = source(execution, 'academic-execution-plan-20261018.json', 'execution');
  if (curriculum.planName !== '统计学专业本科培养方案') throw new Error('培养方案专业未核对');
  const classifications = new Map();
  const addEvidence = (row, category, proof) => {
    const key = identity(row);
    classifications.set(key, [...(classifications.get(key) ?? []), { category, ...proof }]);
  };
  for (const row of evidence) {
    if (!row.code || row.needs_review?.length) continue;
    const category =
      row.source_kind === 'major_syllabus' && /学科|专业/.test(row.course_category_raw ?? '')
        ? 'major'
        : row.source_kind === 'public_elective_syllabus' &&
            /全校性选修/.test(row.course_category_raw ?? '')
          ? 'elective'
          : null;
    if (category)
      addEvidence(row, category, { source: row.source_id, raw: row.course_category_raw });
  }
  for (const row of curriculum.courses) {
    if (/^(学科|专业)教育课程/.test(row.category))
      addEvidence(row, 'major', { source: curriculumSource, raw: row.category });
  }
  const grouped = new Map();
  const add = (row, record) =>
    grouped.set(row.code, [...(grouped.get(row.code) ?? []), { row, record }]);
  for (const row of syllabus.records)
    add(row, {
      source: syllabusSource,
      sequence: row.sequence,
      page: row.page,
      department: departmentName(row.department),
      kind: row.category,
      credits: row.credits,
      hours: row.totalHours,
      program: null,
      year: null,
      requirement: null,
    });
  curriculum.courses.forEach((row, index) =>
    add(row, {
      source: curriculumSource,
      sequence: index + 1,
      page: null,
      department: null,
      kind: null,
      credits: row.credits,
      hours: row.totalHours,
      program: '统计学',
      year: null,
      requirement: row.attribute,
    }),
  );
  for (const row of execution.courses)
    add(row, {
      source: executionSource,
      sequence: row.sequence,
      page: null,
      department: null,
      kind: null,
      credits: row.credits,
      hours: row.totalHours,
      program: null,
      year: null,
      requirement: row.attribute,
    });
  const courses = [],
    held = [],
    categoryConflicts = [];
  for (const [code, entries] of grouped) {
    const names = [...new Set(entries.map(({ row }) => normalizeName(row.name)))];
    const name = entries[0].row.name.trim();
    let reason = null;
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(code)) reason = 'invalid_code';
    else if (names.length !== 1) reason = 'code_name_conflict';
    else if (excludedCourse(name)) reason = 'excluded_course';
    else if (!name || name.length > 200) reason = 'invalid_name';
    if (reason) {
      held.push({ code, reason, names: [...new Set(entries.map(({ row }) => row.name))] });
      continue;
    }
    const proofs = classifications.get(identity(entries[0].row)) ?? [];
    const categories = new Set(proofs.map((proof) => proof.category));
    if (categories.size > 1) categoryConflicts.push({ code, name, evidence: proofs });
    const departments = [
      ...new Set(entries.map(({ record }) => record.department).filter(Boolean)),
    ];
    if (departments.length > 1) {
      held.push({ code, reason: 'department_conflict', names: [name] });
      continue;
    }
    courses.push({
      code,
      name,
      department: departments[0] ?? '待核实',
      category: categories.size === 1 ? [...categories][0] : null,
      classification: categories.size === 1 ? proofs : [],
      records: entries.map(({ record }) => record),
    });
  }
  courses.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    catalog: { schemaVersion: 1, sources, courses },
    report: {
      inputRows: syllabus.records.length + curriculum.courses.length + execution.courses.length,
      courses: courses.length,
      categories: Object.fromEntries(
        [null, 'major', 'elective'].map((key) => [
          key ?? 'unknown',
          courses.filter((c) => c.category === key).length,
        ]),
      ),
      held,
      categoryConflicts,
      note: '采集日期不是课程版本；目录和执行计划不证明当前开课。未标明年份的统计学方案不套用其他版本。',
    },
  };
}

export function latestAcademicPlans(plans) {
  const groups = new Map();
  for (const plan of plans) {
    // The exported category says 主修 even for explicitly named minor plans.
    const role = /辅修.*(?:学位|学士)/.test(plan.name)
      ? '辅修学位'
      : /辅修/.test(plan.name)
        ? '辅修专业'
        : '主修';
    const tracks = [
      ...new Set(
        (plan.major + plan.name).match(/强基|卓越|拔尖|国际|中外|高水平|留学生|微专业/g) ?? [],
      ),
    ].sort();
    const key = JSON.stringify([plan.college, plan.majorCode, role, tracks]);
    const current = groups.get(key) ?? [];
    if (!current.length || Number(plan.year) > Number(current[0].year))
      groups.set(key, [{ ...plan, role, tracks }]);
    else if (Number(plan.year) === Number(current[0].year)) current.push({ ...plan, role, tracks });
  }
  return [...groups.values()].flat();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { catalog, report } = prepareAcademicCatalog({
    syllabus: read(intake + 'academic-syllabus-catalog-20261018.json'),
    curriculum: read(intake + 'academic-own-plan-courses-20261018.json'),
    execution: read(intake + 'academic-execution-plan-20261018.json'),
    evidence: read('data/course-data/course-records.json'),
  });
  const latest = latestAcademicPlans(read(intake + 'academic-plan-index-20261018.json').plans);
  const outputs = {
    'academic-catalog.json': catalog,
    'academic-catalog-report.json': report,
    'academic-latest-plans.json': {
      scope: '仅方案索引，未取得的课程明细不生成关联；同年并列方案不擅自合并。',
      plans: latest,
    },
  };
  for (const [name, data] of Object.entries(outputs))
    writeFileSync(new URL('data/course-data/' + name, root), JSON.stringify(data, null, 2) + '\n');
  console.log(
    JSON.stringify({
      ...report,
      held: report.held.length,
      categoryConflicts: report.categoryConflicts.length,
      latestPlans: latest.length,
    }),
  );
}
