const FORMAT = 'pcm_16000';
const RATE = 16000;
const SOCKET_BUFFER_LIMIT = 32 * 1024;
const MESSAGE_LIMIT = 256 * 1024;
const PLAYBACK_SECONDS = 12;
const PERMISSION_TIMEOUT = 30000;
const START_TIMEOUT = 15000;
const DRAIN_TIMEOUT = 5000;
const RECONNECT_TIMEOUT = 15000;
const TRANSCRIPT_MEMORY = 12;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];

// Displayed agent text drops ElevenLabs audio tags like [happy] or [pause].
const AUDIO_TAG = /\[(?:happy|sad|angry|warm|calm|curious|excited|serious|emphatic|playful|mischievous|whispers?|whispering|sighs?|laughs?|pauses?|sings?|crying|snorts?|yawns?|exhales?|inhales?|clears\sthr\w+|dramatic\st\w+|shouts?|screams?|gasps?|applause|breath\w*|long\spause|short\spause)\]/gi;

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

function micFailure(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access was denied — allow it for this site, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is busy — close other apps using it and try again.';
    case 'OverconstrainedError':
      return 'The microphone does not support the required audio format.';
    default:
      return 'Could not access the microphone or audio output.';
  }
}

function sessionFailure(response) {
  if (response.status === 401 || response.status === 403) return 'Wrong access code — check it and try again.';
  if (response.status === 503) return 'Live voice is not enabled on this deployment.';
  if (response.status >= 500) return 'Voice service unavailable — try again shortly.';
  return 'Could not start a voice session.';
}

export function reconnectDelay(attempt) {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < RECONNECT_DELAYS.length
    ? RECONNECT_DELAYS[attempt] : null;
}

export function reconnectContext(lines, limit = TRANSCRIPT_MEMORY) {
  const history = (Array.isArray(lines) ? lines : [])
    .filter(line => line && typeof line.text === 'string' && line.text.trim() &&
      (line.role === 'user' || line.role === 'agent'))
    .slice(-limit)
    .map(line => `${line.role === 'user' ? 'VISITOR/OP' : 'AGENT'}: ${line.text.trim()}`)
    .join(' / ') || '(nothing yet)';
  return 'Reconnected after a network drop. Conversation so far: ' + history +
    ' Continue from where it stopped; ask the operator to confirm ' +
    "the robot's position before any new step.";
}

export function agentDisplay(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(AUDIO_TAG, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) return null;
  return { text: cleaned, operator: /^operator\b/i.test(cleaned) };
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
      reconnecting: false, everNegotiated: false, attempt: 0, transcripts: [],
      accessCode,
      state: { phase: 'starting', mic: false, connected: false, speaker: false },
    };
    this.#run = run;
    this.#state(run, 'starting', { detail: 'Allow microphone access if your browser asks.' });
    if (this.#run === run) void this.#open(run);
    return ready;
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

  async #open(run) {
    let failure = 'Could not access the microphone or audio output.';
    try {
      // Start both browser permission operations before the first await.
      if (!navigator.mediaDevices?.getUserMedia) {
        failure = 'This browser cannot capture microphone audio.';
        throw new Error();
      }
      const context = new AudioContext();
      run.context = context;
      run.timer = setTimeout(() => this.#end(run, 'error',
        'Microphone permission timed out. Select Start microphone again.'), PERMISSION_TIMEOUT);
      const captured = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }).then(stream => {
        if (this.#run === run) {
          run.stream = stream;
          clearTimeout(run.timer);
          run.timer = setTimeout(() => this.#end(run, 'error', 'The voice connection timed out.'), START_TIMEOUT);
          const ended = () => this.#end(run, 'error', 'Microphone audio stopped. Select Start microphone again.');
          for (const track of stream.getTracks()) {
            track.addEventListener('ended', ended, { signal: run.abort.signal });
            if (track.readyState === 'ended') {
              ended();
              break;
            }
          }
        } else stopTracks(stream);
      }, error => {
        failure = micFailure(error);
        throw error;
      });
      const resumed = (async () => context.resume())();
      await Promise.all([captured, resumed]);
      if (this.#run !== run) return;
      run.audioStateChanged = () => {
        if (context.state !== 'running') {
          this.#end(run, 'error', 'Browser audio stopped. Select Start microphone again.');
        }
      };
      context.addEventListener('statechange', run.audioStateChanged);
      run.audioStateChanged();
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
      await this.#openSocket(run);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      this.#end(run, 'error', error?.failure ?? failure);
    }
  }

  async #openSocket(run) {
    let response;
    try {
      response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: run.accessCode }), signal: run.abort.signal,
        mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const wrapped = new Error();
      wrapped.failure = 'No internet connection — check Wi-Fi and try again.';
      throw wrapped;
    }
    if (this.#run !== run) return;
    if (!response.ok) {
      const failure = new Error();
      failure.failure = sessionFailure(response);
      throw failure;
    }
    const result = await response.json();
    if (this.#run !== run) return;
    const socket = new WebSocket(signedSocketUrl(result.signed_url ?? result.signedUrl), 'convai');
    this.#attachSocket(run, socket);
  }

  #attachSocket(run, socket) {
    run.socket = socket;
    socket.onopen = () => {
      if (!this.#send(run, { type: 'conversation_initiation_client_data' })) {
        this.#end(run, 'error', 'Could not initialize the voice connection.');
      }
    };
    socket.onmessage = ({ data }) => this.#message(run, data);
    // A socket error is always followed by a close; let onclose decide.
    socket.onerror = () => {};
    socket.onclose = ({ code, wasClean }) => {
      if (this.#run !== run || run.socket !== socket) return;
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      run.socket = undefined;
      run.negotiated = false;
      if (code === 1000 && wasClean && run.everNegotiated) {
        this.#drain(run);
      } else if (run.reconnecting) {
        this.#attempt(run, run.attempt + 1);
      } else if (run.everNegotiated) {
        this.#drop(run);
      } else {
        this.#end(run, 'error', 'The voice connection failed.');
      }
    };
  }

  #send(run, message) {
    if (this.#run !== run || run.socket?.readyState !== 1) return false;
    const payload = JSON.stringify(message);
    if (run.socket.bufferedAmount + payload.length > SOCKET_BUFFER_LIMIT) return false;
    try { run.socket.send(payload); return true; } catch { return false; }
  }

  #capture(run, data) {
    if (this.#run !== run || !run.capture || !run.negotiated || !(data?.pcm instanceof ArrayBuffer) ||
        data.pcm.byteLength !== 640) return;
    run.capture.port.postMessage('ack');
    if (run.queued) return;
    const level = Number.isFinite(data.level) ? Math.min(1, Math.max(0, data.level)) : 0;
    this.#emit('onLevel', level);
    if (this.#run !== run || !run.socket || run.socket.bufferedAmount > SOCKET_BUFFER_LIMIT - 1024) return;
    const pcm = btoa(String.fromCharCode(...new Uint8Array(data.pcm)));
    this.#send(run, { user_audio_chunk: pcm });
  }

  #message(run, data) {
    if (this.#run !== run || !run.socket) return;
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
        run.everNegotiated = true;
        clearTimeout(run.timer);
        clearTimeout(run.reconnectTimer);
        if (run.reconnecting) {
          run.reconnecting = false;
          run.attempt = 0;
          this.#send(run, { type: 'contextual_update', text: reconnectContext(run.transcripts) });
          this.#emit('onTranscript', { role: 'divider', text: 'Connection restored' });
        }
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
      case 'agent_response_correction': {
        const text = event.agent_response_correction_event?.corrected_agent_response;
        if (run.transcripts.at(-1)?.role === 'agent') run.transcripts.pop();
        this.#transcript(run, 'agent', text);
        return;
      }
      case 'agent_tool_request': {
        const tool = event.agent_tool_request ?? event.tool_request_event ?? {};
        const name = tool.tool_name || tool.name || 'route';
        this.#emit('onTranscript', { role: 'tool', text: `${name} → checking route…` });
        return;
      }
      case 'agent_tool_response': {
        const tool = event.agent_tool_response ?? event.tool_response_event ?? {};
        const name = tool.tool_name || tool.name || 'route';
        const result = typeof tool.result === 'string' ? tool.result
          : typeof tool.response === 'string' ? tool.response : '';
        const detail = result.replace(/\s+/g, ' ').trim().slice(0, 160);
        this.#emit('onTranscript', {
          role: 'tool',
          text: `${name} → ${tool.is_error ? 'error' : 'step'}${detail ? ` · ${detail}` : ''}`,
        });
        return;
      }
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
      case 'vad_score':
      case 'agent_chat_response_part':
      case 'agent_typing':
      case 'asr_initiation_metadata':
        return;
      default:
        // Dev-only discovery for unhandled protocol event types.
        console.debug?.('voice event', event?.type);
        return;
    }
  }

  #transcript(run, role, text) {
    if (run.negotiated && !run.queued && typeof text === 'string' && text.trim()) {
      run.transcripts.push({ role, text: text.trim() });
      if (run.transcripts.length > TRANSCRIPT_MEMORY) run.transcripts.shift();
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
          if (run.draining) this.#end(run, 'idle');
          else if (!run.queued && !run.reconnecting) this.#state(run, 'listening');
        }
      };
      source.start(start);
      run.nextTime = start + duration;
      run.latestAudio = id;
      if (!run.queued && !run.reconnecting && run.state.phase !== 'speaking') this.#state(run, 'speaking');
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

  // --- reconnect ----------------------------------------------------------

  #drop(run) {
    if (this.#run !== run || run.reconnecting || run.draining) return;
    run.reconnecting = true;
    run.attempt = 0;
    run.queued = false;
    run.firstAudioId = 0;
    run.latestAudio = -1;
    this.#clearPlayback(run);
    run.capture?.port.postMessage('start');
    this.#emit('onTranscript', { role: 'divider', text: 'Connection lost — reconnecting…' });
    this.#attempt(run, 0);
  }

  #attempt(run, index) {
    if (this.#run !== run || !run.reconnecting) return;
    run.attempt = index;
    const delay = reconnectDelay(index);
    if (delay === null) {
      this.#end(run, 'error',
        'Connection lost — could not reconnect. Select Start microphone to try again.');
      return;
    }
    this.#state(run, 'reconnecting', {
      connected: false,
      detail: `Connection lost — reconnecting in ${delay / 1000} s (attempt ${index + 1} of ${RECONNECT_DELAYS.length}).`,
    });
    clearTimeout(run.reconnectTimer);
    run.reconnectTimer = setTimeout(() => void this.#reconnect(run), delay);
  }

  async #reconnect(run) {
    if (this.#run !== run || !run.reconnecting) return;
    clearTimeout(run.reconnectTimer);
    // A socket that never answers within the timeout counts as a failed attempt.
    run.reconnectTimer = setTimeout(() => {
      if (this.#run === run && run.reconnecting && !run.negotiated) {
        try { run.socket?.close(); } catch { /* already closed */ }
        this.#attempt(run, run.attempt + 1);
      }
    }, RECONNECT_TIMEOUT);
    try {
      await this.#openSocket(run);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      clearTimeout(run.reconnectTimer);
      this.#attempt(run, run.attempt + 1);
    }
  }

  // --- shutdown -------------------------------------------------------------

  #drain(run) {
    if (this.#run !== run || run.draining) return;
    if (!run.sources.size) {
      this.#end(run, 'idle');
      return;
    }
    run.draining = true;
    this.#releaseCapture(run);
    run.timer = setTimeout(() => this.#end(run, 'idle'), DRAIN_TIMEOUT);
    this.#state(run, 'speaking', { mic: false, connected: false, pcm: undefined });
  }

  #releaseCapture(run) {
    run.abort.abort();
    if (run.socket) {
      run.socket.onopen = run.socket.onmessage = run.socket.onclose = run.socket.onerror = null;
      try { run.socket.close(1000); } catch { /* already closed */ }
      run.socket = undefined;
    }
    if (run.capture) {
      run.capture.port.onmessage = null;
      run.capture.onprocessorerror = null;
      run.capture.port.close();
      run.capture.disconnect();
      run.capture = undefined;
    }
    run.input?.disconnect();
    run.input = undefined;
    stopTracks(run.stream);
    run.stream = undefined;
  }

  #end(run, phase, detail) {
    if (this.#run !== run) return;
    this.#run = undefined;
    run.settle(false);
    clearTimeout(run.timer);
    clearTimeout(run.reconnectTimer);
    this.#releaseCapture(run);
    this.#clearPlayback(run);
    if (run.audioStateChanged) run.context.removeEventListener('statechange', run.audioStateChanged);
    if (run.context && run.context.state !== 'closed') void run.context.close().catch(() => {});
    this.#emit('onLevel', 0);
    if (!this.#run) this.#emit('onState', { phase, detail, mic: false, connected: false, speaker: false });
  }
}
