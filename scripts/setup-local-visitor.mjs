import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// A stable, local-only secret. Never print it or replace existing developer configuration.
const path = new URL('../.dev.vars', import.meta.url);
const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
if (!/^\s*VISITOR_SECRET\s*=/m.test(existing)) {
  writeFileSync(
    path,
    `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}VISITOR_SECRET=${randomBytes(32).toString('base64url')}\n`,
    { mode: 0o600 },
  );
  console.log('已生成本地匿名访客密钥（.dev.vars，不提交 Git）。');
}
