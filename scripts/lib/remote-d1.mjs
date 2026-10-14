// Authenticated Wrangler transport only; no Cloudflare credentials enter the website.
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function createRemoteD1(schema, execute) {
  function statement(sql, values = []) {
    return {
      bind: (...parameters) => statement(sql, parameters),
      sql,
      values,
      all: async () => (await batch([statement(sql, values)]))[0],
      first: async () => (await batch([statement(sql, values)]))[0].results[0] ?? null,
      run: async () => (await batch([statement(sql, values)]))[0],
    };
  }
  async function batch(queries) {
    const sql = queries.map(({ sql, values }) => {
      const query = schema.prepare(sql);
      if (query.columns().length) query.all(...values);
      else query.run(...values);
      return query.expandedSQL;
    });
    const result = await execute(sql);
    if (
      !Array.isArray(result) ||
      result.length !== queries.length ||
      result.some((item) => !item.success || !Array.isArray(item.results))
    )
      throw new Error('远程D1返回了意外结果，请先inspect核对状态。');
    return result;
  }
  return { prepare: statement, batch };
}

export async function withRemoteD1(operation) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const schema = new DatabaseSync(':memory:');
  const directory = resolve(root, 'migrations');
  try {
    // Empty local schema is used only to expand parameter bindings safely with SQLite.
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      schema.exec(readFileSync(resolve(directory, name), 'utf8'));
    const db = createRemoteD1(schema, async (queries) => {
      const { stdout } = await run(
        process.execPath,
        [
          '--require',
          resolve(root, 'scripts/cloudflare-network.cjs'),
          resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
          'd1',
          'execute',
          'DB',
          '--config',
          resolve(root, 'wrangler.jsonc'),
          '--remote',
          '--command',
          queries.join(';\n') + ';',
          '--json',
        ],
        { cwd: root, env: process.env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    });
    // No automatic retry for writes: inspect the current revision after an uncertain response.
    return await operation(db);
  } finally {
    schema.close();
  }
}
