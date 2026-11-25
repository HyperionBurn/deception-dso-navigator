#!/usr/bin/env node
// Mission-control dashboard: tails the robot bridge log over SSH and streams
// parsed lines to the browser over SSE.
//
//   ROBOT_HOST=<robot ip> node tools/dashboard/server.mjs
//
// Node 24 built-ins only. Read-only on the robot: a single `tail -F`.

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = 4173;
const ROBOT_HOST = process.env.ROBOT_HOST;
const HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const HISTORY_MAX = 2000;
const RECONNECT_MS = 2000;
const SSH_FALLBACK = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';

const SSH_OPTS = [
  '-o', 'ConnectTimeout=6',
  '-o', 'PreferredAuthentications=password,keyboard-interactive',
  '-o', 'PubkeyAuthentication=no',
  '-o', 'ServerAliveInterval=10',
];

// Follow the newest log across bridge restarts; dump the last 300 lines first.
const REMOTE_CMD = 'cd ~/deception/logs; f=$(ls -t *.log | head -1); ' +
  'echo "##FILE $f"; tail -n 300 "$f"; ' +
  'while true; do tail -n 0 -F "$f" & p=$!; ' +
  'while [ "$(ls -t *.log | head -1)" = "$f" ]; do sleep 2; done; ' +
  'kill $p; f=$(ls -t *.log | head -1); echo "##FILE $f"; done';

const KIND = {
  AGENT: 'agent', 'VISITOR/OP': 'visitor', CAMERA: 'camera', STATE: 'state',
  KEYS: 'keys', SESSION: 'session', LATENCY: 'latency', SEND: 'send',
  MIC: 'mic', EMOJI: 'emoji', LED: 'led', FOCUS: 'focus', PLAYSTATE: 'playstate',
};
const LINE_RE = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(?:([A-Z][A-Z0-9/]*)\s*:\s*)?(.*)$/;

let seq = 0;
const history = [];
const clients = new Set();

function emit(event) {
  const item = { seq: ++seq, ...event };
  history.push(item);
  if (history.length > HISTORY_MAX) history.shift();
  const frame = `data: ${JSON.stringify(item)}\n\n`;
  for (const res of clients) res.write(frame);
}

function parseLine(raw) {
  const text = raw.replace(/\r$/, '');
  if (text.startsWith('##FILE ')) {
    return { kind: 'file', name: text.slice(7).trim() };
  }
  const m = LINE_RE.exec(text);
  if (!m) return { t: '', tag: null, text, kind: 'system' };
  const [, t, tag, body] = m;
  return { t, tag: tag ?? null, text: body, kind: tag ? (KIND[tag] || tag.toLowerCase()) : 'system' };
}

// --- SSH tail with automatic reconnect -------------------------------------

let child = null;
let pending = '';
let restartTimer = null;
let generation = 0;

function sshEnv() {
  return {
    ...process.env,
    SSH_ASKPASS: `${process.env.HOME}/.robot_askpass.sh`,
    SSH_ASKPASS_REQUIRE: 'force',
    DISPLAY: ':0',
  };
}

function startSsh(exe = 'ssh') {
  if (!ROBOT_HOST) {
    emit({ kind: 'link', up: false, reason: 'ROBOT_HOST is not set' });
    return;
  }
  const gen = ++generation;
  const args = [...SSH_OPTS, `run@${ROBOT_HOST}`, REMOTE_CMD];
  const proc = spawn(exe, args, { env: sshEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  child = proc;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    pending += chunk;
    let nl;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (line.trim()) emit(parseLine(line));
    }
  });
  proc.stderr.on('data', () => {}); // askpass/motd noise; keep the pipe drained
  proc.on('error', error => {
    if (error.code === 'ENOENT' && exe === 'ssh') {
      startSsh(SSH_FALLBACK);   // bumps generation; this proc's close is ignored
      return;
    }
    console.error(`[ssh] spawn failed: ${error.message}`);
    proc.kill();
  });
  proc.on('close', code => {
    if (gen !== generation) return;
    child = null;
    pending = '';
    emit({ kind: 'link', up: false, code });
    console.error(`[ssh] exited (${code}); reconnecting in ${RECONNECT_MS}ms`);
    restartTimer = setTimeout(() => startSsh(), RECONNECT_MS);
  });
  proc.on('spawn', () => emit({ kind: 'link', up: true }));
}

// --- HTTP -------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    for (const item of history) res.write(`data: ${JSON.stringify(item)}\n\n`);
    clients.add(res);
    const beat = setInterval(() => res.write(': hb\n\n'), 15000);
    req.on('close', () => {
      clearInterval(beat);
      clients.delete(res);
    });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      const html = await readFile(HTML_PATH);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500).end('index.html missing');
    }
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dashboard: http://localhost:${PORT}`);
  if (!ROBOT_HOST) console.error('dashboard: ROBOT_HOST is not set — link will stay down');
  startSsh();
});
