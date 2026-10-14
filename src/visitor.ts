import { Hono, type Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { readBody } from './request-body.ts';

export type AppEnv = {
  Bindings: Env & {
    VISITOR_SECRET?: string;
    ADMIN_PASSWORD_HASH?: string;
    ADMIN_SESSION_SECRET?: string;
  };
  Variables: { visitorId: string | undefined; adminId?: string };
};
type VisitorContext = Context<AppEnv>;
const lifetime = 180 * 24 * 60 * 60;
const tokenPattern =
  /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(\d{10})$/;

function cookieSettings(c: VisitorContext) {
  const url = new URL(c.req.url);
  const secure = url.protocol === 'https:';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return { secure, allowed: secure || local, name: secure ? '__Host-csu-visitor' : 'csu-visitor' };
}

function configured(c: VisitorContext) {
  return typeof c.env.VISITOR_SECRET === 'string' && c.env.VISITOR_SECRET.length >= 32;
}

function unavailable(c: VisitorContext) {
  return c.json({ error: '互动服务暂时不可用，请稍后重试。' }, 503);
}

export function checkWriteRequest(c: VisitorContext) {
  const origin = c.req.header('Origin');
  if (
    (origin && origin !== new URL(c.req.url).origin) ||
    c.req.header('Sec-Fetch-Site') === 'cross-site'
  )
    return c.json({ error: '不支持跨站提交' }, 403);
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return c.json({ error: '请使用 JSON 提交' }, 415);
  return null;
}

// Only a verified, unexpired server signature establishes a visitor. Client headers are ignored.
export async function readVisitor(c: VisitorContext): Promise<string | undefined> {
  const settings = cookieSettings(c);
  if (!configured(c) || !settings.allowed) return undefined;
  const value = await getSignedCookie(c, c.env.VISITOR_SECRET!, settings.name);
  if (typeof value !== 'string') return undefined;
  const match = tokenPattern.exec(value);
  if (!match) return undefined;
  const age = Math.floor(Date.now() / 1000) - Number(match[2]);
  return age >= 0 && age < lifetime ? match[1] : undefined;
}

export function requireVisitor(c: VisitorContext) {
  if (!configured(c) || !cookieSettings(c).allowed) return unavailable(c);
  if (!c.get('visitorId'))
    return c.json({ code: 'VISITOR_REQUIRED', error: '请允许本站 Cookie 后重试。' }, 401);
  return null;
}

async function networkKey(c: VisitorContext) {
  // CF-Connecting-IP is supplied by Cloudflare, not X-Forwarded-For from the caller.
  // A direct production HTTP origin must not bypass Cloudflare's edge.
  const ip = c.req.header('CF-Connecting-IP');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname);
  if (!ip && !local) return undefined;
  const bytes = new TextEncoder().encode(`${c.env.VISITOR_SECRET}\0${ip ?? 'local'}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function limited(c: VisitorContext) {
  c.header('Retry-After', '60');
  return c.json({ error: '操作太频繁，请稍等一分钟再试。' }, 429);
}

export async function limitWrite(c: VisitorContext, action: 'publish' | 'vote') {
  const rejected = requireVisitor(c);
  if (rejected) return rejected;
  const ip = await networkKey(c);
  if (!ip || !c.env.NETWORK_LIMITER) return unavailable(c);
  if (!(await c.env.NETWORK_LIMITER.limit({ key: `write:${ip}` })).success) return limited(c);
  const limiter = action === 'publish' ? c.env.PUBLISH_LIMITER : c.env.VOTE_LIMITER;
  if (!limiter) return unavailable(c);
  if (!(await limiter.limit({ key: `visitor:${c.get('visitorId')}` })).success) return limited(c);
  return null;
}

const visitor = new Hono<AppEnv>();
visitor.post('/visitor', async (c) => {
  c.header('Cache-Control', 'no-store');
  const rejected = checkWriteRequest(c);
  if (rejected) return rejected;
  if (Object.keys(c.req.queries()).length) return c.json({ error: '参数不合法' }, 400);
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  if (
    !input.value ||
    typeof input.value !== 'object' ||
    Array.isArray(input.value) ||
    Object.keys(input.value).length
  )
    return c.json({ error: '参数不合法' }, 400);
  if (!configured(c) || !cookieSettings(c).allowed) return unavailable(c);
  if (await readVisitor(c)) return c.body(null, 204);
  const ip = await networkKey(c);
  if (!ip || !c.env.VISITOR_LIMITER) return unavailable(c);
  if (!(await c.env.VISITOR_LIMITER.limit({ key: `issue:${ip}` })).success) return limited(c);
  const settings = cookieSettings(c);
  const value = `v1.${crypto.randomUUID()}.${Math.floor(Date.now() / 1000)}`;
  await setSignedCookie(c, settings.name, value, c.env.VISITOR_SECRET!, {
    path: '/',
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'Strict',
    maxAge: lifetime,
  });
  return c.body(null, 204);
});
export default visitor;
