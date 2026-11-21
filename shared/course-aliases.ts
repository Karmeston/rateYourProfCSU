// Confirmed historical codes. Existing positive IDs stay stable across catalog imports.
export const courseAliases = [
  { name: '《爱丽丝漫游仙境》与重金属中毒', alias: 'als', code: '4-59', oldId: 12617, id: 11732 },
  { name: '病原生物与人类健康', alias: 'bysw', code: '4-58', oldId: 12618, id: 11731 },
  { name: '观赏植物学', alias: 'gszw', code: '4-73', oldId: 12619, id: 4427 },
  { name: '日常化学物与人体健康', alias: 'rcrt', code: '4-64', oldId: 12624, id: 11735 },
  { name: '现代膳食与人体健康', alias: 'xdrt', code: '4-68', oldId: 12626, id: 11737 },
  { name: '饮食、文化与健康', alias: 'yswh', code: '4-40', oldId: 12627, id: 4422 },
  { name: '医院信息管理', alias: 'yyxxgl', code: '4-72', oldId: 12628, id: 4426 },
] as const;

const codes = new Map<string, string>(courseAliases.map((row) => [row.alias, row.code]));

export const canonicalCourseCode = (code: string) => codes.get(code) ?? code;
export const aliasCodesForQuery = (query: string) => query
  ? courseAliases.filter((row) => row.alias.includes(query.toLowerCase())).map((row) => row.code)
  : [];
