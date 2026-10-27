// Validates a data dir with the site's own loader and schema (src/lib/data.ts, src/lib/schema.ts), as a build
// would, without building. refresh.yml's v1 job runs it on the swapped data/ before committing it. When the dir has
// the engine's schema.json (a /v1/ snapshot), it also checks the site's schema against that contract
// (src/lib/contract.ts): a breaking difference fails, a field the site doesn't read is printed as a note.
//
//   npm run validate-data [-- <dir>]   (default: DATA_DIR, else ../data; relative to site/)
import fs from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const SITE = path.resolve(import.meta.dirname, '..');
const load = (rel) => runnerImport(path.join(SITE, rel), { configFile: false, root: SITE, logLevel: 'error' });

const [{ module: data }, { module: dataDir }, { module: contract }] = await Promise.all([
  load('src/lib/data.ts'),
  load('src/lib/data-dir.ts'),
  load('src/lib/contract.ts'),
]);
const dir = dataDir.resolveDataDir(process.argv[2] ?? process.env.DATA_DIR, SITE);
let failed = false;
try {
  const { events, fighters } = data.loadData(dir);
  console.log(`validate-data: ${dir} ok (${events.length} events, ${Object.keys(fighters).length} fighters)`);
} catch (err) {
  console.error(`validate-data: ${err.message}`);
  failed = true;
}
const schemaFile = path.join(dir, 'schema.json');
if (fs.existsSync(schemaFile)) {
  const { errors, notes } = contract.checkContract(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  for (const note of notes) console.log(`validate-data: ${schemaFile}: ${note}`);
  for (const error of errors) console.error(`validate-data: ${schemaFile}: ${error}`);
  failed ||= errors.length > 0;
}
if (failed) process.exit(1);
