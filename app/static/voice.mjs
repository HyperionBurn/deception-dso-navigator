const FORMAT = 'pcm_16000';
const RATE = 16000;
const SOCKET_BUFFER_LIMIT = 32 * 1024;
const MESSAGE_LIMIT = 256 * 1024;
const PLAYBACK_SECONDS = 12;
const START_TIMEOUT = 15000;

function signedSocketUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s#\p{Cc}]/u.test(value)) throw new Error();
  const url = new URL(value);
  const agents = url.searchParams.getAll('agent_id');
  const signatures = [...url.searchParams.getAll('conversation_signature'), ...url.searchParams.getAll('token')];
  if (url.origin !== 'wss://api.elevenlabs.io' || url.username || url.password ||
      url.pathname !== '/v1/convai/conversation' || url.hash ||
      url.searchParams.size !== 2 || agents.length !== 1 || signatures.length !== 1 ||
      !agents[0] || !signatures[0] || /[\s\p{Cc}]/u.test(agents[0] + signatures[0])) throw new Error();
  return url.href;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function validId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export class VoiceSession {
  #run;
  #callbacks;

  constructor({ onState = () => {}, onTranscript = () => {}, onLevel = () => {} } = {}) {
    this.#callbacks = { onState, onTranscript, onLevel };
  }

  async start(accessCode) {
    if (this.#run) return this.#run.ready;
    let settle;
    const ready = new Promise(resolve => { settle = resolve; });
    const run = {
      ready, settle, abort: new AbortController(), sources: new Set(),
      firstAudioId: 0, latestAudio: -1, nextTime: 0, negotiated: false, queued: false,
      sessionId: globalThis.crypto.randomUUID(), // the navigation tools key their state on this
      state: { phase: 'starting', mic: false, connected: false, speaker: false },
    };
    this.#run = run;
    this.#state(run, 'starting');
    if (this.#run === run) void this.#open(run, accessCode);
    return ready;
  }

  get sessionId() {
    return this.#run?.sessionId ?? null;
  }

  stop() {
    if (this.#run) this.#end(this.#run, 'idle');
  }

  #emit(name, value) {
    // Consumer callbacks must not interfere with capture or cleanup.
    try { this.#callbacks[name](value); } catch { /* ignore consumer errors */ }
  }

  #state(run, phase, changes = {}) {
    if (this.#run !== run) return;
    run.state = { ...run.state, detail: undefined, ...changes, phase };
    this.#emit('onState', { ...run.state });
  }

  async #open(run, accessCode) {
    let failure = 'Could not access the microphone or audio output.';
    try {
      // Start both browser permission operations before the first await.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error();
      const context = new AudioContext();
      run.context = context;
      const captured = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }).then(stream => {
        if (this.#run === run) {
          run.stream = stream;
          run.timer = setTimeout(() => this.#end(run, 'error', 'The voice connection timed out.'), START_TIMEOUT);
        } else stopTracks(stream);
      });
      const resumed = (async () => context.resume())();
      await Promise.all([captured, resumed]);
      if (this.#run !== run) return;
      this.#state(run, 'connecting', { mic: true });
      if (this.#run !== run) return;

      failure = 'Could not prepare microphone audio.';
      await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
      if (this.#run !== run) return;
      run.capture = new AudioWorkletNode(context, 'voice-pcm-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      run.capture.port.onmessage = ({ data }) => this.#capture(run, data);
      run.capture.onprocessorerror = () => this.#end(run, 'error', 'Microphone audio stopped.');
      run.input = context.createMediaStreamSource(run.stream);
      run.input.connect(run.capture);
      run.capture.connect(context.destination);

      failure = 'Could not start a voice session.';
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode }), signal: run.abort.signal,
        mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      });
      if (this.#run !== run) return;
      if (response.status === 401 || response.status === 403) failure = 'The access code was rejected.';
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (this.#run !== run) return;
      const socket = new WebSocket(signedSocketUrl(result.signed_url ?? result.signedUrl), 'convai');
      run.socket = socket;
      socket.onopen = () => {
        const start = { type: 'conversation_initiation_client_data', dynamic_variables: { session_id: run.sessionId, source: 'browser' } };
        if (!this.#send(run, start)) {
          this.#end(run, 'error', 'Could not initialize the voice connection.');
        }
      };
      socket.onmessage = ({ data }) => this.#message(run, data);
      socket.onerror = () => this.#end(run, 'error', 'The voice connection failed.');
      socket.onclose = ({ code }) => {
        if (code === 1000 && run.negotiated) this.#end(run, 'idle');
        else this.#end(run, 'error', 'The voice connection closed.');
      };
    } catch {
      this.#end(run, 'error', failure);
    }
  }

  #send(run, message) {
    if (this.#run !== run || run.socket?.readyState !== 1) return false;
    const payload = JSON.stringify(message);
    if (run.socket.bufferedAmount + payload.length > SOCKET_BUFFER_LIMIT) return false;
    try { run.socket.send(payload); return true; } catch { return false; }
  }

  #capture(run, data) {
    if (this.#run !== run || !run.negotiated || !(data?.pcm instanceof ArrayBuffer) ||
        data.pcm.byteLength !== 640) return;
    run.capture.port.postMessage('ack');
    if (run.queued) return;
    const level = Number.isFinite(data.level) ? Math.min(1, Math.max(0, data.level)) : 0;
    this.#emit('onLevel', level);
    if (this.#run !== run || run.socket.bufferedAmount > SOCKET_BUFFER_LIMIT - 1024) return;
    const pcm = btoa(String.fromCharCode(...new Uint8Array(data.pcm)));
    this.#send(run, { user_audio_chunk: pcm });
  }

  #message(run, data) {
    if (this.#run !== run) return;
    if (typeof data !== 'string' || data.length > MESSAGE_LIMIT) {
      this.#end(run, 'error', 'The voice server sent an invalid message.');
      return;
    }
    let event;
    try { event = JSON.parse(data); } catch { return; }
    switch (event?.type) {
      case 'conversation_initiation_metadata': {
        const meta = event.conversation_initiation_metadata_event;
        if (meta?.user_input_audio_format !== FORMAT || meta?.agent_output_audio_format !== FORMAT) {
          this.#end(run, 'error', 'The voice server did not negotiate 16 kHz PCM in both directions.');
          return;
        }
        if (run.negotiated) return;
        run.negotiated = true;
        clearTimeout(run.timer);
        run.capture.port.postMessage('start');
        this.#state(run, 'listening', { connected: true, pcm: FORMAT, speaker: true });
        if (this.#run === run) run.settle(true);
        return;
      }
      case 'ping': {
        const id = event.ping_event?.event_id;
        if (validId(id) && !this.#send(run, { type: 'pong', event_id: id })) {
          this.#end(run, 'error', 'Could not maintain the voice connection.');
        }
        return;
      }
      case 'queue_status': {
        const status = event.queue_status_event?.status;
        if (status === 'waiting' && run.negotiated && !run.queued) {
          run.queued = true;
          run.capture.port.postMessage('pause');
          this.#state(run, 'queued');
        } else if (status === 'admitted' && run.queued) {
          run.queued = false;
          this.#clearPlayback(run);
          run.firstAudioId = 0;
          run.latestAudio = -1;
          run.capture.port.postMessage('start');
          this.#state(run, 'listening');
        } else if (status === 'timed_out') {
          this.#end(run, 'error', 'The wait for the voice agent timed out.');
        }
        return;
      }
      case 'client_error':
        this.#end(run, 'error', 'The voice server could not continue the session.');
        return;
      case 'user_transcript':
        this.#transcript(run, 'user', event.user_transcription_event?.user_transcript);
        return;
      case 'agent_response':
        this.#transcript(run, 'agent', event.agent_response_event?.agent_response);
        return;
      case 'interruption': {
        if (!run.negotiated || run.queued) return;
        const id = event.interruption_event?.event_id;
        if (validId(id) && (id < run.firstAudioId || id < run.latestAudio)) return;
        run.firstAudioId = Math.max(run.firstAudioId, validId(id) ? id : run.latestAudio + 1);
        this.#clearPlayback(run);
        this.#state(run, 'listening');
        return;
      }
      case 'audio':
        if (run.negotiated) this.#play(run, event.audio_event);
        return;
      default:
        return;
    }
  }

  #transcript(run, role, text) {
    if (run.negotiated && !run.queued && typeof text === 'string' && text.trim()) {
      this.#emit('onTranscript', { role, text });
    }
  }

  #play(run, event) {
    const id = event?.event_id;
    if (!validId(id) || id < run.firstAudioId || id < run.latestAudio ||
        typeof event.audio_base_64 !== 'string' || !event.audio_base_64) return;
    try {
      const raw = atob(event.audio_base_64);
      if (!raw.length || raw.length % 2) return;
      const context = run.context;
      const start = Math.max(context.currentTime, run.nextTime);
      const duration = raw.length / (2 * RATE);
      if (start - context.currentTime + duration > PLAYBACK_SECONDS || run.sources.size >= 512) {
        this.#end(run, 'error', 'The speaker could not keep up with incoming audio.');
        return;
      }
      const buffer = context.createBuffer(1, raw.length / 2, RATE);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const unsigned = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
        samples[i] = (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768;
      }
      const source = context.createBufferSource();
      run.sources.add(source);
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (!run.sources.delete(source)) return;
        source.disconnect();
        if (!run.sources.size && this.#run === run) {
          run.nextTime = 0;
          if (!run.queued) this.#state(run, 'listening');
        }
      };
      source.start(start);
      run.nextTime = start + duration;
      run.latestAudio = id;
      if (!run.queued && run.state.phase !== 'speaking') this.#state(run, 'speaking');
    } catch (error) {
      if (error?.name !== 'InvalidCharacterError') this.#end(run, 'error', 'Could not play agent audio.');
    }
  }

  #clearPlayback(run) {
    for (const source of run.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    run.sources.clear();
    run.nextTime = 0;
  }

  #end(run, phase, detail) {
    if (this.#run !== run) return;
    this.#run = undefined;
    run.settle(false);
    clearTimeout(run.timer);
    run.abort.abort();
    if (run.socket) {
      run.socket.onopen = run.socket.onmessage = run.socket.onclose = run.socket.onerror = null;
      try { run.socket.close(1000); } catch { /* already closed */ }
    }
    if (run.capture) {
      run.capture.port.onmessage = null;
      run.capture.onprocessorerror = null;
      run.capture.port.close();
      run.capture.disconnect();
    }
    run.input?.disconnect();
    stopTracks(run.stream);
    this.#clearPlayback(run);
    if (run.context && run.context.state !== 'closed') void run.context.close().catch(() => {});
    this.#emit('onLevel', 0);
    if (!this.#run) this.#emit('onState', { phase, detail, mic: false, connected: false, speaker: false });
  }
}
