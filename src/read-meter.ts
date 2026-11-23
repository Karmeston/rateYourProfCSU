import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './visitor.ts';
import { chargeQuota } from './quota-guard.ts';

type Count = (rows: number) => void;
// Batches must receive D1's own statement objects, so each metered wrapper remembers its original.
const originals = new WeakMap<object, D1PreparedStatement>();

function rowsRead(result: { meta?: { rows_read?: number } }) {
  const rows = result.meta?.rows_read;
  return typeof rows === 'number' && rows > 0 ? rows : 0;
}

function meterStatement(statement: D1PreparedStatement, count: Count): D1PreparedStatement {
  const metered = new Proxy(statement, {
    get(target, key) {
      if (key === 'bind')
        return (...values: unknown[]) => meterStatement(target.bind(...values), count);
      if (key === 'all' || key === 'run')
        return async () => {
          const result = key === 'all' ? await target.all() : await target.run();
          count(rowsRead(result));
          return result;
        };
      // D1 first() executes the whole statement as well; all() reads the same rows and exposes meta.
      if (key === 'first')
        return async (column?: string) => {
          const result = await target.all<Record<string, unknown>>();
          count(rowsRead(result));
          const row = result.results[0];
          if (!row) return null;
          if (column === undefined) return row;
          if (!Object.hasOwn(row, column))
            throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
          return row[column];
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  originals.set(metered, statement);
  return metered;
}

// Wraps one request's database binding so every statement reports the rows D1 actually read.
export function meterDatabase(db: D1Database, count: Count): D1Database {
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare')
        return (query: string) => meterStatement(target.prepare(query), count);
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements.map((row) => originals.get(row) ?? row));
          for (const result of results) count(rowsRead(result));
          return results;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Admission reserves a small estimate before touching D1. When the request read more rows than
// that, the difference is charged afterwards, so heavy reads use their real cost.
export const chargeReads: MiddlewareHandler<AppEnv> = async (c, next) => {
  let rows = 0;
  if (c.env?.DB)
    c.env = { ...c.env, DB: meterDatabase(c.env.DB, (read) => void (rows += read)) };
  await next();
  const reserved = c.get('readReservation');
  if (!reserved || rows <= reserved.estimate) return;
  const task = chargeQuota(c.env, reserved, rows - reserved.estimate);
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // Tests and local tools may call the app without an execution context.
    await task;
  }
};
