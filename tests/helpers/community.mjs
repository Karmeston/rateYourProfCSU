import { getPlatformProxy } from 'wrangler';
import app from '../../src/index.ts';
import { migrate } from './database.mjs';
import { issueCookie, visitorEnv } from './visitor.mjs';

export async function setupCommunity(t) {
  const platform = await getPlatformProxy({ persist: false });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  await migrate(db);
  for (const table of ['courses', 'teachers'])
    for (const id of [1, 2])
      await db
        .prepare(`INSERT INTO ${table}(id,name,department) VALUES(?,'测试课程','测试学院')`)
        .bind(id)
        .run();
  await db.prepare("UPDATE courses SET category='major'").run();
  const allow = { limit: async () => ({ success: true }) };
  const env = {
    ...visitorEnv(platform),
    VISITOR_LIMITER: allow,
    NETWORK_LIMITER: allow,
    PUBLISH_LIMITER: allow,
    VOTE_LIMITER: allow,
  };
  const owner = await issueCookie(env),
    other = await issueCookie(env);
  const request = (path, method = 'GET', body, identity = owner, headers = {}) =>
    app.request(
      path,
      {
        method,
        headers: {
          ...(identity ? { Cookie: identity } : {}),
          ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
  const json = async (path, identity = owner) =>
    (await request(path, 'GET', undefined, identity)).json();
  return { db, request, json, owner, other, env };
}
