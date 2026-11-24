// Talk page: WebRTC voice via @workhub/voice-kit + @elevenlabs/react.
// Bundled by esbuild to static/talk/talk.js (npm run build).
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceKitProvider, useVoiceAgent } from '@workhub/voice-kit/react';
import { agentDisplay } from '../static/voice.mjs';

// The kit's useVoiceAgent fetches tokenUrl/researchUrl without header support,
// so we wrap fetch to attach the team access code to our own API routes.
let accessCode = '';
const realFetch = window.fetch;
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (accessCode && /\/api\/(token|research)\b/.test(url)) {
    init = { ...init, headers: { ...init.headers, 'x-access-code': accessCode } };
  }
  return realFetch(input, init);
};

const LANGUAGES = [
  { id: undefined, label: 'Auto' },
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
  { id: 'hi', label: 'हिन्दी' },
];

function Talk() {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState(undefined);
  const [error, setError] = useState('');
  const agent = useVoiceAgent({ preset: 'navigator', language });
  const transcriptRef = useRef(null);

  useEffect(() => { accessCode = code.trim(); }, [code]);
  useEffect(() => {
    transcriptRef.current?.scrollTo(0, transcriptRef.current.scrollHeight);
  }, [agent.lines, agent.events]);

  const start = async () => {
    setError('');
    if (!code.trim()) { setError('Enter the team access code first.'); return; }
    try {
      await agent.start();
    } catch {
      setError('Could not start — check the access code and connection.');
    }
  };

  const connected = agent.status === 'connected';
  const connecting = agent.status === 'connecting';

  return (
    <main>
      <h1>Talk to the navigator <small>(WebRTC)</small></h1>
      <p className="lede">
        Voice kit talk page — the same agent as the main page, over WebRTC.
        Practice routes are fictional.
      </p>

      <div className="controls">
        <input
          type="password" placeholder="Team access code" autoComplete="off"
          value={code} onChange={e => setCode(e.target.value)} disabled={connected || connecting}
        />
        <select value={language ?? ''} onChange={e => setLanguage(e.target.value || undefined)}
          disabled={connected || connecting} aria-label="Language override">
          {LANGUAGES.map(l => <option key={l.label} value={l.id ?? ''}>{l.label}</option>)}
        </select>
        <button
          className="primary" onClick={connected ? agent.stop : start} disabled={connecting}>
          {connecting ? 'Connecting…' : connected ? 'Stop' : 'Start microphone'}
        </button>
      </div>

      <p className={`state ${agent.status}`} data-phase={agent.status}>
        {agent.status}{agent.mode ? ` · ${agent.mode}` : ''}
        {agent.agentId.current ? ` · ${agent.agentId.current}` : ''}
        {agent.onHold ? ' · researching…' : ''}
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      <ul className="messages" ref={transcriptRef}>
        {agent.lines.map((line, i) => {
          if (line.role === 'user') {
            return <li key={i} className="message visitor"><span className="role">VISITOR/OP</span><p dir="auto">{line.text}</p></li>;
          }
          const display = agentDisplay(line.text);
          if (!display) return null;
          return (
            <li key={i} className={`message${display.operator ? ' navigator-operator' : ''}`}>
              <span className="role">{display.operator ? 'NAVIGATOR → OPERATOR · EN' : 'NAVIGATOR'}</span>
              <p dir="auto">{display.text}</p>
            </li>
          );
        })}
        {agent.events.map((event, i) => (
          <li key={`e${i}`} className="message tool">
            <span className="role">TOOL · {String(event.type).toUpperCase()}</span>
            <p dir="auto">{typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <VoiceKitProvider><Talk /></VoiceKitProvider>,
);
