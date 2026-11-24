import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opposite, relTurn } from '../lib/nav/headings.mjs';
import { validateMap, cueFor, wordCount } from '../lib/nav/map.mjs';
import { DEMO_MAP } from '../lib/nav/demo-map.mjs';
import { planLegs, legsToInstructions, legsCost } from '../lib/nav/planner.mjs';

const PLACES = Object.entries(DEMO_MAP.nodes).filter(([, n]) => n.type === 'place').map(([id]) => id);
const clone = value => structuredClone(value);

test('heading math: opposite and relative turns', () => {
  assert.equal(opposite('N'), 'S');
  assert.equal(opposite('E'), 'W');
  assert.equal(relTurn('N', 'N'), 'straight');
  assert.equal(relTurn('N', 'E'), 'right');
  assert.equal(relTurn('N', 'W'), 'left');
  assert.equal(relTurn('N', 'S'), 'around');
  assert.equal(relTurn('E', 'N'), 'left');
});

test('the demo map is valid, marked as demo, and uses all eight course places', () => {
  assert.deepEqual(validateMap(DEMO_MAP), { ok: true, errors: [] });
  assert.equal(DEMO_MAP.meta.demo, true);
  assert.deepEqual([...PLACES].sort(), [
    'call_booth_1', 'call_booth_2', 'call_booth_3', 'call_booth_4',
    'conference_room', 'kitchen', 'meeting_room', 'team_tables',
  ]);
});

test('validator rejects compass words in cues, overlong cues, bad edges and missing evidence', () => {
  const compass = clone(DEMO_MAP);
  compass.nodes.kitchen.cue = 'the kitchen is to the north';
  assert.match(validateMap(compass).errors.join('|'), /compass/);

  const long = clone(DEMO_MAP);
  long.nodes.kitchen.cue = 'the kitchen counter is right there in front of you at the end of the hall';
  assert.match(validateMap(long).errors.join('|'), /too long/);

  const badEdge = clone(DEMO_MAP);
  badEdge.edges.push({ id: 'ex', a: 'start', b: 'nowhere', h: 'N', steps: 3 });
  assert.match(validateMap(badEdge).errors.join('|'), /nowhere/);

  const noSee = clone(DEMO_MAP);
  delete noSee.nodes.kitchen.see;
  assert.match(validateMap(noSee).errors.join('|'), /see/);

  const unconnected = clone(DEMO_MAP);
  unconnected.nodes.island = { name: 'island', type: 'junction', cue: 'you reach the island' };
  assert.match(validateMap(unconnected).errors.join('|'), /island/);

  const real = clone(DEMO_MAP);
  real.meta.demo = false;
  assert.match(validateMap(real).errors.join('|'), /checked_by/, 'a real map needs who measured each entry');
});

test('cueFor picks the cue for the arrival heading and falls back to a plain one', () => {
  assert.equal(cueFor(DEMO_MAP, 'call_booth_2', 'E'), 'the door of booth two is on your left');
  assert.equal(cueFor(DEMO_MAP, 'call_booth_2', 'W'), 'the door of booth two is on your right');
  assert.equal(cueFor(DEMO_MAP, 'call_booth_2', 'N'), 'you reach booth two');
});

test('plans start to booth two: walk, turn right, walk (one action each)', () => {
  const legs = planLegs(DEMO_MAP, 'start', 'N', 'call_booth_2');
  const steps = legsToInstructions(DEMO_MAP, 'N', legs);
  assert.deepEqual(steps.map(s => s.kind), ['walk', 'turn', 'walk']);
  assert.equal(steps[0].steps, 22);
  assert.equal(steps[1].dir, 'right');
  assert.equal(steps[2].steps, 10);
  assert.equal(steps[1].say, 'Operator, turn right.');
  assert.equal(steps[2].say, 'Operator, walk straight until the door of booth two is on your left.');
});

test('prefers fewer turns: the kitchen is one straight walk', () => {
  const steps = legsToInstructions(DEMO_MAP, 'N', planLegs(DEMO_MAP, 'start', 'N', 'kitchen'));
  assert.deepEqual(steps.map(s => s.kind), ['walk']);
  assert.equal(steps[0].steps, 36);
});

test('every instruction for every place from every node is one action and 12 words or fewer after "Operator,"', () => {
  let count = 0;
  for (const node of Object.keys(DEMO_MAP.nodes)) {
    for (const heading of ['N', 'E', 'S', 'W']) {
      for (const dest of PLACES) {
        if (node === dest) continue;
        const legs = planLegs(DEMO_MAP, node, heading, dest);
        assert.ok(legs, `no route ${node}/${heading} -> ${dest}`);
        for (const step of legsToInstructions(DEMO_MAP, heading, legs)) {
          assert.match(step.say, /^Operator, /);
          assert.ok(wordCount(step.say.replace(/^Operator,/, '')) <= 12, step.say);
          assert.ok(['turn', 'walk'].includes(step.kind));
          count++;
        }
      }
    }
  }
  assert.ok(count > 100);
});

test('turning around is chosen when the destination is behind us', () => {
  const legs = planLegs(DEMO_MAP, 'booth_corner', 'N', 'team_tables');
  const steps = legsToInstructions(DEMO_MAP, 'N', legs);
  assert.equal(steps[0].kind, 'turn');
  assert.equal(steps[0].dir, 'around');
});

test('legsCost adds a turn penalty and returns null planning for unknown places', () => {
  const straight = planLegs(DEMO_MAP, 'start', 'N', 'kitchen');
  assert.equal(legsCost(straight, 'N'), 36);
  assert.equal(legsCost(straight, 'E'), 36 + 6, 'a first turn costs extra');
  assert.equal(planLegs(DEMO_MAP, 'start', 'N', 'nowhere'), null);
});
