// Opt-in: take-2 simulation — hold music under a synthetic Arabic visitor
// request at three loudness levels, streamed to the agent as real audio.
// Run from app/: node --env-file=.env.local tests/music-smoke.mjs [rehearsal]
// (default target is PROD; "rehearsal" goes direct to the rehearsal agent id).
import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const ORIGIN = 'https://deception-dso-navigator.vercel.app';
const MUSIC_PCM = new URL('../../.cache/hold-music.pcm', import.meta.url);
const SPEECH_TEXT = 'أبغى مكان هادي أسوي فيه مكالمة';
const LEVELS_DB = [-12, -6, 0];
const BOOTH_INTENT = /booth|كابينة|كشك|مكالمة|اتصال|call/i;

const target = process.argv[2] === 'rehearsal' ? 'rehearsal' : 'prod';
const apiKey = process.env.ELEVENLABS_API_KEY;
const accessCode = readFileSync('.private/team-access-code.txt', 'utf8').trim();
if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');
if (!existsSync(MUSIC_PCM)) {
  throw new Error('missing .cache/hold-music.pcm — decode the mp3 with ' +
    'ffmpeg -i .cache/hold-music.mp3 -ar 16000 -ac 1 -f s16le .cache/hold-music.pcm');
}
const music = readFileSync(MUSIC_PCM);
const client = new ElevenLabsClient({ apiKey, timeoutInSeconds: 30 });

async function signedUrl() {
  if (target === 'rehearsal') {
    const { rehearsal_agent_id } = JSON.parse(
      readFileSync('.private/rehearsal-ids.json', 'utf8'));
    const res = await fetch(
      'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url' +
      `?agent_id=${rehearsal_agent_id}`,
      { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) throw new Error(`get-signed-url ${res.status}`);
    return (await res.json()).signed_url;
  }
  const res = await fetch(`${ORIGIN}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ access_code: accessCode }),
  });
  if (!res.ok) throw new Error(`/api/session ${res.status}`);
  return (await res.json()).signed_url;
}

async function synthSpeech() {
  const stream = await client.textToSpeech.convert('EXAVITQu4vr4xnSDxMaL', {
    text: SPEECH_TEXT, modelId: 'eleven_multilingual_v2',
    outputFormat: 'pcm_16000',
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function rms(pcm) {
  let sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / (pcm.length / 2));
}

function mixUnderSpeech(speech, db) {
  const target = rms(speech) * Math.pow(10, db / 20);
  const tiled = Buffer.alloc(speech.length);
  for (let off = 0; off < tiled.length; off += music.length) {
    music.copy(tiled, off, 0, Math.min(music.length, tiled.length - off));
  }
  const gain = target / rms(tiled);
  const out = Buffer.alloc(speech.length);
  for (let i = 0; i + 1 < out.length; i += 2) {
    const s = speech.readInt16LE(i) + tiled.readInt16LE(i) * gain;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s))), i);
  }
  return Buffer.concat([Buffer.alloc(6400), out, Buffer.alloc(41600)]);
}

async function runLevel(db, speechPcm) {
  const state = { metadata: null, transcripts: [], replies: [], tools: [],
                  lastEventAt: 0 };
  const socket = new WebSocket(await signedUrl(), 'convai');
  const send = e => socket.send(JSON.stringify(e));
  socket.addEventListener('open',
    () => send({ type: 'conversation_initiation_client_data' }));
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    state.lastEventAt = Date.now();
    if (event.type === 'ping') {
      return send({ type: 'pong', event_id: event.ping_event.event_id });
    }
    if (event.type === 'conversation_initiation_metadata') {
      state.metadata = event.conversation_initiation_metadata_event;
    } else if (event.type === 'user_transcript') {
      state.transcripts.push(event.user_transcription_event.user_transcript);
    } else if (event.type === 'agent_response') {
      state.replies.push(event.agent_response_event.agent_response);
    } else if (event.type.includes('tool')) {
      state.tools.push(event);
    }
  });
  const idle = async (quietMs, timeout = 90000) => {
    const deadline = Date.now() + timeout;
    state.lastEventAt = Date.now();
    while (Date.now() < deadline) {
      if (Date.now() - state.lastEventAt > quietMs) return;
      await pause(200);
    }
  };
  await idle(6000);                                  // greeting settles
  const t0 = state.transcripts.length, r0 = state.replies.length;
  const mix = mixUnderSpeech(speechPcm, db);
  for (let i = 0; i < mix.length; i += 3200) {
    send({ user_audio_chunk: mix.subarray(i, i + 3200).toString('base64') });
    await pause(90);
  }
  await idle(10000);
  const convId = state.metadata?.conversation_id;
  socket.close();
  let toolCalls = state.tools;
  if (convId) {
    let conversation;
    for (let i = 0; i < 10; i++) {
      conversation = await client.conversationalAi.conversations.get(convId);
      if (conversation.status === 'done' || conversation.status === 'failed') break;
      await pause(1500);
    }
    toolCalls = toolCalls.concat(
      (conversation?.transcript ?? []).flatMap(turn =>
        (turn.toolCalls ?? []).map(call => ({
          name: call.toolName, params: call.params }))));
  }
  return { db, convId, heard: state.transcripts.slice(t0),
           replies: state.replies.slice(r0), toolCalls };
}

const speech = await synthSpeech();
console.log(`target=${target} speech=${speech.length / 2 / 16000}s ` +
            `music=${music.length / 2 / 16000}s phrase="${SPEECH_TEXT}"`);
const results = [];
for (const db of LEVELS_DB) {
  console.log(`\n-- level ${db} dB --`);
  results.push(await runLevel(db, speech));
}
console.log('\n================ RESULTS ================');
for (const r of results) {
  const calls = r.toolCalls.map(c =>
    `${c.name ?? c.tool_name ?? '?'}${JSON.stringify(c.params ?? c).slice(0, 160)}`);
  const boothTool = r.toolCalls.some(c =>
    JSON.stringify(c).includes('call_booth'));
  const boothSpoken = r.replies.some(t => BOOTH_INTENT.test(t));
  console.log(`\n[${r.db} dB] conv=${r.convId}`);
  console.log('  ASR heard   :', JSON.stringify(r.heard));
  console.log('  agent said  :', JSON.stringify(r.replies));
  console.log('  tool calls  :', calls.length ? calls : '(none)');
  console.log(`  booth intent: ${boothTool ? 'TOOL call_booth' : ''}` +
              `${boothSpoken ? ' spoken' : ''}` +
              `${boothTool || boothSpoken ? '' : ' NOT REACHED'}`);
}
