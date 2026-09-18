import { minutesIdle } from './sleep';

export type InstanceState = 'running' | 'stopped' | 'pending' | 'stopping' | 'unknown';

export interface ScheduleView {
  enabled: boolean;
  stopAt: string;
  startAt: string;
}

export interface SleepView {
  enabled: boolean;
  emptySince: string | null;
  idleMinutes: number;
}

export interface PanelView {
  serverName: string;
  state: InstanceState;
  sinceIso?: string;
  players?: number;
  maxPlayers?: number;
  connectString: string;
  steamString: string;
  schedule: ScheduleView;
  sleepWhenEmpty: SleepView;
  timezone: string;
  message?: string;
  nowIso: string;
}

export const MESSAGES: Record<string, string> = {
  starting: 'Lighting the fires. Give it about two minutes.',
  stopping: 'Dousing the fires. The world saves first.',
  'already-running': 'The hall is already open.',
  'already-stopped': 'The hall is already dark.',
  'schedule-saved': 'Night watch saved.',
  'bad-time': 'Times need to be HH:MM on a 24 hour clock.',
  error: 'Something went wrong. Try again in a minute.',
};

export const STATUS_COPY: Record<InstanceState, string> = {
  running: 'The hall is open',
  stopped: 'The hall is dark',
  pending: 'Lighting the fires',
  stopping: 'Dousing the fires',
  unknown: 'Checking the hall',
};

const QUIET_COPY: Record<Exclude<InstanceState, 'running'>, string> = {
  stopped: "Start it when you're ready to play.",
  pending: 'About two minutes.',
  stopping: 'Saving the world first.',
  unknown: 'Trying again shortly.',
};

const C = { pine: '#14201B', birch: '#E9DFC7', bronze: '#B8863B', mist: '#8FA39A', moss: '#6A9C65', ember: '#A63A26', wall: '#1C2A24' };

export function formatTime(iso: string, timeZone: string, now: Date): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\u202f/g, ' ');
  const sameDay = date.toLocaleDateString('en-US', { timeZone }) === now.toLocaleDateString('en-US', { timeZone });
  return sameDay ? time : `${date.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })}, ${time}`;
}

export function playersLine(v: PanelView): string {
  if (v.state !== 'running') return QUIET_COPY[v.state];
  const count = v.players === undefined ? 'Counting heads'
    : v.players === 0 ? 'Nobody online yet'
    : v.players === 1 ? '1 viking online'
    : `${v.players} vikings online`;
  return v.sinceIso ? `${count}, since ${formatTime(v.sinceIso, v.timezone, new Date(v.nowIso))}` : count;
}

export function idleLine(v: PanelView): string {
  const s = v.sleepWhenEmpty;
  if (v.state !== 'running' || v.players !== 0 || !s.enabled) return '';
  const idle = minutesIdle(s.emptySince, new Date(v.nowIso));
  if (idle === null) return '';
  const remaining = s.idleMinutes - idle;
  const unit = idle === 1 ? 'minute' : 'minutes';
  return remaining > 0
    ? `Nobody online for ${idle} ${unit}, sleeps in ${remaining}.`
    : `Nobody online for ${idle} ${unit}, sleeping at the next check.`;
}

export function sleepAfterText(idleMinutes: number): string {
  return idleMinutes === 60 ? 'an hour' : `${idleMinutes} minutes`;
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${C.pine}; color: ${C.birch}; font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif; font-size: 1.0625rem; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  main { max-width: 30rem; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  header .name { color: ${C.mist}; font-size: .95rem; }
  .hall { display: block; width: 11rem; height: auto; margin: 1.5rem auto .25rem; }
  .hall .window { fill: ${C.wall}; transition: fill .6s ease; }
  .hall.lit .window { fill: ${C.bronze}; }
  .hall .glow { opacity: 0; transition: opacity .6s ease; }
  .hall.lit .glow { opacity: 1; }
  h1.status { font-size: 2.25rem; line-height: 1.1; font-weight: 400; color: ${C.bronze}; margin: .75rem 0 .25rem; letter-spacing: -.01em; }
  .sub { color: ${C.mist}; margin: 0 0 1.25rem; }
  .msg { color: ${C.mist}; margin: -.5rem 0 1.25rem; }
  hr.rule { border: 0; border-top: 1px solid ${C.bronze}; opacity: .5; margin: 1.75rem 0 .25rem; }
  h2 { font-size: 1.25rem; font-weight: 400; margin: 1.5rem 0 .5rem; }
  .row { display: flex; align-items: center; gap: .75rem; margin: .5rem 0; flex-wrap: wrap; }
  .row .label { color: ${C.mist}; flex: 0 0 7.5rem; }
  code { font-family: inherit; font-size: 1.05em; }
  .note { color: ${C.mist}; margin: .5rem 0 0; }
  .error { color: ${C.ember}; margin: .5rem 0; }
  button { font: inherit; min-height: 44px; padding: .55rem 1.1rem; border-radius: 6px; border: 1px solid ${C.bronze}; background: transparent; color: ${C.birch}; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid ${C.bronze}; outline-offset: 2px; }
  button.start { background: ${C.moss}; border-color: ${C.moss}; color: ${C.pine}; }
  button.stop { background: ${C.ember}; border-color: ${C.ember}; }
  button:disabled { opacity: .5; cursor: default; }
  button.copy { padding: .3rem .7rem; font-size: .9rem; }
  button.quiet { border-color: transparent; color: ${C.mist}; padding: .3rem .6rem; }
  input[type=time] { font: inherit; background: transparent; color: ${C.birch}; border: 1px solid ${C.mist}; border-radius: 6px; padding: .3rem .4rem; }
  input[type=radio], input[type=checkbox] { width: 1.1rem; height: 1.1rem; accent-color: ${C.bronze}; }
  .opt { display: flex; align-items: center; gap: .6rem; margin: .6rem 0; flex-wrap: wrap; }
  .countdown { color: ${C.mist}; margin: 0 0 .75rem 1.7rem; font-size: .95rem; min-height: 1.4em; }
  footer { color: ${C.mist}; margin-top: 2.5rem; font-size: .95rem; }
  @media (prefers-reduced-motion: reduce) { .hall .window, .hall .glow { transition: none; } }
`;

const HEAD_TAGS = `<meta name="theme-color" content="${C.pine}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">`;

function longhouse(lit: boolean, id: string, label: string): string {
  return `<svg id="${id}" class="hall${lit ? ' lit' : ''}" viewBox="0 0 200 140" role="img" aria-label="${esc(label)}">
  <defs><radialGradient id="glow" cx="50%" cy="62%" r="60%"><stop offset="0" stop-color="${C.bronze}" stop-opacity=".35"/><stop offset="1" stop-color="${C.bronze}" stop-opacity="0"/></radialGradient></defs>
  <ellipse class="glow" cx="100" cy="82" rx="96" ry="54" fill="url(#glow)"/>
  <path d="M18 128 H182" stroke="${C.mist}" stroke-width="2" stroke-linecap="round"/>
  <path d="M34 74 Q30 66 36 58" fill="none" stroke="${C.bronze}" stroke-width="3" stroke-linecap="round"/>
  <path d="M166 74 Q170 66 164 58" fill="none" stroke="${C.bronze}" stroke-width="3" stroke-linecap="round"/>
  <path d="M40 70 L100 30 L160 70" fill="none" stroke="${C.bronze}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M30 76 L100 24 L170 76" fill="none" stroke="${C.bronze}" stroke-width="2" opacity=".55"/>
  <rect x="48" y="70" width="104" height="58" fill="${C.wall}" stroke="${C.bronze}" stroke-width="3"/>
  <rect class="window" x="62" y="84" width="16" height="16" rx="2"/>
  <rect class="window" x="122" y="84" width="16" height="16" rx="2"/>
  <rect class="window" x="90" y="92" width="20" height="36" rx="2"/>
</svg>`;
}

export function renderIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${C.pine}"/><g transform="translate(56 96) scale(2)"><path d="M40 70 L100 30 L160 70" fill="none" stroke="${C.bronze}" stroke-width="5" stroke-linejoin="round"/><rect x="48" y="70" width="104" height="58" fill="${C.wall}" stroke="${C.bronze}" stroke-width="3"/><rect x="62" y="84" width="16" height="16" rx="2" fill="${C.bronze}"/><rect x="122" y="84" width="16" height="16" rx="2" fill="${C.bronze}"/><rect x="90" y="92" width="20" height="36" rx="2" fill="${C.bronze}"/></g></svg>`;
}

export function renderLogin(error?: string): string {
  return page('Valheim server', `
    <main>
      <header><span class="name">Valheim server</span></header>
      ${longhouse(false, 'hall', 'Longhouse')}
      <h1 class="status">Who goes there?</h1>
      <form method="post" action="/login">
        <label class="opt">Server password <input type="password" name="password" autocomplete="current-password" autofocus required></label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="start" type="submit">Enter</button>
      </form>
    </main>`);
}

export function renderPanel(v: PanelView): string {
  const running = v.state === 'running';
  const stopped = v.state === 'stopped';
  const now = new Date(v.nowIso);
  const actionLabel = running ? 'Stop the server' : stopped ? 'Start the server' : 'Hold on';
  const actionClass = running ? 'stop' : stopped ? 'start' : '';
  const nightly = v.schedule.enabled;
  const body = `
    <main>
      <header>
        <span class="name">${esc(v.serverName)}</span>
        <form method="post" action="/logout"><button class="quiet" type="submit">Log out</button></form>
      </header>
      ${longhouse(running, 'hall', running ? 'Longhouse, lit' : 'Longhouse, dark')}
      <h1 id="status" class="status" aria-live="polite">${STATUS_COPY[v.state]}</h1>
      <p id="sub" class="sub">${esc(playersLine(v))}</p>
      <p id="notice" class="msg" hidden></p>
      ${v.message ? `<p class="msg">${esc(v.message)}</p>` : ''}
      <form id="actionForm" method="post" action="/action">
        <button id="action" type="submit" name="action" value="${running ? 'stop' : 'start'}" class="${actionClass}" data-players="${v.players ?? 0}"${running || stopped ? '' : ' disabled'}>${actionLabel}</button>
      </form>
      <hr class="rule">
      <h2>Getting in</h2>
      <div class="row"><span class="label">Join IP</span><code id="join">${esc(v.connectString)}</code><button type="button" class="copy" data-for="join">Copy</button></div>
      <div class="row"><span class="label">Steam browser</span><code id="steam">${esc(v.steamString)}</code><button type="button" class="copy" data-for="steam">Copy</button></div>
      <p class="note">Password is the one you were given.</p>
      <h2>Night watch</h2>
      <form method="post" action="/schedule">
        <div class="opt"><input type="radio" id="modeAlways" name="mode" value="always"${nightly ? '' : ' checked'}><label for="modeAlways">Always on</label></div>
        <div class="opt"><input type="radio" id="modeNightly" name="mode" value="nightly"${nightly ? ' checked' : ''}><label for="modeNightly">Sleeps at</label> <input type="time" name="stopAt" aria-label="Sleep time" value="${esc(v.schedule.stopAt)}" required> <span>and wakes at</span> <input type="time" name="startAt" aria-label="Wake time" value="${esc(v.schedule.startAt)}" required></div>
        <div class="opt"><input type="checkbox" id="sleepWhenEmpty" name="sleepWhenEmpty" value="on"${v.sleepWhenEmpty.enabled ? ' checked' : ''}><label for="sleepWhenEmpty">Sleep when nobody's online for ${esc(sleepAfterText(v.sleepWhenEmpty.idleMinutes))}</label></div>
        <p id="idle" class="countdown">${esc(idleLine(v))}</p>
        <button type="submit">Save</button>
      </form>
      <footer><span id="updated">Updated ${esc(formatTime(v.nowIso, v.timezone, now))}</span></footer>
    </main>
    <script>${clientScript(v)}</script>`;
  return page(v.serverName, body);
}

// Mirrors playersLine, idleLine and formatTime so the page can refresh itself without reloading.
function clientScript(v: PanelView): string {
  return `(function () {
  var TZ = ${JSON.stringify(v.timezone)}, COPY = ${JSON.stringify(STATUS_COPY)}, QUIET = ${JSON.stringify(QUIET_COPY)};
  function fmt(iso, nowIso) {
    var d = new Date(iso), n = new Date(nowIso);
    var t = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\u202f/g, ' ');
    var same = d.toLocaleDateString('en-US', { timeZone: TZ }) === n.toLocaleDateString('en-US', { timeZone: TZ });
    return same ? t : d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) + ', ' + t;
  }
  function sub(s) {
    if (s.state !== 'running') return QUIET[s.state] || '';
    var c = s.players === null ? 'Counting heads' : s.players === 0 ? 'Nobody online yet' : s.players === 1 ? '1 viking online' : s.players + ' vikings online';
    return s.since ? c + ', since ' + fmt(s.since, s.updatedAt) : c;
  }
  function idle(s) {
    var w = s.sleepWhenEmpty;
    if (s.state !== 'running' || s.players !== 0 || !w.enabled || !w.emptySince) return '';
    var start = new Date(w.emptySince).getTime();
    if (isNaN(start)) return '';
    var m = Math.max(0, Math.floor((new Date(s.updatedAt).getTime() - start) / 60000));
    var unit = m === 1 ? ' minute' : ' minutes', r = w.idleMinutes - m;
    return r > 0 ? 'Nobody online for ' + m + unit + ', sleeps in ' + r + '.' : 'Nobody online for ' + m + unit + ', sleeping at the next check.';
  }
  function apply(s) {
    var running = s.state === 'running', stopped = s.state === 'stopped';
    document.getElementById('status').textContent = COPY[s.state] || COPY.unknown;
    document.getElementById('sub').textContent = sub(s);
    document.getElementById('hall').classList.toggle('lit', running);
    document.getElementById('hall').setAttribute('aria-label', running ? 'Longhouse, lit' : 'Longhouse, dark');
    var b = document.getElementById('action');
    b.value = running ? 'stop' : 'start';
    b.className = running ? 'stop' : stopped ? 'start' : '';
    b.disabled = !(running || stopped);
    b.textContent = running ? 'Stop the server' : stopped ? 'Start the server' : 'Hold on';
    b.dataset.players = s.players === null ? '0' : String(s.players);
    document.getElementById('idle').textContent = idle(s);
    document.getElementById('updated').textContent = 'Updated ' + fmt(s.updatedAt, s.updatedAt);
    document.getElementById('notice').hidden = true;
  }
  function tick() {
    fetch('/status.json', { cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { location.reload(); return null; }
      return r.json();
    }).then(function (s) { if (s) apply(s); }).catch(function () {
      var n = document.getElementById('notice');
      n.textContent = "Couldn't reach the server status. It usually comes back on its own; try again in a minute.";
      n.hidden = false;
    }).then(function () { setTimeout(tick, 15000); });
  }
  setTimeout(tick, 15000);
  document.getElementById('actionForm').addEventListener('submit', function (e) {
    var b = document.getElementById('action'), p = Number(b.dataset.players || 0);
    if (b.value === 'stop' && p > 0 && !confirm(p + (p === 1 ? ' viking is' : ' vikings are') + ' online. Stop anyway?')) e.preventDefault();
  });
  Array.prototype.forEach.call(document.querySelectorAll('button.copy'), function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.busy) return;
      b.dataset.busy = '1';
      navigator.clipboard.writeText(document.getElementById(b.dataset.for).textContent).then(function () {
        var t = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = t; delete b.dataset.busy; }, 1500);
      }).catch(function () { delete b.dataset.busy; });
    });
  });
})();`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${HEAD_TAGS}
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
