import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { VoiceSession } from '../static/voice.mjs';

const worklet = readFileSync(new URL('../static/pcm-worklet.js', import.meta.url), 'utf8');
const signed = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=fixture&token=fixture';
const tick = () => new Promise(setImmediate);

function loadWorklet(sampleRate) {
  let Processor;
  const frames = [];
  runInNewContext(worklet, {
    sampleRate,
    AudioWorkletProcessor: class {
      port = { postMessage: (frame, transfer) => frames.push(structuredClone(frame, { transfer })) };
    },
    registerProcessor(name, implementation) {
      assert.equal(name, 'voice-pcm-capture');
      Processor = implementation;
    },
  });
  const processor = new Processor();
  const control = data => processor.port.onmessage({ data });
  const render = samples => {
    for (let i = 0; i < samples.length; i += 128) processor.process([[samples.subarray(i, i + 128)]]);
  };
  return { frames, control, render };
}

test('capture gates PCM, resamples 48 kHz, and writes signed little-endian frames', () => {
  const { frames, control, render } = loadWorklet(48000);
  const input = Float32Array.from({ length: 960 }, (_, i) => [-1, 1, 0][i % 3]);
  render(input);
  assert.equal(frames.length, 0);
  control('start');
  render(input);
  assert.equal(frames.length, 1);
  assert.ok(new Uint8Array(frames[0].pcm).every(byte => byte === 0));
  render(new Float32Array(480).fill(-1));
  render(new Float32Array(480).fill(1));
  const pcm = new Uint8Array(frames[1].pcm);
  assert.equal(pcm.length, 640);
  assert.deepEqual([...pcm.slice(318, 322)], [0, 128, 255, 127]);
  assert.equal(frames[1].level, 1);
});

test('44.1 kHz capture preserves phase, limits queued frames, and discards paused partial audio', () => {
  const { frames, control, render } = loadWorklet(44100);
  control('start');
  render(new Float32Array(881).fill(0.5));
  assert.equal(frames.length, 0);
  render(new Float32Array([0.5]));
  assert.equal(frames.length, 1);
  assert.equal(new DataView(frames[0].pcm).getInt16(638, true), 16384);
  render(new Float32Array(882 * 5));
  assert.equal(frames.length, 4);
  control('ack');
  render(new Float32Array(441).fill(1));
  control('pause');
  control('start');
  render(new Float32Array(882).fill(-1));
  assert.equal(frames.length, 5);
  const pcm = new DataView(frames[4].pcm);
  assert.equal(pcm.getInt16(0, true), -32768);
  assert.equal(pcm.getInt16(638, true), -32768);
});

function browser(t, { urls = [signed], media } = {}) {
  const calls = { contexts: [], sockets: [], captures: [], tracks: [], requests: [], sources: [] };
  const install = (name, value) => {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
  };
  const stream = () => {
    const track = new class extends EventTarget {
      stopped = false;
      readyState = 'live';
      stop() { this.stopped = true; this.readyState = 'ended'; }
      end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
    }();
    calls.tracks.push(track);
    return { getTracks: () => [track] };
  };
  install('navigator', { mediaDevices: { getUserMedia: media ? () => media(stream) : async () => stream() } });
  install('AudioContext', class extends EventTarget {
    state = 'suspended';
    currentTime = 1;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    constructor() { super(); calls.contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    interrupt() { this.state = 'interrupted'; this.dispatchEvent(new Event('statechange')); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBuffer(_, n, rate) {
      assert.equal(rate, 16000);
      const data = new Float32Array(n);
      return { getChannelData: () => data };
    }
    createBufferSource() {
      const source = {
        connect() {}, disconnect() {}, stop() { this.stopped = true; },
        start(when) { this.when = when; },
      };
      calls.sources.push(source);
      return source;
    }
  });
  install('AudioWorkletNode', class {
    port = { controls: [], postMessage(data) { this.controls.push(data); }, close() { this.closed = true; } };
    constructor() { calls.captures.push(this.port); }
    connect() {}
    disconnect() {}
  });
  install('fetch', async (path, options) => {
    calls.requests.push({ path, options });
    return { ok: true, json: async () => ({ signed_url: urls.shift() }) };
  });
  install('WebSocket', class {
    sent = [];
    bufferedAmount = 0;
    readyState = 0;
    constructor(url, protocol) {
      assert.equal(url, signed);
      assert.equal(protocol, 'convai');
      calls.sockets.push(this);
    }
    open() { this.readyState = 1; this.onopen(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    receive(event) { this.onmessage({ data: JSON.stringify(event) }); }
    remoteClose(code = 1000, wasClean = true) {
      this.readyState = 3;
      this.onclose?.({ code, wasClean });
    }
  });
  return calls;
}

const metadata = (input = 'pcm_16000', output = 'pcm_16000') => ({
  type: 'conversation_initiation_metadata',
  conversation_initiation_metadata_event: { user_input_audio_format: input, agent_output_audio_format: output },
});
const audio = id => ({ type: 'audio', audio_event: { event_id: id, audio_base_64: 'AID/fw==' } });
const frame = () => ({ data: { pcm: new ArrayBuffer(640), level: 0.5 } });

async function connect(session, calls) {
  const started = session.start('test-only');
  await tick();
  const socket = calls.sockets.at(-1);
  socket.open();
  socket.receive(metadata());
  assert.equal(await started, true);
  return socket;
}

test('session negotiates before sending or playing PCM, echoes ping, and drops stale audio', async t => {
  const calls = browser(t);
  const states = [], transcripts = [], levels = [];
  const session = new VoiceSession({
    onState: value => states.push(value), onTranscript: value => transcripts.push(value), onLevel: value => levels.push(value),
  });
  const started = session.start('test-only');
  t.after(() => session.stop());
  await tick();
  const [socket] = calls.sockets;
  const [capture] = calls.captures;
  assert.equal(calls.requests[0].path, '/api/session');
  assert.equal(calls.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls.requests[0].options.body), { access_code: 'test-only' });
  socket.open();
  socket.receive({ type: 'ping', ping_event: { event_id: 0 } });
  capture.onmessage(frame());
  socket.receive(audio(1));
  assert.deepEqual(socket.sent, [{ type: 'conversation_initiation_client_data' }, { type: 'pong', event_id: 0 }]);
  assert.equal(calls.sources.length, 0);
  assert.deepEqual(capture.controls, []);

  socket.receive(metadata());
  assert.equal(await started, true);
  assert.deepEqual(states.at(-1), { phase: 'listening', mic: true, connected: true, speaker: true, pcm: 'pcm_16000', detail: undefined });
  capture.onmessage(frame());
  assert.equal(Buffer.from(socket.sent.at(-1).user_audio_chunk, 'base64').length, 640);
  assert.equal(levels.at(-1), 0.5);
  const sent = socket.sent.length;
  socket.bufferedAmount = 32768;
  capture.onmessage(frame());
  assert.equal(socket.sent.length, sent);
  assert.deepEqual(capture.controls, ['start', 'ack', 'ack']);

  socket.receive({ type: 'agent_response', agent_response_event: { agent_response: 'Hello' } });
  socket.receive({ type: 'user_transcript', user_transcription_event: { user_transcript: 'Hi' } });
  assert.deepEqual(transcripts, [{ role: 'agent', text: 'Hello' }, { role: 'user', text: 'Hi' }]);
  socket.receive(audio(3));
  socket.receive(audio(3));
  assert.ok(calls.sources[1].when > calls.sources[0].when);
  assert.deepEqual([...calls.sources[0].buffer.getChannelData(0)], [-1, 32767 / 32768]);
  socket.receive({ type: 'interruption', interruption_event: { event_id: 4 } });
  assert.ok(calls.sources.every(source => source.stopped));
  socket.receive(audio(3));
  assert.equal(calls.sources.length, 2);
  socket.receive(audio(4));
  assert.equal(calls.sources[2].when, 1);
  socket.receive({ type: 'queue_status', queue_status_event: { status: 'waiting' } });
  capture.onmessage(frame());
  assert.equal(states.at(-1).phase, 'queued');
  assert.equal(socket.sent.length, sent);
  socket.receive({ type: 'queue_status', queue_status_event: { status: 'admitted' } });
  assert.equal(calls.sources[2].stopped, true);
  assert.equal(states.at(-1).phase, 'listening');
  socket.receive(audio(0));
  const oldMessage = socket.onmessage;
  session.stop();
  oldMessage({ data: JSON.stringify(audio(9)) });
  assert.equal(calls.sources.length, 4);
  assert.equal(calls.sources[3].stopped, true);
  assert.equal(states.at(-1).phase, 'idle');
  assert.equal(calls.tracks[0].stopped, true);
  assert.equal(calls.contexts[0].state, 'closed');
  assert.equal(capture.closed, true);
  assert.equal(socket.readyState, 3);
  assert.equal(calls.requests[0].options.signal.aborted, true);
});

test('rejects signed URL lookalikes and independently requires both PCM formats', async t => {
  const calls = browser(t, { urls: [signed.replace('api.elevenlabs.io', 'api.elevenlabs.io.invalid'), signed, signed] });
  const states = [];
  const session = new VoiceSession({ onState: state => states.push(state) });
  t.after(() => session.stop());
  assert.equal(await session.start('test-only'), false);
  assert.equal(calls.sockets.length, 0);
  for (const [input, output] of [['ulaw_8000', 'pcm_16000'], ['pcm_16000', 'pcm_24000']]) {
    const started = session.start('test-only');
    await tick();
    const socket = calls.sockets.at(-1);
    socket.open();
    socket.receive(metadata(input, output));
    assert.equal(await started, false);
    assert.equal(states.at(-1).phase, 'error');
    assert.deepEqual(calls.captures.at(-1).controls, []);
  }
  assert.ok(calls.tracks.every(track => track.stopped));
});

test('stop settles startup and cleans up a microphone that arrives after a new session starts', async t => {
  const pending = [];
  const calls = browser(t, { media: stream => new Promise(resolve => pending.push(() => resolve(stream()))) });
  const states = [];
  const session = new VoiceSession({ onState: state => states.push(state.phase) });
  t.after(() => session.stop());
  const first = session.start('test-only');
  session.stop();
  assert.equal(await first, false);
  const second = session.start('test-only');
  pending[1]();
  await tick();
  calls.sockets[0].open();
  calls.sockets[0].receive(metadata());
  assert.equal(await second, true);
  pending[0]();
  await tick();
  assert.deepEqual(calls.tracks.map(track => track.stopped), [false, true]);
  assert.deepEqual(calls.contexts.map(context => context.state), ['closed', 'running']);
  assert.deepEqual(states, ['starting', 'idle', 'starting', 'connecting', 'listening']);
  assert.equal(calls.requests.length, 1);
});

test('unanswered microphone permission times out and a late stream is stopped', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let grant;
  const calls = browser(t, { media: stream => new Promise(resolve => { grant = () => resolve(stream()); }) });
  const states = [];
  const session = new VoiceSession({ onState: state => states.push(state) });
  t.after(() => session.stop());
  const started = session.start('test-only');
  assert.equal(states.at(-1).phase, 'starting');
  assert.match(states.at(-1).detail, /allow microphone/i);
  t.mock.timers.tick(30000);
  assert.equal(states.at(-1).phase, 'error');
  assert.equal(await started, false);
  assert.match(states.at(-1).detail, /permission.*timed out/i);
  assert.equal(calls.contexts[0].state, 'closed');
  grant();
  await tick();
  assert.equal(calls.tracks[0].stopped, true);
  assert.equal(calls.requests.length, 0);
});

for (const [device, interrupt] of [
  ['audio context', calls => calls.contexts[0].interrupt()],
  ['microphone track', calls => calls.tracks[0].end()],
]) {
  test(`${device} interruption stops a live session and requests a restart`, async t => {
    const calls = browser(t);
    const states = [];
    const session = new VoiceSession({ onState: state => states.push(state) });
    t.after(() => session.stop());
    const socket = await connect(session, calls);
    socket.receive(audio(1));
    interrupt(calls);
    assert.equal(states.at(-1).phase, 'error');
    assert.match(states.at(-1).detail, /start microphone again/i);
    assert.equal(states.at(-1).mic, false);
    assert.equal(states.at(-1).speaker, false);
    assert.equal(socket.readyState, 3);
    assert.equal(calls.tracks[0].stopped, true);
    assert.equal(calls.sources[0].stopped, true);
    assert.equal(calls.contexts[0].state, 'closed');
  });
}

test('clean close releases capture and drains every scheduled source before ending', async t => {
  const calls = browser(t);
  const states = [];
  const session = new VoiceSession({ onState: state => states.push(state) });
  t.after(() => session.stop());
  const socket = await connect(session, calls);
  socket.receive(audio(1));
  socket.receive(audio(1));
  const [first, last] = calls.sources;
  socket.remoteClose();
  assert.equal(calls.tracks[0].stopped, true);
  assert.equal(calls.captures[0].closed, true);
  assert.equal(socket.onmessage, null);
  assert.equal(calls.contexts[0].state, 'running');
  assert.equal(states.at(-1).phase, 'speaking');
  assert.equal(states.at(-1).mic, false);
  assert.equal(states.at(-1).connected, false);
  first.onended();
  assert.equal(states.at(-1).phase, 'speaking');
  last.onended();
  assert.equal(states.at(-1).phase, 'idle');
  assert.equal(calls.contexts[0].state, 'closed');
  assert.ok(calls.sources.every(source => !source.stopped));
});

for (const [reason, finish] of [
  ['deadline', t => t.mock.timers.tick(5000)],
  ['manual Stop', (_, session) => session.stop()],
]) {
  test(`${reason} ends a clean-close drain with audio still pending`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = browser(t);
    const states = [];
    const session = new VoiceSession({ onState: state => states.push(state) });
    t.after(() => session.stop());
    const socket = await connect(session, calls);
    socket.receive(audio(1));
    socket.remoteClose();
    assert.equal(states.at(-1).phase, 'speaking');
    finish(t, session);
    assert.equal(states.at(-1).phase, 'idle');
    assert.equal(calls.sources[0].stopped, true);
    assert.equal(calls.contexts[0].state, 'closed');
  });
}

test('an error with close code 1000 still stops playback immediately', async t => {
  const calls = browser(t, { urls: [signed, signed, signed] });
  const states = [];
  const session = new VoiceSession({ onState: state => states.push(state) });
  t.after(() => session.stop());
  for (const fail of [
    socket => socket.remoteClose(1000, false),
    socket => { socket.onerror(); socket.remoteClose(); },
    socket => { socket.receive({ type: 'client_error' }); socket.remoteClose(); },
  ]) {
    const socket = await connect(session, calls);
    socket.receive(audio(1));
    fail(socket);
    assert.equal(states.at(-1).phase, 'error');
    assert.equal(calls.sources.at(-1).stopped, true);
    assert.equal(calls.contexts.at(-1).state, 'closed');
  }
});
