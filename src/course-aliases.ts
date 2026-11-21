import type { MiddlewareHandler } from 'hono';
import { courseAliases } from '../shared/course-aliases.ts';
import { readVisitor, type AppEnv } from './visitor.ts';

export const redirectCourseAlias: MiddlewareHandler<AppEnv> = async (c, next) => {
  const match = /^\/api\/courses\/(-?[1-9]\d*)(\/.*)?$/.exec(c.req.path);
  if (!match) return next();
  const id = Number(match[1]);
  const alias = courseAliases.find((row) => row.oldId === id);
  if (!alias) return next();
  if (c.req.method !== 'GET' && !await readVisitor(c)) return next();
  // Validate the stored code before redirecting a known historical ID.
  const canonical = await c.env.DB.prepare(`SELECT target.id FROM courses old
    JOIN courses target ON target.code=? AND target.name=old.name
    WHERE old.id=? AND old.code=? AND target.is_listed=1`)
    .bind(alias.code, id, alias.alias).first<{ id: number }>();
  if (!canonical) return next();
  const url = new URL(c.req.url);
  url.pathname = `/api/courses/${canonical.id}${match[2] ?? ''}`;
  c.header('Cache-Control', 'no-store');
  return c.redirect(url.href, 307);
};
