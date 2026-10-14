import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hashAdminPassword } from '../src/admin-password.ts';

const mode = process.argv[2];
if (!['--local', '--production'].includes(mode) || process.argv.length !== 3)
  throw new Error('用法：node scripts/setup-admin.mjs --local 或 --production');
const production = mode === '--production';
mkdirSync('tmp', { recursive: true });
const file = `tmp/admin-${production ? 'production' : 'local'}-password.txt`;
if (existsSync(file))
  throw new Error('初始口令文件已存在，为防止误覆盖，未重新配置。请核对现有配置。');
if (production && existsSync('tmp/admin-production-bootstrap.json'))
  throw new Error('线上初始化恢复文件已存在，未重新配置。请核对现有配置。');
const password = production
  ? randomBytes(32).toString('base64url')
  : 'local-admin-test-password-20261014';
const hash = await hashAdminPassword(password),
  secret = randomBytes(32).toString('base64url');
const cli = [
  '--env-file-if-exists=.env.deploy',
  '--require',
  './scripts/cloudflare-network.cjs',
  './node_modules/wrangler/bin/wrangler.js',
];
if (production) {
  const result = spawnSync(process.execPath, [...cli, 'secret', 'list'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('无法核对线上密钥，未进行配置');
  const names = JSON.parse(result.stdout).map((row) => row.name);
  if (names.some((name) => name.startsWith('ADMIN_')))
    throw new Error('线上管理员密钥已存在，未覆盖');
} else {
  const current = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : '';
  if (/^\s*ADMIN_(PASSWORD_HASH|SESSION_SECRET)\s*=/m.test(current))
    throw new Error('本地管理员配置已存在，未覆盖');
}
// Save the initial credential before configuration, so a partially failed setup is recoverable.
writeFileSync(file, password + '\n', { flag: 'wx', mode: 0o600 });
if (production) {
  writeFileSync(
    'tmp/admin-production-bootstrap.json',
    JSON.stringify({ passwordHash: hash, sessionSecret: secret }),
    { flag: 'wx', mode: 0o600 },
  );
  for (const [name, value] of [
    ['ADMIN_PASSWORD_HASH', hash],
    ['ADMIN_SESSION_SECRET', secret],
  ]) {
    const result = spawnSync(process.execPath, [...cli, 'secret', 'put', name], {
      input: value + '\n',
      encoding: 'utf8',
    });
    if (result.status !== 0)
      throw new Error(`配置${name}失败。口令保留在${file}，不要重复初始化或覆盖已有密钥。`);
  }
} else {
  const current = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : '';
  writeFileSync(
    '.dev.vars',
    `${current}${current.endsWith('\n') ? '' : '\n'}ADMIN_PASSWORD_HASH=${hash}\nADMIN_SESSION_SECRET=${secret}\n`,
    { mode: 0o600 },
  );
}
console.log(`管理员配置完成。初始口令保存在${file}（被Git忽略），没有输出到终端。`);
