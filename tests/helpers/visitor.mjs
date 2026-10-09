import assert from 'node:assert/strict';
import app from '../../src/index.ts';

export const testSecret = 'synthetic-test-secret-at-least-32-characters';
export const visitorEnv = (platform) => ({ ...platform.env, VISITOR_SECRET: testSecret });
export async function issueCookie(
  env,
  { url = 'http://localhost/api/visitor', headers = {} } = {},
) {
  const response = await app.request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    },
    env,
  );
  assert.equal(response.status, 204);
  return response.headers.get('Set-Cookie')?.split(';')[0];
}
