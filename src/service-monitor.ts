import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './visitor.ts';
import type { ServiceGroup } from '../shared/service-monitor.ts';

export function serviceDay(now = Date.now(), offset = 0) {
  return new Date(now + 8 * 3600000 - offset * 86400000).toISOString().slice(0, 10);
}

function requestGroup(path: string, method: string): ServiceGroup {
  if (path.startsWith('/api/admin')) return 'admin';
  if (path.startsWith('/api/traffic')) return 'traffic';
  if (path.startsWith('/api/visitor')) return 'visitor';
  if (/^\/api\/(courses|teachers)(\/|$)/.test(path)) {
    if (method !== 'GET') return 'interaction';
    if (/\/reviews(?:\/|$)/.test(path)) return 'reviews';
    if (/\/(-?[1-9]\d*)(?:\/|$)/.test(path)) return 'course';
    return 'catalog';
  }
  return 'other';
}

// Bound failure reporting even during an attack. Quota decisions are counted in the guard itself.
let windowStart = 0;
let reported = 0;
export const monitorService: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.get('quotaRecorded')) return;
  const event = c.get('serviceEvent') ??
    (c.res.status === 429 ? 'rate_limit' : c.res.status >= 500 ? 'server_error' : null);
  if (!event || !c.env.QUOTA_GUARD) return;
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== windowStart) {
    windowStart = minute;
    reported = 0;
  }
  if (reported >= 60) return;
  let ctx: Context<AppEnv>['executionCtx'];
  try {
    ctx = c.executionCtx;
  } catch {
    return;
  }
  reported++;
  ctx.waitUntil(Promise.resolve().then(async () => {
    const stub = c.env.QUOTA_GUARD.get(c.env.QUOTA_GUARD.idFromName('public-d1'));
    const response = await stub.fetch('https://internal/events', {
      method: 'POST',
      body: JSON.stringify({ group: requestGroup(c.req.path, c.req.method), event }),
    });
    if (!response.ok) console.warn('Service monitoring unavailable');
  }).catch(() => console.warn('Service monitoring unavailable')));
};
