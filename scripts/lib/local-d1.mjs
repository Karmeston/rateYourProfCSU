import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function withLocalD1(args, operation) {
  if (args.length !== 2 || args[0] !== '--persist-to')
    throw new Error('请指定 --persist-to <项目内本地D1目录>');
  const project = fileURLToPath(new URL('../../', import.meta.url));
  const path = resolve(project, args[1]);
  const withinProject = relative(project, path);
  if (!withinProject || withinProject.startsWith('..') || isAbsolute(withinProject))
    throw new Error('本地D1目录必须位于本项目内');
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy({
    configPath: resolve(project, 'wrangler.jsonc'),
    persist: { path: resolve(path, 'v3') },
    remoteBindings: false,
  });
  try {
    return await operation(platform.env.DB);
  } finally {
    await platform.dispose();
  }
}
