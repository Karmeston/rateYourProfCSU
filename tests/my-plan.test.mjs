import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMyPlan, writeMyPlan } from '../web/my-plan.ts';

test('学院专业可在刷新后恢复及清除，存储内容只含选择', () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  const plan = { college: '计算机学院', program: '计算机科学与技术' };
  assert.equal(writeMyPlan(plan, storage), true);
  assert.deepEqual(readMyPlan(storage), plan);
  assert.deepEqual([...entries.keys()], ['csu-my-plan']);
  assert.equal(writeMyPlan(null, storage), true);
  assert.equal(readMyPlan(storage), null);
});

test('损坏或被禁用的浏览器存储不会中断查课', () => {
  for (const value of ['invalid', 'null', '[]', '{"college":1,"program":""}', '{"college":"","program":""}', JSON.stringify({college: 'A'.repeat(101), program: 'B'})])
    assert.equal(readMyPlan({ getItem: () => value }), null);
  const fail = () => { throw new Error('Storage disabled'); };
  const blocked = { getItem: fail, setItem: fail, removeItem: fail };
  assert.equal(readMyPlan(blocked), null);
  assert.equal(writeMyPlan({ college: '学院', program: '' }, blocked), false);
  assert.equal(writeMyPlan(null, blocked), false);
});
