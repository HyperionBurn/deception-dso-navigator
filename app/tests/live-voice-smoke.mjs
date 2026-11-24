// Explicit opt-in: makes one synthetic production call. Run from app/.
// node --env-file=.env.local tests/live-voice-smoke.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const origin = 'https://deception-dso-navigator.vercel.app';
const format = 'pcm_16000';
const ttsVoice = 'EXAVITQu4vr4xnSDxMaL';
const turns = [
  ['Arabic visitor', 'أبغى أروح غرفة الاجتماعات، لو سمحت.', /[\u0600-\u06ff]/, /غرفة|الاجتماعات/],
  ['English destination change', 'English please. Actually, I need the kitchen instead.', /kitchen/i, /kitchen/i],
  ['Unmapped operator anchor', 'Operator here. I am stopped at the test blue sign, facing the white door.', /blue sign/i, /verified|mapped|unable|cannot|hold/i],
];
const state = { metadata: null, audioBytes: 0, lastAudio: 0, replies: [], transcripts: [] };
let stage = 'configuration';
let socket;
let closed;

async function until(check, timeout = 16000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (closed || Date.now() >= deadline) throw new Error('Timed out waiting for a voice event');
    await pause(80);
  }
}

function send(event) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error('Voice socket is not open');
  socket.send(JSON.stringify(event));
}

async function syntheticSpeech(client, text) {
  const stream = await client.textToSpeech.convert(ttsVoice, {
    text, modelId: 'eleven_multilingual_v2', outputFormat: format,
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const pcm = Buffer.concat(chunks);
  assert(pcm.length >= 32000 && pcm.length % 2 === 0 && pcm.toString('ascii', 0, 4) !== 'RIFF');
  return Buffer.concat([Buffer.alloc(6400), pcm, Buffer.alloc(41600)]);
}

function receive({ data }) {
  const event = JSON.parse(data);
  if (event.type === 'ping') send({ type: 'pong', event_id: event.ping_event.event_id });
  if (event.type === 'conversation_initiation_metadata') state.metadata = event.conversation_initiation_metadata_event;
  if (event.type === 'user_transcript') state.transcripts.push(event.user_transcription_event.user_transcript);
  if (event.type === 'agent_response') state.replies.push(event.agent_response_event.agent_response);
  if (event.type === 'audio') {
    const pcm = Buffer.from(event.audio_event.audio_base_64, 'base64');
    if (pcm.some(byte => byte !== 0)) state.audioBytes += pcm.length;
    state.lastAudio = Date.now();
  }
}

const idle = () => Date.now() - state.lastAudio > 1100;

async function checkTool(client, conversationId) {
  let conversation;
  for (let attempt = 0; attempt < 5; attempt++) {
    conversation = await client.conversationalAi.conversations.get(conversationId);
    if (conversation.status === 'done' || conversation.status === 'failed') break;
    await pause(1200);
  }
  const route = conversation.transcript.flatMap(turn => turn.toolResults ?? []).find(result => {
    const text = JSON.stringify(result);
    return text.includes('next_route_step') && text.includes('needs_anchor');
  });
  assert(route && conversation.hasAudio === false);
  return conversation.versionId;
}

try {
  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY, timeoutInSeconds: 12 });
  const accessCode = (await readFile('.private/team-access-code.txt', 'utf8')).trim();
  assert(process.env.ELEVENLABS_API_KEY && accessCode);
  stage = 'synthetic audio';
  const frames = await Promise.all(turns.map(([, text]) => syntheticSpeech(client, text)));

  stage = 'hosted signed session';
  const response = await fetch(`${origin}/api/session`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ access_code: accessCode }), redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) console.log(`Hosted session returned HTTP ${response.status}.`);
  assert(response.ok);
  const url = new URL((await response.json()).signed_url);
  assert(url.protocol === 'wss:' && url.host === 'api.elevenlabs.io' && !url.username && !url.password);
  socket = new WebSocket(url, 'convai');
  socket.addEventListener('open', () => send({ type: 'conversation_initiation_client_data' }));
  socket.addEventListener('close', ({ code }) => { closed = code; });
  socket.addEventListener('message', receive);

  stage = 'greeting';
  await until(() => state.metadata && state.audioBytes && state.replies.length && idle());
  assert.equal(state.metadata.user_input_audio_format, format);
  assert.equal(state.metadata.agent_output_audio_format, format);
  console.log(`Greeting: ${state.audioBytes} non-silent audio bytes; ${format} in both directions.`);

  for (const [i, [label, , heard, reply]] of turns.entries()) {
    stage = label;
    const [t, r, bytes] = [state.transcripts.length, state.replies.length, state.audioBytes];
    for (let start = 0; start < frames[i].length; start += 3200) {
      send({ user_audio_chunk: frames[i].subarray(start, start + 3200).toString('base64') });
      await pause(100);
    }
    await until(() => state.transcripts.length > t && state.audioBytes > bytes
      && state.replies.slice(r).some(text => reply.test(text)) && idle(), 21000);
    assert(state.transcripts.slice(t).some(text => heard.test(text)));
    console.log(JSON.stringify({ turn: label, syntheticTranscript: state.transcripts.slice(t),
      replies: state.replies.slice(r), nonSilentReplyBytes: state.audioBytes - bytes }));
  }

  stage = 'route tool and recording policy';
  socket.close();
  await pause(800);
  const version = await checkTool(client, state.metadata.conversation_id);
  console.log(`PASS: ${version}: real route tool returned needs_anchor; provider stored no audio.`);
} catch (error) {
  // Provider error details may contain a signed URL. Emit only status and stage.
  console.error(JSON.stringify({ failed: stage, error: error.name, status: error.statusCode, closeCode: closed }));
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close();
}
