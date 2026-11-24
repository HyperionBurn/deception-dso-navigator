// The second screen: shows what the navigator said to the operator, the route, and where the robot is.
// It only reads. The team access code stays in memory on this page and is never stored.

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const POLL_MS = 1500;
let code = '';
let timer = null;
let sessionId = new URLSearchParams(location.search).get('session') || 'latest';

function svg(name, attributes = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function setLink(text, ok) {
  $('link-chip').textContent = text;
  $('link-chip').classList.toggle('ok', ok);
}

function drawMap(data) {
  const { layout, robot, labels } = data;
  const { minX, minY, w, h } = layout.bounds;
  const pad = Math.max(w, h) * 0.12 + 2;
  const unit = Math.max(w, h) / 22 + 0.6;
  const map = $('map');
  map.replaceChildren();
  map.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`);
  for (const edge of layout.edges) {
    const a = layout.nodes[edge.a];
    const b = layout.nodes[edge.b];
    map.append(svg('line', { class: 'edge', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
  }
  let shown = 0;
  for (const [id, point] of Object.entries(layout.nodes)) {
    const info = labels[id];
    const classes = ['node', info.type === 'place' ? 'place' : '', info.name === data.destination ? 'dest' : ''].filter(Boolean).join(' ');
    map.append(svg('circle', { class: classes, cx: point.x, cy: point.y, r: unit * 0.55 }));
    if (info.type === 'junction') continue;
    // Alternate labels above and below so neighbours such as the four booths do not overlap.
    const above = shown++ % 2 === 1;
    map.append(svg('text', {
      class: 'label-text', x: point.x, y: point.y + (above ? -unit * 1.0 : unit * 1.9),
      'text-anchor': 'middle', 'font-size': unit * 0.85,
    }, info.short ?? info.name.replace(/^the /u, '')));
  }
  if (robot) {
    map.append(svg('circle', { class: `ring${data.confidence === 'guess' ? ' guess' : ''}`, cx: robot.x, cy: robot.y, r: unit * 1.3 }));
    map.append(svg('circle', { class: 'robot', cx: robot.x, cy: robot.y, r: unit * 0.7 }));
  }
}

function render(data) {
  $('demo-chip').hidden = !data.demo;
  $('say').textContent = data.say_operator || 'Waiting for the first instruction';
  $('handover').hidden = !data.handover;
  $('handover-reason').textContent = data.handover?.reason ?? '';
  $('dest').textContent = data.destination ?? 'none';
  $('pos').textContent = data.position ?? 'unknown';
  $('conf').textContent = data.confidence;
  $('arrived').hidden = !data.arrived;
  $('steps').replaceChildren(...data.steps.map(step => {
    const item = document.createElement('li');
    item.className = step.status;
    item.textContent = step.say.replace(/^Operator, /u, '');
    return item;
  }));
  $('log').replaceChildren(...data.log.slice().reverse().map(entry => {
    const item = document.createElement('li');
    const seconds = Math.max(0, Math.round((data.updated - entry.t) / 1000));
    item.textContent = `${seconds}s ago  ${entry.ev}${entry.dest ? ` ${entry.dest}` : ''}${entry.reason ? ` (${entry.reason})` : ''}`;
    return item;
  }));
  drawMap(data);
}

async function poll() {
  try {
    const response = await fetch('/api/nav-screen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ access_code: code, session_id: sessionId }), signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401) { stop(); setLink('Access code rejected', false); return; }
    if (response.status === 404) { setLink('Connected, waiting for a session', true); return; }
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.map_ready === false) { setLink('No floor map on the server yet', false); return; }
    setLink('Live', true);
    render(data);
  } catch {
    setLink('Connection lost, retrying', false);
  }
}

function stop() {
  clearInterval(timer);
  timer = null;
  code = '';
}

$('connect').addEventListener('submit', event => {
  event.preventDefault();
  stop();
  code = $('code').value;
  $('code').value = '';
  setLink('Connecting', false);
  void poll();
  timer = setInterval(poll, POLL_MS);
});
window.addEventListener('pagehide', stop);
