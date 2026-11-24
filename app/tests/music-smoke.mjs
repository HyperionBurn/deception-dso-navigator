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

async function fetchToolCalls(convId) {
  let conversation;
  for (let i = 0; i < 10; i++) {
    conversation = await client.conversationalAi.conversations.get(convId);
    if (conversation.status === 'done' || conversation.status === 'failed') break;
    await pause(1500);
  }
  return (conversation?.transcript ?? []).flatMap(turn =>
    (turn.toolCalls ?? []).map(call => ({
      name: call.toolName, params: call.params })));
}

// ---- continuous mode: music under the whole session -------------------------

const CONTINUOUS_TURNS = [
  ['visitor request', SPEECH_TEXT],
  ['visitor yes', 'إيه'],
  ['operator position', 'Operator here, at sign A facing the kitchen.'],
];

async function synthText(text) {
  const stream = await client.textToSpeech.convert('EXAVITQu4vr4xnSDxMaL', {
    text, modelId: 'eleven_multilingual_v2', outputFormat: 'pcm_16000',
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function runContinuous() {
  const speeches = await Promise.all(
    CONTINUOUS_TURNS.map(([, text]) => synthText(text)));
  const mixes = speeches.map(pcm => mixUnderSpeech(pcm, 0));

  const state = { metadata: null, replies: [], transcripts: [],
                  interruptions: [], agentAudioAt: [], lastEventAt: 0 };
  const socket = new WebSocket(await signedUrl(), 'convai');
  const send = e => socket.send(JSON.stringify(e));
  let inject = null, injectOffset = 0, speechActive = false;
  let speechDrainedAt = 0;
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
    } else if (event.type === 'audio') {
      state.agentAudioAt.push(Date.now());
    } else if (event.type === 'user_transcript') {
      state.transcripts.push({
        at: Date.now(),
        text: event.user_transcription_event.user_transcript,
        whileSpeech: speechActive,
      });
    } else if (event.type === 'agent_response') {
      state.replies.push(event.agent_response_event.agent_response);
    } else if (event.type === 'interruption') {
      state.interruptions.push({ at: Date.now(), lastReply: state.replies.at(-1) });
    }
  });

  // Non-stop audio pump: music tiles; a queued speech mix takes over the
  // stream until drained, then music resumes — the realistic robot-mic feed.
  const pump = { stop: false };
  let musicOff = 0;
  (async () => {
    while (!pump.stop) {
      if (socket.readyState !== WebSocket.OPEN) {   // drops frames while
        if (socket.readyState === WebSocket.CLOSED) return;   // connecting
        await pause(50);
        continue;
      }
      let chunk;
      if (inject) {
        chunk = inject.subarray(injectOffset, injectOffset + 3200);
        injectOffset += 3200;
        if (injectOffset >= inject.length) {
          inject = null;
          speechActive = false;
          speechDrainedAt = Date.now();
        }
      } else {
        chunk = music.subarray(musicOff, musicOff + 3200);
        musicOff = (musicOff + 3200) % music.length;
      }
      try {
        send({ user_audio_chunk: chunk.toString('base64') });
      } catch { return; }
      await pause(95);
    }
  })();

  const waitQuiet = async (quietMs, timeout, extra = () => true) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (extra() && Date.now() - state.lastEventAt > quietMs) return true;
      await pause(200);
    }
    return false;
  };

  await waitQuiet(6000, 60000,
    () => state.metadata && state.replies.length && state.agentAudioAt.length);
  console.log('greeting:', JSON.stringify(state.replies[0] ?? '(none)'));

  const turns = [];
  for (const [i, [label, text]] of CONTINUOUS_TURNS.entries()) {
    const t0 = state.transcripts.length, r0 = state.replies.length,
          i0 = state.interruptions.length;
    inject = mixes[i];
    injectOffset = 0;
    speechActive = true;
    for (let w = 0; inject && w < 600; w++) await pause(50);
    const drainedAt = speechDrainedAt;
    await waitQuiet(9000, 90000, () => state.replies.length > r0);
    const firstReplyAudio = state.agentAudioAt.find(t => t >= drainedAt);
    turns.push({
      label, expected: text,
      latencyMs: firstReplyAudio ? firstReplyAudio - drainedAt : null,
      transcripts: state.transcripts.slice(t0),
      replies: state.replies.slice(r0),
      interruptions: state.interruptions.slice(i0),
    });
    console.log(`turn ${i + 1} (${label}) done — ` +
                `${state.replies.length - r0} replies, ` +
                `${turns.at(-1).interruptions.length} interruptions, ` +
                `latency ${turns.at(-1).latencyMs} ms`);
  }
  pump.stop = true;
  const convId = state.metadata?.conversation_id;
  socket.close();
  await pause(2000);
  const toolCalls = convId ? await fetchToolCalls(convId) : [];
  return { convId, turns, toolCalls,
           allTranscripts: state.transcripts,
           interruptions: state.interruptions };
}

function expectedMatch(turn, text) {
  const norm = s => s.toLowerCase().replace(/[.,!?؟\s]+/g, ' ').trim();
  const t = norm(text);
  const key = { 0: ['مكالمه', 'مكالمة'], 1: ['ايه', 'إيه', 'yes'],
                2: ['sign a', 'kitchen', 'operator', 'المطبخ'] }[turn];
  return key?.some(k => t.includes(k)) ?? true;
}

const CONTINUOUS = process.argv.includes('--continuous');

if (!CONTINUOUS) {
  const speech = await synthText(SPEECH_TEXT);
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
} else {
  console.log(`target=${target} mode=continuous music=0 dB under speech, ` +
              'music-only elsewhere');
  const r = await runContinuous();
  console.log('\n================ CONTINUOUS RESULTS ================');
  console.log(`conv=${r.convId}`);
  console.log(`interruptions total: ${r.interruptions.length}`);
  for (const intr of r.interruptions) {
    const near = r.allTranscripts.filter(t =>
      Math.abs(t.at - intr.at) < 4000).map(t => t.text);
    console.log(`  interruption @+${intr.at} — cut reply: ` +
                JSON.stringify(intr.lastReply)?.slice(0, 140) +
                ` | transcripts within ±4s: ${JSON.stringify(near)}`);
  }
  const inTurn = new Set(r.turns.flatMap(t => t.transcripts));
  const phantoms = r.allTranscripts.filter(t => !inTurn.has(t));
  const mismatched = r.turns.flatMap((t, i) =>
    t.transcripts.filter(tr => !expectedMatch(i, tr.text)));
  console.log(`\nphantom transcripts (outside any user turn): ` +
              JSON.stringify(phantoms.map(t => t.text)));
  console.log('transcripts not matching the sent speech: ' +
              JSON.stringify(mismatched.map(t => t.text)));
  for (const t of r.turns) {
    console.log(`\n[turn: ${t.label}] latency ${t.latencyMs} ms`);
    console.log('  ASR heard   :',
      JSON.stringify(t.transcripts.map(x =>
        `${x.text}${x.whileSpeech ? '' : ' (NO speech playing!)'}`)));
    console.log('  agent said  :', JSON.stringify(t.replies));
    console.log('  interrupts  :', t.interruptions.length);
  }
  const calls = r.toolCalls.map(c =>
    `${c.name ?? '?'} ${JSON.stringify(c.params ?? {}).slice(0, 160)}`);
  console.log('\nroute tool calls:', calls.length ? calls : '(none)');
  const booth = r.toolCalls.some(c => JSON.stringify(c).includes('call_booth'))
    || r.turns.some(t => t.replies.some(x => BOOTH_INTENT.test(x)));
  console.log(`booth intent reached: ${booth ? 'YES' : 'NO'}`);
}
