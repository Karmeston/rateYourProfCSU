// Plan additions and evidence-backed category updates against an offline production export.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importMajorCatalog, majorCatalog } from './import-major-catalog.mjs';
import { importElectiveCatalog, electiveCatalog } from './import-elective-catalog.mjs';
import { importAcademicCatalog, academicCatalog, academicCategoryUpdateSql } from './import-academic-catalog.mjs';

const maxWritesPerBatch = 80_000;
const releaseHeader = '-- Verified catalog additions and category backfills; existing IDs, visibility and reviews are preserved.\n';
const renderSql = (statements) => releaseHeader + statements.map((entry) => entry.sql).join('\n') + '\n';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function splitBatches(statements) {
  const batches = [];
  let entries = [], estimatedWrites = 0;
  const flush = () => {
    if (!entries.length) return;
    const sql = renderSql(entries);
    batches.push({ sql, estimatedWrites, statements: entries.length, sha256: sha256(sql) });
    entries = [];
    estimatedWrites = 0;
  };
  for (const entry of statements) {
    if (entry.estimatedWrites > maxWritesPerBatch) throw new Error('单条语句超出发布写入预算');
    if (estimatedWrites + entry.estimatedWrites > maxWritesPerBatch) flush();
    entries.push(entry);
    estimatedWrites += entry.estimatedWrites;
  }
  flush();
  return batches;
}

export async function prepareCatalogSql(
  database,
  sources = { major: majorCatalog, elective: electiveCatalog, academic: academicCatalog },
) {
  const statements = [];
  const writeCosts = new Map();
  function statement(sql, values = []) {
    return {
      bind: (...parameters) => statement(sql, parameters),
      all: async () => execute(sql, values),
      first: async () => execute(sql, values).results[0] ?? null,
      run: async () => execute(sql, values),
      sql,
      values,
    };
  }
  function execute(sql, values) {
    const query = database.prepare(sql);
    if (query.columns().length) return { results: query.all(...values), meta: { changes: 0 } };
    const categoryUpdate = sql === academicCategoryUpdateSql;
    const table = categoryUpdate ? 'courses' : /^\s*INSERT\s+INTO\s+(courses|course_materials|elective_course_facts|elective_course_offerings|course_catalog_records)\b/i.exec(sql)?.[1].toLowerCase();
    if (!table)
      throw new Error('发行目录只允许新增已核对的课程资料或补齐空白专业课分类');
    const result = query.run(...values);
    // SQLite expands bound values itself, including quotes, Unicode and literal question marks.
    const changes = Number(result.changes);
    if (changes) {
      if (!writeCosts.has(table)) {
        const { n } = database.prepare('SELECT count(*) AS n FROM pragma_index_list(?)').get(table);
        writeCosts.set(table, 1 + n);
      }
      statements.push({ sql: query.expandedSQL + ';', estimatedWrites: changes * writeCosts.get(table) });
    }
    return { results: [], meta: { changes } };
  }
  const db = {
    prepare: statement,
    async batch(queries) {
      database.exec('SAVEPOINT release_batch');
      try {
        const result = queries.map((query) => execute(query.sql, query.values));
        database.exec('RELEASE release_batch');
        return result;
      } catch (error) {
        database.exec('ROLLBACK TO release_batch; RELEASE release_batch');
        throw error;
      }
    },
  };
  database.exec('SAVEPOINT release_catalog');
  try {
    const elective = await importElectiveCatalog(db, sources.elective);
    const major = await importMajorCatalog(db, sources.major);
    const academic = sources.academic ? await importAcademicCatalog(db, sources.academic) : null;
    const counts = database
      .prepare(
        `SELECT count(*) AS total, count(CASE WHEN is_listed=1 THEN 1 END) AS visible,
      count(CASE WHEN is_listed=1 AND category='major' THEN 1 END) AS major,
      count(CASE WHEN is_listed=1 AND category='elective' THEN 1 END) AS elective,
      count(CASE WHEN is_listed=1 AND category IS NULL THEN 1 END) AS unknown FROM courses`,
      )
      .get();
    const sql = renderSql(statements);
    const batches = splitBatches(statements);
    return {
      sql,
      batches,
      report: {
        elective,
        major,
        academic,
        counts,
        statements: statements.length,
        sqlSha256: sha256(sql),
        estimatedWrites: batches.reduce((sum, batch) => sum + batch.estimatedWrites, 0),
        maxWritesPerBatch,
        batches: batches.map(({ sql: _sql, ...batch }) => batch),
      },
    };
  } finally {
    // Planning must not change the supplied snapshot, even when validation fails.
    database.exec('ROLLBACK TO release_catalog; RELEASE release_catalog');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const split = args[2] === '--output-dir';
  if (args.length !== 4 || args[0] !== '--snapshot' || (!split && args[2] !== '--output'))
    throw new Error('用法：--snapshot <线上导出SQL> --output <待审核新增SQL> 或 --output-dir <分批目录>');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const paths = [args[1], args[3]].map((value, index) => {
    const path = resolve(root, value),
      within = relative(root, path);
    if (!within || within.startsWith('..') || isAbsolute(within) || ((!split || !index) && !path.endsWith('.sql')))
      throw new Error('输出必须位于项目内；SQL 文件使用 .sql 后缀');
    return path;
  });
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(paths[0], 'utf8'));
    db.exec('PRAGMA foreign_keys=ON');
    const directory = new URL('../migrations/', import.meta.url);
    const applied = new Set(
      db
        .prepare('SELECT name FROM d1_migrations')
        .all()
        .map((row) => row.name),
    );
    const pendingMigrations = readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .filter((name) => !applied.has(name));
    for (const name of pendingMigrations) {
      db.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
    const { sql, batches, report } = await prepareCatalogSql(db);
    report.pendingMigrations = pendingMigrations;
    if (!split && batches.length > 1)
      throw new Error(`预计写入 ${report.estimatedWrites} 行，超过单批 ${report.maxWritesPerBatch} 行。请改用 --output-dir 生成 ${batches.length} 个按顺序发布的批次。`);
    if (split) {
      mkdirSync(paths[1]);
      batches.forEach((batch, index) => {
        const name = `batch-${String(index + 1).padStart(3, '0')}.sql`;
        writeFileSync(join(paths[1], name), batch.sql, { encoding: 'utf8', flag: 'wx' });
        report.batches[index].file = name;
      });
    } else writeFileSync(paths[1], sql, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(split ? join(paths[1], 'report.json') : paths[1] + '.report.json', JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(JSON.stringify(report));
  } finally {
    db.close();
  }
}
