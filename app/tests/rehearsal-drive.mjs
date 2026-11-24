// Explicit opt-in: drives the REHEARSAL agent over its ConvAI websocket with
// text user turns against the fictional rehearsal map (preview deployment).
// Prints every turn + tool calls and a PASS/FAIL line per expectation.
// Run from app/:  node --env-file=.env.local tests/rehearsal-drive.mjs
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';

const ids = JSON.parse(await readFile('.private/rehearsal-ids.json', 'utf8'));
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY missing (run with --env-file=.env.local)');
  process.exit(1);
}

const results = [];
function verdict(label, ok, detail = '') {
  results.push([label, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function drive(name, turns) {
  console.log(`\n===== ${name} =====`);
  const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
  url.searchParams.set('agent_id', ids.rehearsal_agent_id);
  const signed = await fetch(url, { headers: { 'xi-api-key': apiKey } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`signed-url ${r.status}`)));

  const state = { metadata: null, replies: [], transcripts: [], tools: [] };
  let closed = null;
  const socket = new WebSocket(signed.signed_url, 'convai');
  const send = event => socket.send(JSON.stringify(event));
  socket.addEventListener('open', () => send({ type: 'conversation_initiation_client_data' }));
  socket.addEventListener('close', ({ code }) => { closed = code; });
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'ping') send({ type: 'pong', event_id: event.ping_event.event_id });
    if (event.type === 'conversation_initiation_metadata') state.metadata = event.conversation_initiation_metadata_event;
    if (event.type === 'user_transcript') state.transcripts.push(event.user_transcription_event.user_transcript);
    if (event.type === 'agent_response') state.replies.push(event.agent_response_event.agent_response);
    if (event.type === 'agent_tool_request') state.tools.push(event);
    if (event.type === 'agent_tool_response') state.tools.push(event);
  });

  async function until(check, timeout = 25000) {
    const deadline = Date.now() + timeout;
    while (!check()) {
      if (closed || Date.now() >= deadline) return false;
      await pause(150);
    }
    return true;
  }

  try {
    if (!await until(() => state.metadata && state.replies.length, 20000)) {
      verdict(`${name}: greeting`, false, `closed=${closed}`);
      return;
    }
    console.log(`AGENT: ${state.replies.at(-1)}`);
    for (const [i, { send: text, expect, label }] of turns.entries()) {
      const at = state.replies.length;
      send({ type: 'user_message', text });
      console.log(`\nUSER (${label}): ${text}`);
      const heard = await until(() => {
        const fresh = state.replies.slice(at).join(' ');
        return state.replies.length > at && (!expect || expect.test(fresh));
      });
      const fresh = state.replies.slice(at).join(' ');
      console.log(`AGENT: ${fresh}`);
      verdict(`${name} turn ${i + 1}: ${label}`, heard && (!expect || expect.test(fresh)),
        heard ? '' : 'timed out waiting for matching reply');
      if (!heard) break;  // a missed expectation derails the rest of the script
    }
  } finally {
    socket.close();
  }

  await pause(1500);
  // Fetch the stored conversation for tool-call evidence.
  try {
    const conv = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${state.metadata.conversation_id}`,
      { headers: { 'xi-api-key': apiKey } }).then(r => r.json());
    const toolCalls = (conv.transcript ?? []).flatMap(turn => turn.tool_results ?? turn.toolResults ?? []);
    console.log('\n--- stored tool calls ---');
    for (const call of toolCalls) console.log(JSON.stringify(call).slice(0, 400));
    console.log(`--- ${(conv.transcript ?? []).length} transcript turns stored ---`);
    return toolCalls;
  } catch (error) {
    console.log('conversation fetch failed:', error.message);
    return [];
  }
}

// Run A: full multi-leg route — clarify, position report, two legs, arrival.
const runA = [
  { label: 'visitor asks for a call', send: 'Hi, I need a quiet place to take a call.',
    expect: /booth|call|which|any/i },
  { label: 'visitor picks any booth', send: 'Any booth is fine, the closest one.',
    expect: /operator|position|stop|where|landmark|sign/i },
  { label: 'operator at sign A facing stage',
    send: 'Operator here. We are stopped at sign A, facing the stage.',
    expect: /operator/i },
  { label: 'operator reports first leg done', send: 'Done.',
    expect: /operator|booth|sign/i },
  { label: 'operator reports second leg done', send: 'Done.',
    expect: /arrived|confirm|stop|there/i },
  { label: 'operator confirms arrival', send: 'Confirmed.',
    expect: /arrived|destination|enjoy|welcome|great/i },
];

// Run B: destination change mid-route after the first leg completes.
const runB = [
  { label: 'visitor asks for a call', send: 'Hi, I need a quiet place to take a call.',
    expect: /booth|call|which|any/i },
  { label: 'visitor picks any booth', send: 'Any booth is fine.',
    expect: /operator|position|stop|where|landmark|sign/i },
  { label: 'operator at sign A facing stage',
    send: 'Operator here. We are stopped at sign A, facing the stage.',
    expect: /operator/i },
  { label: 'operator reports first leg done', send: 'Done.',
    expect: /operator|booth|sign/i },
  { label: 'visitor changes destination to kitchen',
    send: 'Excuse me, actually take me to the kitchen instead.',
    expect: /operator|stop|kitchen/i },
];

await drive('Run A: full route to a call booth', runA);
await drive('Run B: mid-route destination change', runB);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} expectations passed =====`);
process.exitCode = failed.length ? 1 : 0;
