import type { CourseCatalog } from '../shared/catalog.ts';
import type { Context } from 'hono';
import { readPublicCache, writePublicCache } from './public-cache.ts';
import { reserveQuota } from './quota-guard.ts';
import type { AppEnv } from './visitor.ts';

type Facets = CourseCatalog['facets'];

export async function readCatalogFacets(c: Context<AppEnv>) {
  // The options are public and identical for every page and visitor.
  const key = new URL('/api/courses/facets?v=1', c.req.url).href;
  const cached = await readPublicCache<Facets>(key);
  if (cached) return cached;
  const blocked = await reserveQuota(c, 'facets');
  if (blocked) return blocked;
  const facets = await queryFacets(c.env.DB);
  await writePublicCache(key, facets, 3600);
  return facets;
}

async function queryFacets(db: D1Database): Promise<Facets> {
  const [departments, planRows] = await db.batch([
    db.prepare(
      'SELECT department AS name, count(*) AS count FROM courses WHERE is_listed=1 GROUP BY department ORDER BY department',
    ),
    db.prepare(`SELECT m.program AS name, m.source_year AS year FROM course_materials m
      JOIN courses c ON c.id=m.course_id WHERE c.is_listed=1 AND m.kind='curriculum' AND m.program IS NOT NULL
      UNION SELECT p.program AS name, p.source_year AS year FROM course_catalog_records p
      JOIN courses c ON c.id=p.course_id WHERE c.is_listed=1 AND p.program IS NOT NULL
      ORDER BY name, year DESC`),
  ]);
  const programs = new Map<string, (number | null)[]>();
  for (const { name, year } of planRows.results as { name: string; year: number | null }[]) {
    const years = programs.get(name);
    if (years) years.push(year);
    else programs.set(name, [year]);
  }
  return {
    departments: departments.results as Facets['departments'],
    programs: [...programs].map(([name, years]) => ({ name, years })),
  };
}
