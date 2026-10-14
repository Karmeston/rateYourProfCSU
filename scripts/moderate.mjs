import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLocalD1 } from './lib/local-d1.mjs';
import { withRemoteD1 } from './lib/remote-d1.mjs';

import { moderate, inspect, queue } from '../src/moderation.ts';
export { moderate, inspect, queue };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    remote = args[0] === '--remote',
    prefixLength = remote ? 1 : 2;
  const rest = args.slice(prefixLength),
    [command, kind, id, revision, reason] = rest;
  const operation =
    command === 'queue' && rest.length === 1
      ? queue
      : command === 'inspect' && rest.length === 3
        ? (db) => inspect(db, kind, id)
        : rest.length === 5
          ? (db) => moderate(db, { kind, id, action: command, revision: Number(revision), reason })
          : null;
  if (!operation)
    throw new Error(
      '用法：--persist-to <本地目录> 或 --remote，随后 queue | inspect <类型> <UUID> | <操作> <类型> <UUID> <版本> <理由>',
    );
  console.log(
    JSON.stringify(
      await (remote ? withRemoteD1(operation) : withLocalD1(args.slice(0, 2), operation)),
      null,
      2,
    ),
  );
}
