const byId = id => document.getElementById(id);
const control = document.querySelector('.control');
const elements = Object.fromEntries([
  'mode-switch', 'live-mode', 'practice-mode', 'mode-label', 'mode-title',
  'mode-description', 'practice-controls', 'practice-scenario', 'practice-next', 'operator-note',
  'live-controls', 'access-code', 'live-start', 'live-stop', 'meter', 'mic-level',
  'availability', 'reset', 'session-status', 'status-text', 'session-kind',
  'devices', 'mic-state', 'connection-state', 'speaker-state', 'pcm-state',
  'status-detail', 'transcript', 'transcript-empty', 'empty-hint', 'messages',
].map(id => [id, byId(id)]));
const el = id => elements[id];

const visitor = text => ({ role: 'user', text });
const navigator = text => ({ role: 'agent', text });
const operator = text => ({ role: 'operator', text });
const instruction = text => ({ role: 'instruction', text });

const clarify = [
  visitor('أحتاج مكان هادي عشان أتكلم بالتلفون.'),
  navigator('أنا المساعد الصوتي بالذكاء الاصطناعي. هل تناسبك كبينة مكالمات؟'),
];
const guideToBooth = [
  visitor('إي، كبينة مكالمات مناسبة.'),
  operator('I’m at the fictional marker A.'),
  instruction('Operator, move from marker A to marker B in this simulation. Stop at B and tell me when you’re stopped.'),
];
const boothArrival = [
  operator('I’m stopped at marker B, the simulated call booth.'),
  navigator('وصلنا إلى كبينة المكالمات في المحاكاة.'),
];
const practice = {
  easy: [clarify, guideToBooth, boothArrival],
  noise: [
    [
      { role: 'context', text: 'Simulated background music obscures part of the request.' },
      visitor('أحتاج مكان…'),
      navigator('أنا المساعد الصوتي بالذكاء الاصطناعي. ما سمعت طلبك بوضوح. ممكن تعيده؟'),
    ],
    [clarify[0], navigator('هل تناسبك كبينة مكالمات؟')],
    guideToBooth,
    boothArrival,
  ],
  reroute: [
    clarify,
    guideToBooth,
    [
      { role: 'secondVisitor', text: 'لو سمحت، نروح قاعة المؤتمرات بدل كبينة المكالمات؟' },
      instruction('Operator, stop and hold. Tell me which fictional marker you’re at.'),
      navigator('طلبت من المشغّل أن يتوقف. هل توافقون على تغيير الوجهة إلى قاعة المؤتمرات؟'),
    ],
    [
      operator('I’m stopped at fictional marker X.'),
      visitor('نعم، خلّنا نروح قاعة المؤتمرات.'),
      instruction('Operator, move from marker X to marker C in this simulation. Stop at C and tell me when you’re stopped.'),
    ],
    [
      operator('I’m stopped at marker C, the simulated conference room.'),
      navigator('وصلنا إلى قاعة المؤتمرات في المحاكاة.'),
    ],
  ],
};

const roleLabels = new Map([
  ['user', 'VISITOR'],
  ['secondVisitor', 'SECOND VISITOR'],
  ['agent', 'NAVIGATOR'],
  ['instruction', 'NAVIGATOR → OPERATOR'],
  ['operator', 'OPERATOR'],
  ['context', 'SIMULATION NOTE'],
]);

const phases = {
  starting: 'Starting microphone',
  connecting: 'Connecting',
  listening: 'Listening · speak now',
  speaking: 'Navigator speaking',
  queued: 'Audio queued',
  idle: 'Microphone off',
  error: 'Live voice interrupted',
};
const transcriptLimit = 40;
const messageLimit = 1600;
const arabicLetter = /(?=\p{Script=Arabic})\p{Letter}/u;

let mode = 'practice';
let practiceStep = 0;
let VoiceSession;
let session = null;

function report(phase, label, detail = '') {
  control.dataset.phase = phase;
  el('session-status').dataset.phase = phase;
  if (el('status-text').textContent !== label) el('status-text').textContent = label;
  if (el('status-detail').textContent !== detail) el('status-detail').textContent = detail;
  el('status-detail').hidden = !detail;
}

function updateReset() {
  el('reset').disabled = !session && !practiceStep && !el('messages').childElementCount
    && el('session-status').dataset.phase !== 'error';
}

function updatePracticeButton() {
  const total = practice[el('practice-scenario').value].length;
  const label = practiceStep === 0 ? 'Start practice'
    : practiceStep === total ? 'Replay practice'
    : `Next step · ${practiceStep + 1} of ${total}`;
  el('practice-next').firstChild.textContent = `${label} `;
}

function updateLiveControls() {
  const active = Boolean(session);
  el('access-code').disabled = active;
  el('live-start').hidden = active;
  el('live-stop').hidden = !active;
  updateReset();
}

function showDevices({ mic = false, connected = false, speaker = false, pcm } = {}) {
  el('mic-state').textContent = mic ? 'Mic on' : 'Mic off';
  el('connection-state').textContent = connected ? 'Connected' : 'Disconnected';
  el('speaker-state').textContent = speaker ? 'Speaker ready' : 'Speaker idle';
  const pcmLabel = pcm === 'pcm_16000' ? 'PCM · 16 kHz' : pcm === true ? 'PCM active' : '';
  el('pcm-state').textContent = pcmLabel;
  el('pcm-state').hidden = !pcmLabel;
  el('meter').hidden = !mic;
  if (!mic) el('mic-level').value = 0;
}

function clearMessages() {
  el('messages').replaceChildren();
  el('transcript-empty').hidden = false;
  el('transcript').scrollTop = 0;
}

function addMessage({ role, text } = {}) {
  const roleText = roleLabels.get(role);
  if (!roleText || typeof text !== 'string' || !text.trim()) return;
  const transcript = el('transcript');
  const nearEnd = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 72;
  const item = document.createElement('li');
  const roleLabel = document.createElement('span');
  const body = document.createElement('p');
  item.className = 'message';
  if (role === 'user' || role === 'secondVisitor') item.classList.add('visitor');
  else if (role !== 'agent') item.classList.add(role);
  roleLabel.className = 'role';
  roleLabel.textContent = mode === 'live' && role === 'user' ? 'MICROPHONE' : roleText;
  body.textContent = text.trim().slice(0, messageLimit);
  body.lang = arabicLetter.test(body.textContent) ? 'ar' : 'en';
  body.dir = body.lang === 'ar' ? 'rtl' : 'auto';
  item.append(roleLabel, body);
  el('transcript-empty').hidden = true;
  const log = el('messages');
  if (log.childElementCount >= transcriptLimit) log.firstElementChild.remove();
  log.append(item);
  if (nearEnd || mode === 'practice') transcript.scrollTop = transcript.scrollHeight;
  updateReset();
}

function stopLive() {
  const previous = session;
  session = null; // Ignore callbacks from the previous visitor before releasing audio.
  if (previous) previous.stop();
  el('access-code').value = '';
  showDevices();
  if (mode === 'live') report('idle', phases.idle);
  updateLiveControls();
}

function resetPractice() {
  practiceStep = 0;
  clearMessages();
  report('idle', 'Practice ready');
  updatePracticeButton();
  updateReset();
}

function newVisitor(focus = true) {
  stopLive();
  if (mode === 'practice') {
    resetPractice();
    if (focus) el('practice-scenario').focus();
  } else {
    clearMessages();
    updateReset();
    if (focus) el('access-code').focus();
  }
}

function setMode(nextMode) {
  if (mode === nextMode || (nextMode === 'live' && !VoiceSession)) return;
  newVisitor(false);
  mode = nextMode;
  const live = mode === 'live';
  el('live-mode').setAttribute('aria-pressed', String(live));
  el('practice-mode').setAttribute('aria-pressed', String(!live));
  el('live-controls').hidden = !live;
  el('operator-note').hidden = !live;
  el('practice-controls').hidden = live;
  el('devices').hidden = !live;
  el('mode-label').textContent = live ? '01 / LIVE' : '01 / PRACTICE';
  el('mode-title').textContent = live ? 'Live voice' : 'Offline practice';
  el('mode-description').textContent = live
    ? 'Speak to the AI Navigator. State the goal and provide a confirmed location before requesting directions.'
    : 'Follow a scripted conversation, one step at a time. Practice uses fictional markers and no microphone.';
  el('session-kind').textContent = live ? 'LIVE VOICE' : 'SIMULATED';
  el('empty-hint').textContent = live
    ? 'Enter the team access code and start the microphone.'
    : 'Choose a scenario and start the simulation.';
  report('idle', live ? phases.idle : 'Practice ready');
}

async function enableLiveWhenReady() {
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store', mode: 'same-origin', redirect: 'error',
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok || (await response.json())?.live_ready !== true) throw new Error();
    ({ VoiceSession } = await import('./voice.mjs'));
    if (typeof VoiceSession !== 'function') throw new Error();
    el('mode-switch').hidden = false;
  } catch {
    el('availability').textContent = 'Live voice isn’t enabled on this deployment';
  }
}

function handleState(current, state) {
  if (session !== current || mode !== 'live' || !Object.hasOwn(phases, state?.phase)) return;
  const { phase, detail } = state;
  const ended = phase === 'idle' || phase === 'error';
  const restoreFocus = ended && document.activeElement === el('live-stop');
  if (ended) session = null;
  showDevices(ended ? {} : state);
  report(phase, phases[phase], typeof detail === 'string' ? detail.slice(0, 300) : '');
  updateLiveControls();
  if (restoreFocus) el('access-code').focus();
}

el('practice-next').addEventListener('click', () => {
  const steps = practice[el('practice-scenario').value];
  if (practiceStep >= steps.length) resetPractice();
  steps[practiceStep++].forEach(addMessage);
  report('idle', practiceStep === steps.length
    ? 'Practice complete'
    : `Step ${practiceStep} of ${steps.length}`);
  updatePracticeButton();
});
el('practice-scenario').addEventListener('change', resetPractice);
el('practice-mode').addEventListener('click', () => setMode('practice'));
el('live-mode').addEventListener('click', () => setMode('live'));
el('reset').addEventListener('click', () => newVisitor());
el('live-stop').addEventListener('click', () => {
  stopLive();
  el('access-code').focus();
});

el('live-controls').addEventListener('submit', async event => {
  event.preventDefault();
  if (mode !== 'live' || !VoiceSession || session || !el('access-code').value) return;
  clearMessages();
  const current = new VoiceSession({
    onState: state => handleState(current, state),
    onTranscript: message => { if (session === current) addMessage(message); },
    onLevel: level => {
      if (session === current && Number.isFinite(level)) {
        el('mic-level').value = Math.max(0, Math.min(1, level));
      }
    },
  });
  session = current;
  report('starting', phases.starting);
  updateLiveControls();
  el('live-stop').focus();
  try {
    const ready = current.start(el('access-code').value);
    el('access-code').value = '';
    await ready;
  } catch {
    if (session === current) {
      stopLive();
      report('error', phases.error, 'Could not start live voice. You can try again or use offline practice.');
      el('access-code').focus();
    }
  }
});

window.addEventListener('pagehide', () => newVisitor(false));
void enableLiveWhenReady();
