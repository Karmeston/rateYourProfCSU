// Prepare insert-only SQL against a production export; this script never connects to a remote database.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importMajorCatalog, majorCatalog } from './import-major-catalog.mjs';
import { importElectiveCatalog, electiveCatalog } from './import-elective-catalog.mjs';
import { importAcademicCatalog, academicCatalog } from './import-academic-catalog.mjs';

export async function prepareCatalogSql(
  database,
  sources = { major: majorCatalog, elective: electiveCatalog, academic: academicCatalog },
) {
  const statements = [];
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
    if (
      !/^\s*INSERT\s+INTO\s+(courses|course_materials|elective_course_facts|elective_course_offerings|course_catalog_records)\b/i.test(
        sql,
      )
    )
      throw new Error('发行目录只允许新增已核对的课程及资料');
    const result = query.run(...values);
    // SQLite expands bound values itself, including quotes, Unicode and literal question marks.
    statements.push(query.expandedSQL + ';');
    return { results: [], meta: { changes: Number(result.changes) } };
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
    const sql =
      '-- Verified catalog additions; existing IDs, visibility and reviews are preserved.\n' +
      statements.join('\n') +
      '\n';
    return {
      sql,
      report: {
        elective,
        major,
        academic,
        counts,
        statements: statements.length,
        sqlSha256: createHash('sha256').update(sql).digest('hex'),
      },
    };
  } finally {
    // Planning must not change the supplied snapshot, even when validation fails.
    database.exec('ROLLBACK TO release_catalog; RELEASE release_catalog');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--output')
    throw new Error('用法：--snapshot <线上导出SQL> --output <待审核新增SQL>');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const paths = [args[1], args[3]].map((value) => {
    const path = resolve(root, value),
      within = relative(root, path);
    if (!within || within.startsWith('..') || isAbsolute(within) || !path.endsWith('.sql'))
      throw new Error('导出与新增SQL必须位于项目内，且使用.sql后缀');
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
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (applied.has(name)) continue;
      db.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
    const { sql, report } = await prepareCatalogSql(db);
    writeFileSync(paths[1], sql, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(paths[1] + '.report.json', JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(JSON.stringify(report));
  } finally {
    db.close();
  }
}
