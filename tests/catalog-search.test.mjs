import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openDirectory, searchDirectory } from '../shared/course-directory.ts';
import { defaultFilters } from '../web/routing.ts';

const snapshot = {
  version: 2, departments: ['学院', '待核实'],
  courses: [
    [1, '算法与数据结构', 'A1', 0, 'major', null],
    [2, '数据结构课程设计', 'A2', 0, 'major', null],
    [3, '数据结构', 'A3', 1, 'major', null],
    [4, '代码匹配', '数据结构-X', 0, 'major', null],
    [5, '数据结构', 'A5', 0, 'major', null],
    [6, '数据结构', 'A6', 1, 'major', null],
  ], programs: [], colleges: [],
};

test('默认搜索按完全匹配、前缀、包含、仅代码排序，相关度先于评分数量', () => {
  const directory = openDirectory(snapshot);
  const filters = { ...defaultFilters, q: '数据结构' };
  const ratings = [[6, 3, 2], [1, 5, 100]];
  const ids = searchDirectory(directory, filters, 24, ratings).courses.map((row) => row.id);
  assert.deepEqual(ids, [6, 5, 3, 2, 1, 4]);
  assert.deepEqual(searchDirectory(directory, { ...filters, offset: 2 }, 2, ratings).courses.map((r) => r.id), ids.slice(2, 4));
  assert.deepEqual(searchDirectory(directory, defaultFilters, 24).courses.map((r) => r.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(searchDirectory(directory, { ...filters, sort: 'reviews' }, 24, ratings).courses[0].id, 1);
});

test('搜索统一全半角、大小写与空白，精确代码优先', () => {
  const directory = openDirectory(snapshot);
  assert.equal(searchDirectory(directory, { ...defaultFilters, q: ' Ａ ５ ' }, 24).courses[0].id, 5);
  assert.equal(searchDirectory(directory, { ...defaultFilters, q: ' 数据 结构 ' }, 24).total, 6);
});

test('真实目录的数据结构搜索首先展示完全同名课程，旧代码仍可命中', () => {
  const directory = openDirectory(JSON.parse(readFileSync(new URL('../data/course-data/public-directory.json', import.meta.url))));
  const exact = directory.courses.filter((r) => r.name === '数据结构');
  assert.ok(exact.length > 1);
  const result = searchDirectory(directory, { ...defaultFilters, q: '数据结构' }, 24);
  assert.ok(result.courses.slice(0, Math.min(exact.length, 24)).every((r) => r.name === '数据结构'));
  assert.equal(searchDirectory(directory, { ...defaultFilters, q: 'BYSW' }, 24).courses[0].code, '4-58');
});

test('记住的学院专业只在同档优先，取本学院最新方案并保留全部搜索结果', () => {
  const directory = openDirectory({
    ...snapshot,
    programs: [['专业', [[2026, [2, 6]], [2024, [5]]]], ['辅修专业', [[2026, [1]]]]],
    colleges: [['甲学院', [['专业', [[2026], [2024]]], ['辅修专业', [[2026]]]]],
      ['乙学院', [['专业', [[2026, [5]]]]]]],
  });
  const filters = { ...defaultFilters, q: '数据结构' };
  const ratings = [[5, 5, 100]];
  const find = (plan) => searchDirectory(directory, filters, 24, ratings, plan);
  const own = find({ college: '甲学院', program: '专业' });
  assert.deepEqual(own.courses.slice(0, 4).map((r) => r.id), [6, 5, 3, 2]);
  assert.equal(own.total, find(null).total);
  assert.equal(find(null).courses[0].id, 5);
  assert.equal(find({ college: '乙学院', program: '专业' }).courses[0].id, 5);
  assert.equal(find({ college: '已撤销学院', program: '专业' }).total, 6);
  assert.deepEqual(searchDirectory(directory, defaultFilters, 24, [], { college: '甲学院', program: '专业' }).courses.map((r) => r.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(searchDirectory(directory, { ...filters, sort: 'reviews' }, 24, ratings, { college: '甲学院', program: '专业' }).courses[0].id, 5);
});
