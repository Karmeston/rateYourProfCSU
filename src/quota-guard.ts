import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './visitor.ts';

// Admission weights are conservative estimates at the current catalog size, not billing data.
const budgets = {
  catalog: { daily: 1_850_000, network: 700_000 },
  program: { daily: 750_000, network: 240_000 },
  facets: { daily: 1_000_000, network: 350_000 },
  content: { daily: 750_000, network: 100_000 },
  interaction: { daily: 40_000, network: 2_400 },
  traffic: { daily: 12_000, network: 480 },
} as const;

const costs = {
  catalog: ['catalog', 35_000],
  program: ['program', 2_000],
  facets: ['facets', 175_000],
  content: ['content', 500],
  interaction: ['interaction', 12],
  traffic: ['traffic', 6],
} as const;

type Operation = keyof typeof costs;
type AppContext = Context<AppEnv>;
const dayMs = 86_400_000;

// A single internal SQLite-backed object enforces the budget across edge locations.
// D1 is never queried or written by the guard.
export class QuotaGuard {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS quota (
      key TEXT PRIMARY KEY, day INTEGER NOT NULL, used INTEGER NOT NULL
    )`);
  }

  async fetch(request: Request) {
    const input = await request.json<{ operation: Operation; network: string }>();
    if (!input || !Object.hasOwn(costs, input.operation) || !/^[a-f0-9]{64}$/.test(input.network))
      return new Response(null, { status: 400 });

    const [lane, units] = costs[input.operation];
    const { daily, network } = budgets[lane];
    const now = Date.now();
    const day = Math.floor(now / dayMs);
    const storage = this.storage;
    const sql = storage.sql;
    const accepted = storage.transactionSync(() => {
      const globalKey = lane;
      const networkKey = lane + ':' + input.network;
      const current = (key: string) => sql.exec<{ day: number; used: number }>(
        'SELECT day, used FROM quota WHERE key=?', key,
      ).toArray()[0];
      const global = current(globalKey);
      const individual = current(networkKey);
      const used = global?.day === day ? global.used : 0;
      const own = individual?.day === day ? individual.used : 0;
      if (used + units > daily || own + units > network) return false;
      if (global?.day !== day) sql.exec('DELETE FROM quota WHERE day<?', day);
      for (const [key, value] of [[globalKey, used], [networkKey, own]] as const) {
        sql.exec(
          'INSERT INTO quota VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET day=excluded.day, used=excluded.used',
          key, day, value + units,
        );
      }
      return true;
    });
    return new Response(null, accepted ? { status: 204 } : {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(((day + 1) * dayMs - now) / 1000)) },
    });
  }
}

function edgeNetwork(c: AppContext) {
  const ip = c.req.header('CF-Connecting-IP');
  if (!ip) return undefined;
  if (!ip.includes(':')) return ip;
  // Canonicalize IPv6 and group rotating device addresses under their /64.
  try {
    const host = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    const [left, right] = host.split('::');
    const head = left ? left.split(':') : [];
    const tail = right ? right.split(':') : [];
    const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
    return groups.slice(0, 4).join(':') + '::/64';
  } catch {
    return undefined;
  }
}

function localRequest(c: AppContext) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname);
}

function throttle(c: AppContext, retry: string, daily: boolean) {
  c.header('Cache-Control', 'no-store');
  c.header('Retry-After', retry);
  return c.json({
    code: daily ? 'SERVICE_DAILY_BUDGET' : 'REQUEST_RATE_LIMIT',
    error: daily ? '此功能今日的请求额度已达上限，额度在北京时间早上 8 点重置。' : '请求太频繁，请稍后再试。',
  }, 429);
}

function guardUnavailable(c: AppContext) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error: '服务暂时不可用，请稍后重试。' }, 503);
}

export async function reserveQuota(c: AppContext, operation: Operation) {
  const ip = edgeNetwork(c);
  if (!ip && localRequest(c)) return null;
  const { QUOTA_GUARD, VISITOR_SECRET } = c.env;
  if (!ip || !QUOTA_GUARD || !VISITOR_SECRET) return guardUnavailable(c);
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${VISITOR_SECRET}\0${ip}`));
    const network = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const stub = QUOTA_GUARD.get(QUOTA_GUARD.idFromName('public-d1'));
    const response = await stub.fetch('https://internal/quota', {
      method: 'POST',
      body: JSON.stringify({ operation, network }),
    });
    if (response.status === 204) return null;
    if (response.status === 429) return throttle(c, response.headers.get('Retry-After') ?? '60', true);
  } catch {
    // Fail closed so an unavailable quota store cannot send unbounded requests to D1.
  }
  return guardUnavailable(c);
}

export const protectPublicData: MiddlewareHandler<AppEnv> = async (c, next) => {
  const network = edgeNetwork(c);
  if (!network && localRequest(c)) return next();
  if (!network || !c.env.PUBLIC_DATA_LIMITER) return guardUnavailable(c);
  try {
    if (!(await c.env.PUBLIC_DATA_LIMITER.limit({ key: network })).success)
      return throttle(c, '60', false);
  } catch {
    return guardUnavailable(c);
  }
  const path = c.req.path.replace(/\/$/, '');
  // The course directory reserves after its cache lookup, using an estimate for the actual query.
  if (c.req.method === 'GET' && ['/api/courses', '/api/courses/facets', '/api/courses/ratings'].includes(path))
    return next();
  const refused = await reserveQuota(c, 'content');
  if (refused) return refused;
  return next();
};
