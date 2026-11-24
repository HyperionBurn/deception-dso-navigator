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

async function fetchTranscript(conversationId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const conv = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
      { headers: { 'xi-api-key': apiKey } }).then(r => r.json());
    if (conv.status === 'done' || conv.status === 'failed') {
      for (const turn of conv.transcript ?? []) {
        console.log(`  ${turn.role}: ${turn.message ?? turn.text ?? ''}`);
        for (const call of turn.tool_calls ?? turn.toolCalls ?? []) {
          console.log(`    tool call: ${JSON.stringify(call).slice(0, 300)}`);
        }
        for (const result of turn.tool_results ?? turn.toolResults ?? []) {
          console.log(`    tool result: ${JSON.stringify(result).slice(0, 500)}`);
        }
      }
      return;
    }
    await pause(1500);
  }
  console.log('  (stored conversation never reached done; transcript unavailable)');
}

async function drive(name, turns) {
  console.log(`\n===== ${name} =====`);
  const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
  url.searchParams.set('agent_id', ids.rehearsal_agent_id);
  const signed = await fetch(url, { headers: { 'xi-api-key': apiKey } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`signed-url ${r.status}`)));

  const state = {
    metadata: null, replies: [], transcripts: [],
    toolRequests: 0, toolResponses: 0, lastToolResponseAt: 0, lastEventAt: 0,
  };
  let closed = null;
  const socket = new WebSocket(signed.signed_url, 'convai');
  const send = event => socket.send(JSON.stringify(event));
  const AGENT_EVENTS = new Set(['agent_response', 'audio', 'agent_tool_request',
    'agent_tool_response', 'agent_response_correction']);
  socket.addEventListener('open', () => send({ type: 'conversation_initiation_client_data' }));
  socket.addEventListener('close', ({ code }) => { closed = code; });
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    const now = Date.now();
    if (AGENT_EVENTS.has(event.type)) state.lastEventAt = now;
    if (event.type === 'ping') send({ type: 'pong', event_id: event.ping_event.event_id });
    if (event.type === 'conversation_initiation_metadata') state.metadata = event.conversation_initiation_metadata_event;
    if (event.type === 'user_transcript') state.transcripts.push(event.user_transcription_event.user_transcript);
    if (event.type === 'agent_response') {
      state.replies.push({ text: event.agent_response_event.agent_response, at: now });
    }
    if (event.type === 'agent_tool_request') state.toolRequests += 1;
    if (event.type === 'agent_tool_response') {
      state.toolResponses += 1;
      state.lastToolResponseAt = now;
    }
  });

  // Wait for the agent to be idle: an agent_response exists since `since`, no
  // agent events for 3 s, all tool requests answered, and at least one
  // agent_response after the last tool response. Returns false on 30 s timeout.
  async function waitIdle(since) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !closed) {
      const toolsDone =
        state.toolRequests - since.toolRequests === state.toolResponses - since.toolResponses;
      const quiet = state.lastEventAt <= since.sentAt || Date.now() - state.lastEventAt > 3000;
      const replied = state.replies.length > since.replies;
      const replyAfterTools = state.toolResponses - since.toolResponses === 0 ||
        state.replies.some(reply => reply.at > state.lastToolResponseAt);
      if (replied && toolsDone && replyAfterTools && quiet) return true;
      await pause(150);
    }
    return false;
  }

  try {
    if (!await waitIdle({ replies: 0, toolRequests: 0, toolResponses: 0, sentAt: Date.now() - 60000 })) {
      verdict(`${name}: greeting`, false, `closed=${closed}`);
      return;
    }
    console.log(`AGENT: ${state.replies.at(-1).text}`);
    for (const [i, { send: text, expect, label }] of turns.entries()) {
      const since = {
        replies: state.replies.length,
        toolRequests: state.toolRequests,
        toolResponses: state.toolResponses,
        sentAt: Date.now(),
      };
      send({ type: 'user_message', text });
      console.log(`\nUSER (${label}): ${text}`);
      await waitIdle(since);
      const fresh = state.replies.slice(since.replies).map(reply => reply.text).join(' ');
      console.log(`AGENT: ${fresh}`);
      verdict(`${name} turn ${i + 1}: ${label}`, !expect || expect.test(fresh),
        expect && !expect.test(fresh) ? `wanted ${expect}` : '');
      if (!state.replies.length) break;
    }
  } finally {
    socket.close();
  }

  await pause(800);
  console.log('\n--- stored transcript ---');
  await fetchTranscript(state.metadata?.conversation_id);
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
    expect: /arrived|confirm|stop|there|booth/i },
  { label: 'operator confirms arrival', send: 'Confirmed.',
    expect: /arrived|destination|enjoy|welcome|great|booth|[؀-ۿ]/i },
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
