// Validates a data dir with the site's own loader and schema (src/lib/data.ts, src/lib/schema.ts), as a build
// would, without building. refresh.yml's v1 job runs it on the swapped data/ before committing it.
//
//   npm run validate-data [-- <dir>]   (default: DATA_DIR, else ../data; relative to site/)
import path from 'node:path';
import { runnerImport } from 'vite';

const SITE = path.resolve(import.meta.dirname, '..');
const load = (rel) => runnerImport(path.join(SITE, rel), { configFile: false, root: SITE, logLevel: 'error' });

const [{ module: data }, { module: dataDir }] = await Promise.all([
  load('src/lib/data.ts'),
  load('src/lib/data-dir.ts'),
]);
const dir = dataDir.resolveDataDir(process.argv[2] ?? process.env.DATA_DIR, SITE);
try {
  const { events, fighters } = data.loadData(dir);
  console.log(`validate-data: ${dir} ok (${events.length} events, ${Object.keys(fighters).length} fighters)`);
} catch (err) {
  console.error(`validate-data: ${err.message}`);
  process.exit(1);
}
