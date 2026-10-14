import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { objectInput } from './community-input.ts';
import { readBody } from './request-body.ts';
import { passwordVersion, validPasswordHash, verifyAdminPassword } from './admin-password.ts';
import type { AppEnv } from './visitor.ts';

type AdminContext = Context<AppEnv>;
const lifetime = 8 * 60 * 60;
const auth = new Hono<AppEnv>();
function settings(c: AdminContext) {
  const url = new URL(c.req.url),
    secure = url.protocol === 'https:';
  return {
    secure,
    allowed: secure || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    name: secure ? '__Host-csu-admin' : 'csu-admin',
  };
}
export function adminConfigured(c: AdminContext) {
  return (
    settings(c).allowed &&
    validPasswordHash(c.env.ADMIN_PASSWORD_HASH) &&
    typeof c.env.ADMIN_SESSION_SECRET === 'string' &&
    c.env.ADMIN_SESSION_SECRET.length >= 32
  );
}
export function checkAdminWrite(c: AdminContext) {
  if (
    c.req.header('Origin') !== new URL(c.req.url).origin ||
    c.req.header('Sec-Fetch-Site') === 'cross-site'
  )
    return c.json({ error: '不支持跨站管理操作' }, 403);
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return c.json({ error: '请使用JSON提交' }, 415);
  return null;
}
export async function managementNetworkKey(c: AdminContext) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname);
  const ip = c.req.header('CF-Connecting-IP') ?? (local ? 'local' : null);
  if (!ip) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${c.env.ADMIN_SESSION_SECRET ?? c.env.VISITOR_SECRET}\0${ip}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function readAdmin(c: AdminContext) {
  if (!adminConfigured(c)) return undefined;
  const value = await getSignedCookie(c, c.env.ADMIN_SESSION_SECRET!, settings(c).name);
  const match =
    typeof value === 'string' && /^a1\.([a-f0-9-]{36})\.(\d{10})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return undefined;
  const now = Math.floor(Date.now() / 1000),
    issued = Number(match[2]);
  if (
    issued > now ||
    now - issued >= lifetime ||
    match[3] !== (await passwordVersion(c.env.ADMIN_PASSWORD_HASH!))
  )
    return undefined;
  const stored = await c.env.DB.prepare('SELECT id FROM admin_sessions WHERE id=? AND expires_at>?')
    .bind(match[1], now)
    .first<{ id: string }>();
  return stored?.id;
}
auth.get('/session', async (c) => {
  if (Object.keys(c.req.queries()).length) return c.json({ error: '参数不合法' }, 400);
  return c.json({ configured: adminConfigured(c), authenticated: !!(await readAdmin(c)) });
});
auth.post('/login', async (c) => {
  const rejected = checkAdminWrite(c);
  if (rejected) return rejected;
  if (!adminConfigured(c) || !c.env.ADMIN_LOGIN_LIMITER)
    return c.json({ error: '后台尚未配置或暂时不可用' }, 503);
  if (Object.keys(c.req.queries()).length) return c.json({ error: '参数不合法' }, 400);
  const network = await managementNetworkKey(c);
  if (!network) return c.json({ error: '后台暂时不可用' }, 503);
  if (!(await c.env.ADMIN_LOGIN_LIMITER.limit({ key: `admin-login:${network}` })).success) {
    c.header('Retry-After', '60');
    return c.json({ error: '登录尝试过多，请稍等一分钟' }, 429);
  }
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value);
  if (
    !data ||
    Object.keys(data).some((key) => key !== 'password') ||
    typeof data.password !== 'string' ||
    data.password.length < 16 ||
    data.password.length > 256
  )
    return c.json({ error: '登录信息不正确' }, 401);
  if (!(await verifyAdminPassword(data.password, c.env.ADMIN_PASSWORD_HASH!)))
    return c.json({ error: '登录信息不正确' }, 401);
  const id = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000),
    config = settings(c);
  await c.env.DB.prepare('INSERT INTO admin_sessions(id,expires_at) VALUES(?,?)')
    .bind(id, now + lifetime)
    .run();
  await setSignedCookie(
    c,
    config.name,
    `a1.${id}.${now}.${await passwordVersion(c.env.ADMIN_PASSWORD_HASH!)}`,
    c.env.ADMIN_SESSION_SECRET!,
    { path: '/', httpOnly: true, secure: config.secure, sameSite: 'Strict', maxAge: lifetime },
  );
  return c.json({ authenticated: true });
});
auth.post('/logout', async (c) => {
  const rejected = checkAdminWrite(c);
  if (rejected) return rejected;
  const input = await readBody(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, input.status);
  const data = objectInput(input.value);
  if (!data || Object.keys(data).length || Object.keys(c.req.queries()).length)
    return c.json({ error: '参数不合法' }, 400);
  const id = await readAdmin(c);
  if (id) await c.env.DB.prepare('DELETE FROM admin_sessions WHERE id=?').bind(id).run();
  const config = settings(c);
  deleteCookie(c, config.name, {
    path: '/',
    secure: config.secure,
    httpOnly: true,
    sameSite: 'Strict',
  });
  return c.body(null, 204);
});
export default auth;
