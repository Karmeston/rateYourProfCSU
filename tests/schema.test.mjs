import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const schema = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../seeds/local.sql', import.meta.url), 'utf8');
const profileMigration = readFileSync(new URL('../migrations/0002_teacher_profile.sql', import.meta.url), 'utf8');

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  db.exec(seed);
  return db;
}

test('历史授课数据约束仍然保留', (t) => {
  const db = database(t);
  const records = db.prepare('SELECT term_id FROM course_offerings WHERE course_id = ? AND teacher_id = ?').all(-1, -1);
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map((row) => row.term_id)).size, 2);
  assert.throws(() => db.prepare('INSERT INTO course_offerings (course_id, teacher_id, term_id) VALUES (?, ?, ?)').run(-1, -1, -1), /UNIQUE/);
});

test('官网字段迁移保留已有资料和历史记录', (t) => {
  const db = database(t);
  const before = db.prepare('SELECT * FROM teachers ORDER BY id').all();
  db.exec(profileMigration);
  assert.deepEqual(db.prepare('SELECT id, name, department FROM teachers ORDER BY id').all(), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM course_offerings').get().n, 4);
  assert.equal(db.prepare('SELECT profile_url FROM teachers WHERE id = -1').get().profile_url, null);
  assert.throws(() => db.prepare('UPDATE teachers SET profile_url = ? WHERE id = ?').run('javascript:alert(1)', -1), /CHECK/);
  db.prepare('UPDATE teachers SET profile_url = ? WHERE id = ?').run('https://faculty.csu.edu.cn/example/', -1);
});

test('授课记录必须引用存在的课程、教师和学期，禁止删除被引用记录', (t) => {
  const db = database(t);
  const insert = db.prepare('INSERT INTO course_offerings (course_id, teacher_id, term_id) VALUES (?, ?, ?)');
  for (const ids of [[999, -1, -1], [-1, 999, -1], [-1, -1, 999]]) {
    assert.throws(() => insert.run(...ids), /FOREIGN KEY/);
  }
  for (const table of ['courses', 'teachers', 'terms']) {
    // 表名来自固定测试列表；所有输入值仍使用参数绑定。
    assert.throws(() => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(-1), /FOREIGN KEY/);
  }
});

test('允许教师同名，拒绝重复课程代码、重复学期及非法基础字段', (t) => {
  const db = database(t);
  db.prepare('INSERT INTO teachers (name, department) VALUES (?, ?)').run('虚构教师甲', '另一虚构学院');
  assert.throws(() => db.prepare('INSERT INTO courses (code, name, department) VALUES (?, ?, ?)').run('DEMO-MATH-001', '课程', '学院'), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO terms (start_year, semester) VALUES (?, ?)').run(2025, 1), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO terms (start_year, semester) VALUES (?, ?)').run(2026, 3), /CHECK/);
  assert.throws(() => db.prepare('INSERT INTO teachers (name, department) VALUES (?, ?)').run('   ', '学院'), /CHECK/);
});

test('演示数据可重复导入，不增加重复记录', (t) => {
  const db = database(t);
  db.exec(seed);
  assert.equal(db.prepare('SELECT count(*) AS total FROM course_offerings').get().total, 4);
});
