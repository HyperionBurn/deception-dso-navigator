// Ingests a floor survey into app/lib/floor-map.mjs's FLOOR_MAP export, then
// prints the planner audit. Run: npm run map:ingest -- [path] [--dry-run]
//   path      survey file (default qa/survey.txt); .json takes the map shape directly
//   --dry-run parse + audit only; nothing is written
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSurveyJson, parseSurveyText, writeFloorMapSource } from '../lib/survey-ingest.mjs';
import { auditMap } from '../lib/route-planner.mjs';
import { printAudit } from './check-map.mjs';

const MAP_FILE = new URL('../lib/floor-map.mjs', import.meta.url);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const path = resolve(args.find(a => !a.startsWith('--')) ?? 'qa/survey.txt');

let text;
try {
  text = await readFile(path, 'utf8');
} catch {
  console.error(`Cannot read survey file: ${path}`);
  process.exit(1);
}

const { map, errors } = path.endsWith('.json') ? parseSurveyJson(text) : parseSurveyText(text);
if (errors.length || !map) {
  for (const { line, message } of errors) {
    console.error(`${path}${line ? `:${line}` : ''}: ${message}`);
  }
  console.error(`${errors.length} error(s); floor-map.mjs was NOT modified.`);
  process.exit(1);
}

if (!dryRun) {
  const source = await readFile(MAP_FILE, 'utf8');
  const note = map.survey
    ? `Surveyed ${map.survey.checked_at} by ${map.survey.checked_by} (${map.survey.reference}); ingested by scripts/ingest-survey.mjs.`
    : 'Ingested by scripts/ingest-survey.mjs.';
  await writeFile(MAP_FILE, writeFloorMapSource(source, map, note), 'utf8');
  console.log(`Wrote ${map.anchors.length} anchors and ${map.edges.length} edges to app/lib/floor-map.mjs\n`);
} else {
  console.log('Dry run — nothing written.\n');
}

const audit = auditMap(map);
printAudit(map, audit);
process.exitCode = audit.rejected.length ? 1 : 0;
