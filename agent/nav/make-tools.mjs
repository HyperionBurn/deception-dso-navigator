// Builds agent/nav/tools.json (the webhook tool definitions for the ElevenLabs agent).
// Run from the repo root: node agent/nav/make-tools.mjs
import { writeFileSync } from 'node:fs';

const HOST = 'https://deception-dso-navigator.vercel.app/api/nav?tool=';
const text = description => ({ type: 'string', description });

function tool(name, description, properties = {}, required = []) {
  return {
    type: 'webhook',
    name,
    description,
    api_schema: {
      url: HOST + name,
      method: 'POST',
      // The real value lives in an ElevenLabs workspace secret. Put its id here when you add the tool.
      request_headers: { 'x-navigator-route-key': { secret_id: 'REPLACE_WITH_SECRET_ID' } },
      request_body_schema: {
        type: 'object',
        required: ['session_id', ...required],
        properties: {
          session_id: { type: 'string', description: 'The session id. Filled in automatically.', dynamic_variable: 'session_id' },
          ...properties,
        },
      },
    },
    response_timeout_secs: 8,
    execution_mode: 'immediate',
    pre_tool_speech: 'off',
  };
}

const tools = [
  tool('get_state', 'Read the current position, the last words said to the operator, and a nudge if the operator has been quiet too long. Call it after a silence prompt or after a reconnect.'),
  tool('find_place', 'Match a place the visitor named, in English or Arabic, to a place on this floor. Returns one place, or a question to ask the visitor when several fit.',
    { query: text("What the visitor said, for example 'call booth' or 'kitchen'.") }, ['query']),
  tool('plan_route', 'Start a route to a place. The first call asks the operator to confirm the start point. Say say_operator word for word.',
    {
      destination_id: text('One of: meeting_room, conference_room, call_booth_1, call_booth_2, call_booth_3, call_booth_4, team_tables, kitchen.'),
      lang: text("The visitor's language: ar or en."),
    }, ['destination_id']),
  tool('confirm_step', 'Pass on what the operator said. Returns the next instruction. Always send the step_id from the last result.',
    {
      step_id: { type: 'integer', description: 'The step_id from the last tool result.' },
      result: text("The operator's reply word: ok, ready, done, stopped, yes, no, free, busy, repeat, lost, blocked, wait, see, at."),
      thing: text('What the operator sees, only when result is see or at.'),
      side: text('left or right, only when result is see.'),
    }, ['step_id', 'result']),
  tool('report_landmark', 'Fix the robot position from something the operator sees, for example the printer on the left.',
    { thing: text('What the operator sees.'), side: text('left or right') }, ['thing']),
  tool('change_destination', 'Someone asked for a different place while the robot is moving. Returns the stop instruction first and what to tell both people.',
    { destination_id: text('The new place id.'), lang: text('The language of the person who asked: ar or en.') }, ['destination_id']),
  tool('handover', 'Ask for a person. Use when you do not know, a tool fails, the position is unclear after two questions, or the visitor asks for a person.',
    { reason: text('A few words on why.') }, ['reason']),
];

writeFileSync(new URL('./tools.json', import.meta.url), `${JSON.stringify(tools, null, 2)}\n`);
console.log(`wrote ${tools.length} tools`);
