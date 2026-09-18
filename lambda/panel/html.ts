export type InstanceState = 'running' | 'stopped' | 'pending' | 'stopping' | 'unknown';

export interface ScheduleView {
  enabled: boolean;
  stopAt: string;
  startAt: string;
}

export interface PanelView {
  serverName: string;
  state: InstanceState;
  since?: string;
  players?: number;
  maxPlayers?: number;
  connectString: string;
  steamString: string;
  schedule: ScheduleView;
  timezone: string;
  message?: string;
  updatedAt: string;
}

export const MESSAGES: Record<string, string> = {
  starting: 'Starting the server. Give it about two minutes.',
  stopping: 'Stopping the server. The world saves first.',
  'already-running': 'The server is already running.',
  'already-stopped': 'The server is already stopped.',
  'schedule-saved': 'Schedule saved.',
  'bad-time': 'Times must be HH:MM on a 24 hour clock.',
  error: 'Something went wrong, try again.',
};

const STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 16px; max-width: 480px; margin-inline: auto; background: Canvas; color: CanvasText; }
  h1 { font-size: 1.25rem; margin: 8px 0 16px; }
  .card { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; background: #888; }
  .dot.running { background: #2e9e4f; }
  .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin: 6px 0; }
  code { font-size: 1rem; }
  button, input[type=submit] { font: inherit; padding: 10px 14px; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); background: Canvas; color: CanvasText; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: #2e9e4f; color: white; border-color: #2e9e4f; }
  button.danger { background: #b3261e; color: white; border-color: #b3261e; }
  input[type=time] { font: inherit; padding: 6px; }
  .msg { padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, #2e9e4f 15%, Canvas); margin-bottom: 12px; }
  .error { color: #b3261e; margin: 8px 0; }
  .muted { opacity: .7; font-size: .9rem; }
  form.inline { display: inline; }
`;

export function renderLogin(error?: string): string {
  return page('Valheim', `
    <h1>Valheim server</h1>
    <div class="card">
      <form method="post" action="/login">
        <label>Server password<br><input type="password" name="password" autocomplete="current-password" autofocus required></label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <p><button class="primary" type="submit">Enter</button></p>
      </form>
    </div>`);
}

export function renderPanel(v: PanelView): string {
  const running = v.state === 'running';
  const stopped = v.state === 'stopped';
  const players = v.players === undefined || v.maxPlayers === undefined ? 'unknown' : `${v.players} / ${v.maxPlayers}`;
  const status = running
    ? `Running since ${esc(v.since ?? '')}`
    : v.state === 'stopped' ? 'Stopped' : cap(v.state);
  const confirmStop = (v.players ?? 0) > 0
    ? ` onsubmit="return confirm('${v.players} player${v.players === 1 ? '' : 's'} online. Stop anyway?')"`
    : '';
  return page(v.serverName, `
    <h1>${esc(v.serverName)}</h1>
    ${v.message ? `<div class="msg">${esc(v.message)}</div>` : ''}
    <div class="card">
      <div class="row"><span><span class="dot ${running ? 'running' : ''}"></span>${status}</span></div>
      ${running ? `<div class="row"><span>Players: ${esc(players)}</span></div>` : ''}
      <div class="row">
        <form class="inline" method="post" action="/action">
          <button class="primary" type="submit" name="action" value="start"${stopped ? '' : ' disabled'}>Start</button>
        </form>
        <form class="inline" method="post" action="/action"${confirmStop}>
          <button class="danger" type="submit" name="action" value="stop"${running ? '' : ' disabled'}>Stop</button>
        </form>
      </div>
    </div>
    <div class="card">
      <div class="row"><span>Join IP</span><code id="join">${esc(v.connectString)}</code><button type="button" onclick="copy('join')">Copy</button></div>
      <div class="row"><span>Steam favorites</span><code id="steam">${esc(v.steamString)}</code><button type="button" onclick="copy('steam')">Copy</button></div>
      <p class="muted">Password is the one you were given.</p>
    </div>
    <div class="card">
      <form method="post" action="/schedule">
        <div class="row"><label><input type="checkbox" name="enabled" value="on"${v.schedule.enabled ? ' checked' : ''}> Nightly schedule enabled</label></div>
        <div class="row"><label>Stop at <input type="time" name="stopAt" value="${esc(v.schedule.stopAt)}" required></label></div>
        <div class="row"><label>Start at <input type="time" name="startAt" value="${esc(v.schedule.startAt)}" required></label></div>
        <p class="muted">Times are ${esc(v.timezone)}. When enabled, the server stops at the stop time and starts at the start time every day.</p>
        <button type="submit">Save schedule</button>
      </form>
    </div>
    <div class="muted">Updated ${esc(v.updatedAt)} · refreshes every 30 s ·
      <form class="inline" method="post" action="/logout"><button type="submit">Log out</button></form></div>
    <script>
      function copy(id) { navigator.clipboard.writeText(document.getElementById(id).textContent); }
      // Reload for fresh status, but never while someone is typing in the schedule form
      function tick() {
        var a = document.activeElement;
        var editing = a && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
        if (editing) { setTimeout(tick, 5000); } else { location.reload(); }
      }
      setTimeout(tick, 30000);
    </script>`);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
