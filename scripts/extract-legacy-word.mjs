// Read legacy OLE Word files as data; no Office process or macros are executed.
// npm install --prefix tmp/course-parser --no-save --ignore-scripts word-extractor@1.0.4
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WordExtractor = require(process.env.CSU_WORD_EXTRACTOR || resolve(root, 'tmp/course-parser/node_modules/word-extractor'));
const manifest = JSON.parse(readFileSync(resolve(root, 'data/course-data/manifest.json'), 'utf8'));
const out = resolve(root, 'data/course-data/text');
mkdirSync(out, { recursive: true });
const results = [];
for (const source of manifest.filter(x => x.status === 'downloaded' && x.local_file?.endsWith('.doc'))) {
  try {
    const doc = await new WordExtractor().extract(resolve(root, source.local_file));
    const text = doc.getBody();
    writeFileSync(resolve(out, `${source.id}.txt`), text, 'utf8');
    results.push({ id: source.id, characters: text.length, status: 'extracted' });
    console.log(`${source.id}: ${text.length} characters`);
  } catch (error) {
    results.push({ id: source.id, status: 'failed', error: String(error) });
    console.log(`${source.id}: failed`);
  }
}
writeFileSync(resolve(out, 'legacy-extraction.json'), JSON.stringify(results, null, 2) + '\n');
