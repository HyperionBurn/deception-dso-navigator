// Opt-in live rehearsal of the stage agent through the production path.
// Run from app/: node --env-file=.env.local tests/stage-rehearsal.mjs
// Hard limit: 150 s. Costs one short stage conversation.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const origin = 'https://deception-dso-navigator.vercel.app';
const format = 'pcm_16000';
const RATE = 16000;
const ttsVoice = 'EXAVITQu4vr4xnSDxMaL';
const wavPath = new URL('../../.cache/verify/stage-bit.wav', import.meta.url);
const results = [];
const warnings = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const warn = (name, detail) => { warnings.push(name); console.log(`WARN ${name} — ${detail}`); };

const watchdog = setTimeout(() => {
  console.error('FAIL rehearsal exceeded the 150 s limit');
  process.exit(2);
}, 150_000);
watchdog.unref();

const state = {
  metadata: null, replies: [], transcripts: [],
  audioChunks: [], audioBytes: 0, lastAudio: 0, firstAudioAt: 0,
};
let socket;
let closed = null;

async function until(checkFn, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!checkFn()) {
    if (closed || Date.now() >= deadline) throw new Error('Timed out waiting for a voice event');
    await pause(80);
  }
}

function send(event) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error('Voice socket is not open');
  socket.send(JSON.stringify(event));
}

async function streamPcm(pcm, chunkMs = 100) {
  for (let start = 0; start < pcm.length; start += 3200) {
    send({ user_audio_chunk: pcm.subarray(start, start + 3200).toString('base64') });
    await pause(chunkMs);
  }
}

function silencePcm(ms) {
  return Buffer.alloc(RATE * 2 * ms / 1000);
}

function noisePcm(ms, amplitude = 300) {
  const samples = RATE * ms / 1000;
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round((Math.random() * 2 - 1) * amplitude), i * 2);
  }
  return buf;
}

function wavBuffer(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function receive({ data }) {
  const event = JSON.parse(data);
  if (event.type === 'ping') send({ type: 'pong', event_id: event.ping_event.event_id });
  if (event.type === 'conversation_initiation_metadata') state.metadata = event.conversation_initiation_metadata_event;
  if (event.type === 'user_transcript') state.transcripts.push(event.user_transcription_event.user_transcript);
  if (event.type === 'agent_response') state.replies.push(event.agent_response_event.agent_response);
  if (event.type === 'audio') {
    const pcm = Buffer.from(event.audio_event.audio_base_64, 'base64');
    state.audioChunks.push(pcm);
    state.lastAudio = Date.now();
    if (pcm.some(byte => byte !== 0)) {
      state.audioBytes += pcm.length;
      if (!state.firstAudioAt) state.firstAudioAt = Date.now();
    }
  }
}

const idle = () => Date.now() - state.lastAudio > 3000;
const replyText = () => state.replies.join(' ');

try {
  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY, timeoutInSeconds: 12 });
  const accessCode = (await readFile('.private/team-access-code.txt', 'utf8')).trim();
  assert(process.env.ELEVENLABS_API_KEY && accessCode);

  // Synthesize the question while the session is still being set up.
  const speechPromise = (async () => {
    const stream = await client.textToSpeech.convert(ttsVoice, {
      text: 'Can you tell me where we are?', modelId: 'eleven_multilingual_v2', outputFormat: format,
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const pcm = Buffer.concat(chunks);
    return Buffer.concat([Buffer.alloc(6400), pcm, Buffer.alloc(41600)]);
  })();

  // 1. Production session path, stage agent.
  const response = await fetch(`${origin}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ access_code: accessCode, agent: 'stage' }),
    redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  assert(response.ok, `session HTTP ${response.status}`);
  const url = new URL((await response.json()).signed_url);
  assert(url.protocol === 'wss:' && url.host === 'api.elevenlabs.io');
  socket = new WebSocket(url, 'convai');
  socket.addEventListener('open', () => send({ type: 'conversation_initiation_client_data' }));
  socket.addEventListener('close', ({ code }) => { closed = code; });
  socket.addEventListener('message', receive);

  await until(() => state.metadata);
  assert.equal(state.metadata.user_input_audio_format, format);
  assert.equal(state.metadata.agent_output_audio_format, format);
  check('session pcm_16000 both ways', true);

  // 1b. Silent until asked: no agent audio or agent_response in 4 s.
  const silentStart = { audio: state.audioBytes, replies: state.replies.length };
  await pause(4000);
  check('silent for 4 s until asked',
    state.audioBytes === silentStart.audio && state.replies.length === silentStart.replies,
    `audio=${state.audioBytes - silentStart.audio}B replies=${state.replies.length - silentStart.replies}`);

  // 2. Voice turn: the stage bit.
  const speech = await speechPromise;
  const replyStart = state.replies.length;
  const audioStart = state.audioBytes;
  await streamPcm(speech);
  const speechEnd = Date.now();
  await until(() => state.firstAudioAt > speechEnd || state.replies.length > replyStart, 30000);
  const firstAudioLatency = state.firstAudioAt ? state.firstAudioAt - speechEnd : null;
  console.log(`first agent audio ${firstAudioLatency} ms after end of speech`);

  // Collect the whole bit: stop after 3 s with no new agent audio (cap 100 s).
  const bitDeadline = Date.now() + 100000;
  while (!(idle() && state.audioBytes > audioStart) && Date.now() < bitDeadline && !closed) {
    await pause(250);
  }
  const bitPcm = Buffer.concat(state.audioChunks);
  const bitSeconds = bitPcm.length / 2 / RATE;
  await mkdir(new URL('../../.cache/verify/', import.meta.url), { recursive: true });
  await writeFile(wavPath, wavBuffer(bitPcm));
  const bitText = state.replies.slice(replyStart).join(' ');
  check('bit text has Doers Summit', /Doers Summit/.test(bitText));
  check('bit text has "not the cafeteria"', /not the cafeteria/.test(bitText));
  check('bit text has "charges my battery"', /charges my battery/.test(bitText));
  check('bit audio >= 30 s', bitSeconds >= 30, `${bitSeconds.toFixed(1)} s, ${bitPcm.length} bytes`);
  console.log(`WAV: ${wavPath.pathname}`);

  // 3. Pronunciation check via speech-to-text (warning only).
  const wav = await readFile(wavPath);
  const sttPromise = (async () => {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'stage-bit.wav');
    const stt = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form,
    });
    if (!stt.ok) throw new Error(`STT HTTP ${stt.status}`);
    return (await stt.json()).text ?? '';
  })();

  // 4. Quiet test: 25 s silence + 3 s low noise must produce nothing.
  const quietStart = { audio: state.audioBytes, replies: state.replies.length, transcripts: state.transcripts.length };
  await streamPcm(silencePcm(25000));
  await streamPcm(noisePcm(3000));
  await pause(1500);
  check('quiet window stays silent',
    state.audioBytes === quietStart.audio && state.replies.length === quietStart.replies,
    `audio=+${state.audioBytes - quietStart.audio}B replies=+${state.replies.length - quietStart.replies}`);

  // 5. Cue path: text user_message gets a Doers reply.
  const cueReplyStart = state.replies.length;
  send({ type: 'user_message', text: 'Say hi to the audience.' });
  await until(() => state.replies.length > cueReplyStart && idle(), 30000);
  const cueText = state.replies.slice(cueReplyStart).join(' ');
  check('cue reply mentions Doers', /Doers/.test(cueText), cueText.slice(0, 120));

  // 3b. Collect the STT transcript for the summary.
  let transcript = '';
  try { transcript = await sttPromise; } catch (error) { warn('stt', error.message); }
  console.log(`STT transcript: ${transcript || '(none)'}`);
  if (transcript && !/doers/i.test(transcript)) {
    warn('pronunciation', /doors/i.test(transcript)
      ? 'STT heard "doors" instead of "Doers"'
      : 'STT did not recognise "Doers"');
  }

  console.log('\nsummary ' + JSON.stringify({
    firstAudioLatencyMs: firstAudioLatency,
    bitSeconds: Number(bitSeconds.toFixed(1)),
    bitBytes: bitPcm.length,
    quietAudioBytes: state.audioBytes - quietStart.audio,
    stt: transcript.slice(0, 200),
    failures: results.filter(r => !r.ok).length,
  }));
  if (results.some(r => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ failed: true, error: error.name, status: error.statusCode, closeCode: closed }));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close();
}
