import { readFileSync } from 'node:fs';

export const catalog = JSON.parse(readFileSync(new URL('../data/initial-catalog.json', import.meta.url), 'utf8'));
const fields = {
  teachers: ['id', 'name', 'department', 'profile_url'],
  courses: ['id', 'name', 'department', 'code'],
};

// query(sql, params) 返回行数组；调用方选择本地数据库或远程 D1。
// 只支持已核对的首批目录，不是通用文件上传接口。
export async function importInitialCatalog(query) {
  const pending = [];
  for (const [table, columns] of Object.entries(fields)) {
    const rows = catalog[table];
    const ids = new Set();
    const names = new Set();
    const existing = await query(`SELECT ${columns.join(', ')} FROM ${table}`, []);
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) throw new Error('目录 ID 无效或重复');
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100 || names.has(row.name)) throw new Error('目录名称无效或重复');
      if (typeof row.department !== 'string' || !row.department.trim() || row.department.length > 100) throw new Error('学院字段无效');
      if (table === 'courses' && row.code !== null && (typeof row.code !== 'string' || !row.code.trim() || row.code.length > 64)) throw new Error('课程代码无效');
      if (table === 'teachers' && row.profile_url !== null) {
        const url = new URL(row.profile_url);
        if (url.protocol !== 'https:' || url.hostname !== 'faculty.csu.edu.cn' || row.profile_url.length > 2048) throw new Error('官网链接无效');
      }
      ids.add(row.id);
      names.add(row.name);
      const sameId = existing.find((item) => item.id === row.id);
      if (sameId && columns.some((column) => sameId[column] !== row[column])) throw new Error(`${table} ID ${row.id} 已被其他资料占用`);
      if (existing.some((item) => item.name === row.name && item.id !== row.id)) throw new Error(`${table} ${row.name} 存在同名资料，需核对身份`);
      if (!sameId) pending.push({ table, columns, row });
    }
  }
  // 全部预检完成后才开始写入。无覆盖操作；中途网络失败可核对后重跑。
  for (const { table, columns, row } of pending) {
    await query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map((column) => row[column]));
  }
  return { inserted: pending.length, teachers: catalog.teachers.length, courses: catalog.courses.length };
}
