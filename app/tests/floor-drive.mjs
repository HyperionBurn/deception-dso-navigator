// Explicit opt-in: drives the PRODUCTION agent over its ConvAI websocket with
// text user turns against the real floor map (production deployment).
// Prints every turn + tool calls and a PASS/FAIL line per expectation.
// Run from app/:  node --env-file=.env.local tests/floor-drive.mjs
import { setTimeout as pause } from 'node:timers/promises';

const agentId = process.env.ELEVENLABS_AGENT_ID?.trim() || 'agent_0101m86hthvjfm6vqeymg81may5e';
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY missing (run with --env-file=.env.local)');
  process.exit(1);
}

// Words that must never be spoken: tool names, field names, statuses, self-commentary.
const LEAK = /tool call|next_route_step|research_fact|destination_id|current_id|current_landmark|needs_anchor|unverified|switched to|continue in english/i;
// Longest spoken reply allowed in one turn, in words.
const MAX_WORDS = 30;
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
  url.searchParams.set('agent_id', agentId);
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
    for (const [i, { send: text, expect, reject, label, context }] of turns.entries()) {
      const since = {
        replies: state.replies.length,
        toolRequests: state.toolRequests,
        toolResponses: state.toolResponses,
        sentAt: Date.now(),
      };
      for (const note of context ?? []) {
        send({ type: 'contextual_update', text: note });
        console.log(`
CAMERA NOTE: ${note}`);
        await pause(400);
      }
      send({ type: 'user_message', text });
      console.log(`\nUSER (${label}): ${text}`);
      await waitIdle(since);
      const fresh = state.replies.slice(since.replies).map(reply => reply.text).join(' ');
      console.log(`AGENT: ${fresh}`);
      const missing = expect && !expect.test(fresh);
      const unwanted = reject && reject.test(fresh);
      const leaked = LEAK.test(fresh);
      const words = fresh.split(/\s+/u).filter(Boolean).length;
      verdict(`${name} turn ${i + 1}: ${label}`,
        !missing && !unwanted && !leaked && words <= MAX_WORDS,
        [missing ? `wanted ${expect}` : '', unwanted ? `must not match ${reject}` : '',
          leaked ? 'spoke internal words' : '',
          words > MAX_WORDS ? `too long: ${words} words` : ''].filter(Boolean).join('; '));
      if (!state.replies.length) break;
    }
  } finally {
    socket.close();
  }

  await pause(800);
  console.log('\n--- stored transcript ---');
  await fetchTranscript(state.metadata?.conversation_id);
}

// Run A: Arabic visitor, start to the kitchen, three legs, arrival.
const runA = [
  { label: 'visitor is hungry (Arabic)', send: 'السلام عليكم، أنا جوعان، وين أقدر آكل؟',
    expect: /المطبخ|الكافتيريا|kitchen|cafeteria/i },
  { label: 'visitor confirms kitchen', send: 'إيه، المطبخ.',
    expect: /operator/i },
  { label: 'operator at pitch room door facing reception',
    send: 'Operator here. We are at the pitch room door, facing reception.',
    expect: /purple pillar/i },
  { label: 'first leg done', send: 'Done.', expect: /yellow pillar/i },
  { label: 'second leg done', send: 'Done.', expect: /turn left[\s\S]*menu boards/i },
  { label: 'third leg done', send: 'Done.', expect: /confirm|menu boards/i },
  { label: 'operator confirms arrival', send: 'Confirmed.',
    expect: /[؀-ۿ]/ },
];

// Run B: return direction, change to an unmapped place, then an "other place" question.
const runB = [
  { label: 'visitor asks for team tables', send: 'Hi, take me to the team tables please.',
    expect: /operator|team tables/i },
  { label: 'operator at cafeteria facing menu boards',
    send: 'Operator. We are at the cafeteria menu boards, facing the menu boards.',
    expect: /turn around[\s\S]*yellow pillar/i },
  { label: 'first leg done', send: 'Done.', expect: /turn right[\s\S]*purple pillar/i },
  { label: 'visitor changes to a call booth', send: 'Sorry, actually I need a call booth instead.',
    expect: /stop/i },
  { label: 'visitor confirms any booth', send: 'Yes, any booth is fine.',
    expect: /mapped|team tables|kitchen|cafeteria/i },
  { label: 'visitor asks for the toilets', send: 'Okay. Where are the toilets?',
    expect: /whiteboard|main hall|reception|staircase/i, reject: /[؀-ۿ]/ },
];

// Run C: English visitor asks for an unmapped place first, then the kitchen; the
// operator gives the facing by naming the next landmark. No Arabic at any point.
const arabic = /[؀-ۿ]/;
const runC = [
  { label: 'visitor asks for the meeting room (unmapped)',
    send: 'Hello, can you take me to the meeting room?',
    expect: /mapped/i, reject: /going to the meeting room|[؀-ۿ]/i },
  { label: 'visitor picks the kitchen', send: 'Okay, the kitchen then.',
    expect: /operator/i, reject: arabic },
  { label: 'operator gives facing by landmark',
    send: 'Operator. The robot is at the purple pillar, facing the yellow pillar.',
    expect: /walk straight[\s\S]*yellow pillar/i, reject: arabic },
  { label: 'first leg done', send: 'Done.', expect: /turn left[\s\S]*menu boards/i, reject: arabic },
  { label: 'second leg done', send: 'Done.', expect: /confirm|menu boards/i, reject: arabic },
  { label: 'operator confirms arrival', send: 'Yes, confirmed.',
    expect: /arrived|here|kitchen|cafeteria/i, reject: arabic },
];

// Run D: the agent proposes the start position; the operator only says yes.
const runD = [
  { label: 'visitor asks for the kitchen', send: 'Take me to the kitchen please.',
    expect: /are we at the pitch room door[\s\S]*reception/i, reject: arabic },
  { label: 'operator says yes', send: 'Yes.',
    expect: /walk straight[\s\S]*purple pillar/i, reject: arabic },
  { label: 'first leg done', send: 'Done.', expect: /yellow pillar/i, reject: arabic },
];

// Run E: the camera suggests the start; the operator confirms it and the arrival.
const runE = [
  { label: 'camera suggests the position; visitor asks for the kitchen',
    context: ['Camera: the robot seems to be at the yellow pillar, facing reception.'],
    send: 'Take me to the kitchen please.',
    expect: /camera[\s\S]*yellow pillar/i, reject: /where is the robot|pitch room door/i },
  { label: 'operator confirms the camera', send: 'Yes.',
    expect: /turn left[\s\S]*menu boards/i, reject: arabic },
  { label: 'camera sees the menu boards; operator still confirms the arrival',
    context: ['Camera: the robot seems to be at the cafeteria menu boards, facing menu boards.'],
    send: 'Done.', expect: /confirm/i, reject: arabic },
  { label: 'operator confirms arrival', send: 'Yes.', expect: /arrived|kitchen/i, reject: arabic },
];

// Run F: the operator gives a vague position; the camera note turns it into a yes/no.
const runF = [
  { label: 'visitor asks for the kitchen', send: 'Take me to the kitchen please.',
    expect: /are we at the pitch room door/i, reject: arabic },
  { label: 'operator is vague; camera knows',
    context: ['Camera: the robot seems to be at the purple pillar, facing reception.'],
    send: "No. I'm facing a lot of tables.",
    expect: /camera[\s\S]*purple pillar/i, reject: /where is the robot/i },
  { label: 'operator confirms the camera', send: 'Yes.',
    expect: /walk straight[\s\S]*yellow pillar/i, reject: arabic },
];

// Run G: asked about the camera before it has recognised anything.
const runG = [
  { label: 'visitor asks for the kitchen', send: 'Take me to the kitchen please.',
    expect: /are we at the pitch room door/i, reject: arabic },
  { label: 'operator asks the agent to use the camera', send: 'Can you use the camera and tell me?',
    expect: /camera/i, reject: /printed|\bsigns?\b/i },
];

await drive('Run A: Arabic visitor to the kitchen', runA);
await drive('Run B: return leg, unmapped change, other place', runB);
await drive('Run C: English visitor, unmapped then kitchen, facing by landmark', runC);
await drive('Run D: operator confirms the likely start with one word', runD);
await drive('Run E: camera suggests the start, operator confirms', runE);
await drive('Run F: vague operator answer, camera yes/no', runF);
await drive('Run G: camera question before any recognition', runG);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} expectations passed =====`);
process.exitCode = failed.length ? 1 : 0;
