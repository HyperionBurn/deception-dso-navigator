import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { COURSE_DESTINATIONS, FLOOR_MAP } from '../lib/floor-map.mjs';
import { auditMap, planRoute } from '../lib/route-planner.mjs';
import {
  parseSurveyJson, parseSurveyText, serializeFloorMap, writeFloorMapSource,
} from '../lib/survey-ingest.mjs';

const run = promisify(execFile);
const MAP_MODULE = new URL('../lib/floor-map.mjs', import.meta.url);

const EXAMPLE = `# worked example — fictional
survey: 2026-11-24 16:40 | Wasif + Sahil | walk-1
start: A facing kitchen

anchor A: sign A by the entrance | aliases: letter A, entrance sign, اللافتة أ
anchor call_booth_2: Booth 2 sign | aliases: booth two, second booth, الكابينة الثانية
anchor C: sign C outside the call booths | aliases: letter C

leg A facing kitchen -> C : left | exit facing booths
leg C facing booths -> A : around | exit facing kitchen
leg C -> call_booth_2 : approach
`;

test('the worked example parses into a checked map that routes', () => {
  const { map, errors } = parseSurveyText(EXAMPLE);
  assert.deepEqual(errors, []);
  assert.equal(map.survey.reference, 'walk-1');
  assert.deepEqual(map.start, { anchor: 'sign_a', facing: 'kitchen' });
  assert.deepEqual(map.anchors.map(a => a.id), ['sign_a', 'call_booth_2', 'sign_c']);
  assert.equal(map.anchors[0].aliases.length, 3);
  assert.deepEqual(map.edges[0], {
    from: 'sign_a', to: 'sign_c', action: 'left_then_straight',
    entry_pose: { facing: 'kitchen' }, exit_pose: { facing: 'booths' },
  });
  assert.equal(map.edges[2].action, 'approach_visible');
  assert.equal(map.edges[2].entry_pose, null);

  const audit = auditMap(map);
  assert.deepEqual(audit.rejected, []);
  const step = planRoute(map, {
    destination_id: 'call_booth_2', current_landmark: 'sign A by the entrance',
    facing: 'kitchen',
  });
  assert.equal(step.status, 'step');
  assert.equal(step.command, 'Turn left. Walk straight and stop at sign C outside the call booths.');
  assert.equal(step.remaining_steps, 2);
});

test('aliases resolve spoken sign names to waypoints', () => {
  const { map } = parseSurveyText(EXAMPLE);
  const step = planRoute(map, {
    destination_id: 'call_booth_2', current_landmark: 'اللافتة أ', facing: 'kitchen',
  });
  assert.equal(step.status, 'step');
});

test('every strict error reports its line and yields no map output', () => {
  const cases = [
    ['bogus line here', /unrecognized line/],
    ['anchor A', /unrecognized line/],
    ['anchor 9x: bad id', /unrecognized line|bad anchor id/],
    ['anchor A: a\nanchor A: b', /duplicate anchor id/],
    ['survey: only | two', /unrecognized line/],
    ['start: A facing x\nstart: A facing y', /duplicate start/],
    ['leg A heading sideways -> B : left', /unknown heading/],
    ['leg A -> B : teleport', /unknown action/],
  ];
  for (const [source, pattern] of cases) {
    const { errors } = parseSurveyText(`anchor B: b\n${source}`);
    assert.ok(errors.length, `no error for '${source}'`);
    assert.match(errors.map(e => e.message).join(' '), pattern);
  }
});

test('legs to undeclared anchors and a self loop are rejected with line numbers', () => {
  const { errors } = parseSurveyText([
    'anchor A: a', 'anchor B: b',
    'leg A -> Z : straight',           // line 3: Z undeclared
    'leg A -> A : straight',           // line 4: self loop
    'leg A -> B : straight',
  ].join('\n'));
  assert.deepEqual(errors.map(e => e.line), [3, 4]);
});

test('JSON input takes the map shape directly and audits', () => {
  const json = JSON.stringify({
    survey: { checked_at: 't', checked_by: 't', reference: 't' },
    anchors: [{ id: 'sign_a', landmark: 'sign a' }, { id: 'kitchen', landmark: 'kitchen' }],
    edges: [{ from: 'sign_a', to: 'kitchen', action: 'walk_straight', entry_pose: null, exit_pose: null }],
  });
  const { map, errors } = parseSurveyJson(json);
  assert.deepEqual(errors, []);
  // null entry_pose on walk_straight is dropped by the planner, not the parser
  assert.equal(auditMap(map).rejected[0].reason, 'null entry_pose on non-approach action');
  assert.ok(parseSurveyJson('{').errors.length);
  assert.ok(parseSurveyJson('[]').errors.length);
});

test('serialize + writeFloorMapSource replace only the FLOOR_MAP export', async () => {
  const { map } = parseSurveyText(EXAMPLE);
  const source = await readFile(MAP_MODULE, 'utf8');
  const written = writeFloorMapSource(source, map, 'test note');
  assert.match(written, /EXAMPLE ONLY — fictional records/);
  assert.match(written, /COURSE_DESTINATIONS = Object\.freeze/);
  const dir = await mkdtemp(join(tmpdir(), 'ingest-'));
  const file = join(dir, 'floor-map.mjs');
  await writeFile(file, written);
  const { FLOOR_MAP: loaded, COURSE_DESTINATIONS: destinations } = await import(`file://${file}`);
  assert.deepEqual(destinations, COURSE_DESTINATIONS);
  assert.deepEqual(auditMap(loaded).rejected, []);
  const step = planRoute(loaded, {
    destination_id: 'call_booth_2', current_landmark: 'entrance sign', facing: 'kitchen',
  });
  assert.equal(step.status, 'step');
});

test('the CLI dry-run audits without writing', async () => {
  const example = fileURLToPath(new URL('../../qa/survey.example.txt', import.meta.url));
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const { stdout, stderr } = await run(process.execPath,
    ['scripts/ingest-survey.mjs', '--dry-run', example], { cwd });
  assert.equal(stderr, '');
  assert.match(stdout, /Dry run/);
  assert.match(stdout, /Anchors: 5 authored, 0 rejected/);
});
