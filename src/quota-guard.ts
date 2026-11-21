import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './visitor.ts';
import { quotaOperations, serviceEvents, serviceGroups, type ServiceStatus } from '../shared/service-monitor.ts';
import { serviceDay } from './service-monitor.ts';

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
  private lastPrunedDay = '';

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS quota (
      key TEXT PRIMARY KEY, day INTEGER NOT NULL, used INTEGER NOT NULL
    )`);
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS service_daily (
      day TEXT NOT NULL, scope TEXT NOT NULL, event TEXT NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(day,scope,event)
    )`);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const sql = this.storage.sql;
    if (url.pathname === '/monitor' && request.method === 'GET') {
      const days = Number(url.searchParams.get('days') ?? 7);
      if (![7, 30].includes(days)) return new Response(null, { status: 400 });
      sql.exec('DELETE FROM service_daily WHERE day<?', serviceDay(Date.now(), 29));
      const rows = sql.exec<{ scope: string; event: string; count: number }>(
        'SELECT scope,event,sum(count) AS count FROM service_daily WHERE day BETWEEN ? AND ? GROUP BY scope,event',
        serviceDay(Date.now(), days - 1), serviceDay(),
      ).toArray();
      const counts = new Map(rows.map((r) => [r.scope + ':' + r.event, r.count]));
      const quotaDay = Math.floor(Date.now() / dayMs);
      const current = new Map(sql.exec<{ key: string; used: number }>(
        'SELECT key,used FROM quota WHERE day=? AND instr(key,\':\')=0', quotaDay,
      ).toArray().map((row) => [row.key, row.used]));
      const status: ServiceStatus = {
        days, today: serviceDay(),
        firstDay: sql.exec<{ day: string | null }>('SELECT min(day) AS day FROM service_daily').toArray()[0]?.day ?? null,
        operations: Object.keys(quotaOperations).map((operation) => ({
          operation: operation as Operation,
          allowed: counts.get(operation + ':allowed') ?? 0,
          networkLimited: counts.get(operation + ':network_limit') ?? 0,
          budgetLimited: counts.get(operation + ':budget_limit') ?? 0,
          used: current.get(operation) ?? 0,
          budget: budgets[operation as Operation].daily,
        })),
        signals: rows.filter((row) => Object.hasOwn(serviceGroups, row.scope) && Object.hasOwn(serviceEvents, row.event))
          .map((row) => ({ group: row.scope as keyof typeof serviceGroups, event: row.event as keyof typeof serviceEvents, count: row.count })),
      };
      return Response.json(status);
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (url.pathname === '/events') {
      const signal = await request.json<{ group: string; event: string }>();
      if (!signal || !Object.hasOwn(serviceGroups, signal.group) || !Object.hasOwn(serviceEvents, signal.event))
        return new Response(null, { status: 400 });
      this.count(signal.group, signal.event);
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== '/quota') return new Response(null, { status: 404 });
    const input = await request.json<{ operation: Operation; network: string }>();
    if (!input || !Object.hasOwn(costs, input.operation) || !/^[a-f0-9]{64}$/.test(input.network))
      return new Response(null, { status: 400 });

    const [lane, units] = costs[input.operation];
    const { daily, network } = budgets[lane];
    const now = Date.now();
    const day = Math.floor(now / dayMs);
    const storage = this.storage;
    const outcome = storage.transactionSync(() => {
      const globalKey = lane;
      const networkKey = lane + ':' + input.network;
      const current = (key: string) => sql.exec<{ day: number; used: number }>(
        'SELECT day, used FROM quota WHERE key=?', key,
      ).toArray()[0];
      const global = current(globalKey);
      const individual = current(networkKey);
      const used = global?.day === day ? global.used : 0;
      const own = individual?.day === day ? individual.used : 0;
      if (used + units > daily) return 'budget_limit';
      if (own + units > network) return 'network_limit';
      if (global?.day !== day) sql.exec('DELETE FROM quota WHERE day<?', day);
      for (const [key, value] of [[globalKey, used], [networkKey, own]] as const) {
        sql.exec(
          'INSERT INTO quota VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET day=excluded.day, used=excluded.used',
          key, day, value + units,
        );
      }
      return 'allowed';
    });
    this.count(input.operation, outcome);
    return new Response(null, outcome === 'allowed' ? { status: 204 } : {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(((day + 1) * dayMs - now) / 1000)) },
    });
  }

  private count(scope: string, event: string) {
    const today = serviceDay();
    if (today !== this.lastPrunedDay) {
      this.storage.sql.exec('DELETE FROM service_daily WHERE day<?', serviceDay(Date.now(), 29));
      this.lastPrunedDay = today;
    }
    this.storage.sql.exec(`INSERT INTO service_daily VALUES(?,?,?,1)
      ON CONFLICT(day,scope,event) DO UPDATE SET count=count+1`, today, scope, event);
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
    if (response.status === 429) {
      c.set('quotaRecorded', true);
      return throttle(c, response.headers.get('Retry-After') ?? '60', true);
    }
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
