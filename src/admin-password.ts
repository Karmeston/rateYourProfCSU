const iterations = 100000;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
    key,
    256,
  );
}
export function validPasswordHash(value: unknown): value is string {
  return (
    typeof value === 'string' && /^pbkdf2-sha256:100000:[a-f0-9]{32}:[a-f0-9]{64}$/.test(value)
  );
}
export async function hashAdminPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256:${iterations}:${hex(salt.buffer)}:${hex(await derive(password, salt))}`;
}
export async function verifyAdminPassword(password: string, stored: string) {
  if (!validPasswordHash(stored)) return false;
  const [, , salt, expected] = stored.split(':');
  const candidate = await derive(password, unhex(salt));
  // Native HMAC verification compares the derived hashes without a JS string comparison.
  const actualKey = await crypto.subtle.importKey(
    'raw',
    candidate,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expectedKey = await crypto.subtle.importKey(
    'raw',
    unhex(expected),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const challenge = encoder.encode('csu-admin-password-check');
  return crypto.subtle.verify(
    'HMAC',
    expectedKey,
    await crypto.subtle.sign('HMAC', actualKey, challenge),
    challenge,
  );
}
export async function passwordVersion(stored: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(stored)));
}
