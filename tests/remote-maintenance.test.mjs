import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createRemoteD1 } from '../scripts/lib/remote-d1.mjs';
import { moderate } from '../scripts/moderate.mjs';

function schema(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(new URL(name, directory), 'utf8'));
  return db;
}

test('线上维护使用安全的参数展开和单次事务请求，不向空本地schema写入远程内容', async (t) => {
  const empty = schema(t),
    remote = schema(t);
  let requests = 0;
  remote.exec(
    "INSERT INTO courses(id,name,department) VALUES(1,'课程','学院');INSERT INTO course_reviews(id,course_id,rating,body,status) VALUES('00000000-0000-4000-8000-000000000001',1,4,'真实内容','published')",
  );
  const db = createRemoteD1(empty, async (queries) => {
    requests++;
    remote.exec('SAVEPOINT rpc');
    try {
      const result = queries.map((sql) => {
        const query = remote.prepare(sql);
        return query.columns().length
          ? { success: true, results: query.all(), meta: { changes: 0 } }
          : { success: true, results: [], meta: query.run() };
      });
      remote.exec('RELEASE rpc');
      return result;
    } catch (error) {
      remote.exec('ROLLBACK TO rpc; RELEASE rpc');
      throw error;
    }
  });
  const reason = "引号'、问号?; 处理理由";
  await moderate(db, {
    kind: 'course_review',
    id: '00000000-0000-4000-8000-000000000001',
    action: 'hide',
    revision: 0,
    reason,
  });
  assert.equal(requests, 1);
  assert.equal(remote.prepare('SELECT reason FROM moderation_actions').get().reason, reason);
  assert.equal(remote.prepare('SELECT status FROM course_reviews').get().status, 'rejected');
  assert.equal(empty.prepare('SELECT count(*) AS n FROM moderation_actions').get().n, 0);
  await assert.rejects(
    moderate(db, {
      kind: 'course_review',
      id: '00000000-0000-4000-8000-000000000001',
      action: 'restore',
      revision: 0,
      reason: '旧版本',
    }),
    /版本/,
  );
  assert.equal(remote.prepare('SELECT count(*) AS n FROM moderation_actions').get().n, 1);
});

test('远程写入异常不自动重试或误报成功', async (t) => {
  const empty = schema(t);
  let requests = 0;
  const db = createRemoteD1(empty, async () => {
    requests++;
    throw new Error('uncertain network result');
  });
  await assert.rejects(
    db.prepare("UPDATE course_reviews SET status='rejected' WHERE id=?").bind('id').run(),
    /uncertain/,
  );
  assert.equal(requests, 1);
});
