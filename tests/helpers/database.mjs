import { readFileSync, readdirSync } from 'node:fs';

const migrations = new URL('../../migrations/', import.meta.url);

// Apply production migrations in order to the caller's temporary D1 database.
// These files contain simple statements, with no triggers or embedded semicolons.
export async function migrate(db) {
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    const source = readFileSync(new URL(name, migrations), 'utf8');
    for (const statement of source.split(';').filter((sql) => sql.trim())) {
      await db.prepare(statement).run();
    }
  }
}
