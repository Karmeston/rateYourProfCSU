import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { importInitialCatalog } from '../scripts/import-initial-catalog.mjs';

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'));
  return db;
}

test('首批目录导入后可重跑，不需要学期、不重复教师', async (t) => {
  const db = database(t);
  const query = async (sql, params) => db.prepare(sql).all(...params);
  assert.equal((await importInitialCatalog(query)).inserted, 19);
  assert.equal((await importInitialCatalog(query)).inserted, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM teachers').get().n, 9);
  assert.equal(db.prepare('SELECT count(*) AS n FROM courses').get().n, 10);
  assert.equal(db.prepare('SELECT count(*) AS n FROM courses WHERE is_listed=1 AND category=?').get('major').n, 7);
  assert.equal(db.prepare('SELECT count(*) AS n FROM courses WHERE is_listed=0').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) AS n FROM terms').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM course_offerings').get().n, 0);
});

test('预检发现 ID 冲突时，不写入其余目录', async (t) => {
  const db = database(t);
  db.prepare('INSERT INTO courses (id, name, department) VALUES (?, ?, ?)').run(1, '已有课程', '已有学院');
  await assert.rejects(importInitialCatalog(async (sql, params) => db.prepare(sql).all(...params)), /已被其他资料占用/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM teachers').get().n, 0);
  assert.equal(db.prepare('SELECT name FROM courses WHERE id=1').get().name, '已有课程');
});
