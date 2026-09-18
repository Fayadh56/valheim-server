import { formatTime, idleLine, MESSAGES, PanelView, playersLine, renderIconSvg, renderLogin, renderPanel, sleepAfterText, STATUS_COPY } from '../../lambda/panel/html';

const now = '2026-09-18T01:05:00.000Z';
const base: PanelView = {
  serverName: 'valheim-osrs-nerds',
  state: 'running',
  sinceIso: '2026-09-18T00:02:00.000Z',
  players: 3,
  maxPlayers: 10,
  connectString: '100.29.76.244:2456',
  steamString: '100.29.76.244:2457',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  sleepWhenEmpty: { enabled: true, emptySince: null, idleMinutes: 60 },
  timezone: 'America/Toronto',
  nowIso: now,
};

test('formats times in the server timezone, with a date when not today', () => {
  expect(formatTime('2026-09-18T00:02:00.000Z', 'America/Toronto', new Date(now))).toBe('8:02 pm');
  expect(formatTime('2026-09-16T00:02:00.000Z', 'America/Toronto', new Date(now))).toBe('Sep 15, 8:02 pm');
});

test('players line covers every count and state', () => {
  expect(playersLine(base)).toBe('3 vikings online, since 8:02 pm');
  expect(playersLine({ ...base, players: 1 })).toBe('1 viking online, since 8:02 pm');
  expect(playersLine({ ...base, players: 0 })).toBe('Nobody online yet, since 8:02 pm');
  expect(playersLine({ ...base, players: undefined })).toBe('Counting heads, since 8:02 pm');
  expect(playersLine({ ...base, state: 'stopped', sinceIso: undefined })).toBe("Start it when you're ready to play.");
  expect(playersLine({ ...base, state: 'pending' })).toBe('About two minutes.');
  expect(playersLine({ ...base, state: 'stopping' })).toBe('Saving the world first.');
});

test('idle line appears only when running, empty, enabled and timed', () => {
  const empty = { ...base, players: 0, sleepWhenEmpty: { enabled: true, emptySince: '2026-09-18T00:42:00.000Z', idleMinutes: 60 } };
  expect(idleLine(empty)).toBe('Nobody online for 23 minutes, sleeps in 37.');
  expect(idleLine({ ...empty, sleepWhenEmpty: { ...empty.sleepWhenEmpty, emptySince: '2026-09-17T23:00:00.000Z' } })).toBe('Nobody online for 125 minutes, sleeping at the next check.');
  expect(idleLine({ ...empty, players: 2 })).toBe('');
  expect(idleLine({ ...empty, sleepWhenEmpty: { ...empty.sleepWhenEmpty, enabled: false } })).toBe('');
  expect(idleLine({ ...empty, sleepWhenEmpty: { ...empty.sleepWhenEmpty, emptySince: null } })).toBe('');
  expect(idleLine({ ...empty, state: 'stopped' })).toBe('');
});

test('sleep-after text', () => {
  expect(sleepAfterText(60)).toBe('an hour');
  expect(sleepAfterText(45)).toBe('45 minutes');
});

test('running page: lit hall, status copy, stop button, no light styles', () => {
  const html = renderPanel(base);
  expect(html).toContain('The hall is open');
  expect(html).toContain('3 vikings online, since 8:02 pm');
  expect(html).toMatch(/<svg[^>]*id="hall"[^>]*class="hall lit"/);
  expect(html).toMatch(/<button[^>]*id="action"[^>]*value="stop"[^>]*class="stop"(?![^>]*disabled)/);
  expect(html).toContain('Stop the server');
  expect(html).toContain('id="actionInput"');
  expect(html).toContain('data-players="3"');
  expect(html).toContain('color-scheme: dark');
  expect(html).not.toMatch(/prefers-color-scheme|theme-toggle|http-equiv="refresh"/);
  expect(html).toContain('/status.json');
  expect(html).toContain('id="notice"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('aria-label="Sleep time"');
  expect(html).toContain("Couldn't reach the server status");
});

test('stopped page: dark hall, start button', () => {
  const html = renderPanel({ ...base, state: 'stopped', sinceIso: undefined, players: undefined, maxPlayers: undefined });
  expect(html).toContain('The hall is dark');
  expect(html).toMatch(/<svg[^>]*id="hall"[^>]*class="hall"(?! lit)/);
  expect(html).toMatch(/<button[^>]*id="action"[^>]*value="start"[^>]*class="start"(?![^>]*disabled)/);
  expect(html).toContain('Start the server');
});

test('pending and stopping disable the action', () => {
  for (const state of ['pending', 'stopping'] as const) {
    const html = renderPanel({ ...base, state });
    expect(html).toContain(STATUS_COPY[state]);
    expect(html).toMatch(/<button[^>]*id="action"[^>]*disabled/);
    expect(html).toContain('Hold on');
  }
});

test('unknown state says so and disables the action', () => {
  const html = renderPanel({ ...base, state: 'unknown', sinceIso: undefined, players: undefined });
  expect(html).toContain('Checking the hall');
  expect(html).toContain('Trying again shortly.');
  expect(html).toMatch(/<button[^>]*id="action"[^>]*disabled/);
});

test('getting in section and copy buttons', () => {
  const html = renderPanel(base);
  expect(html).toContain('100.29.76.244:2456');
  expect(html).toContain('100.29.76.244:2457');
  expect(html).toMatch(/<button[^>]*class="copy"[^>]*data-for="join"/);
  expect(html).toMatch(/<button[^>]*class="copy"[^>]*data-for="steam"/);
  expect(html).toContain('Password is the one you were given.');
});

test('night watch form reflects schedule and sleep settings', () => {
  const off = renderPanel(base);
  expect(off).toMatch(/name="mode" value="always"[^>]*checked/);
  expect(off).not.toMatch(/name="mode" value="nightly"[^>]*checked/);
  expect(off).toContain('value="03:00"');
  expect(off).toContain('value="16:00"');
  expect(off).toContain('name="stopAt"');
  expect(off).toContain('name="startAt"');
  expect(off).toMatch(/name="sleepWhenEmpty"[^>]*checked/);
  expect(off).toContain("Sleep when nobody's online for an hour");
  const on = renderPanel({ ...base, schedule: { ...base.schedule, enabled: true }, sleepWhenEmpty: { ...base.sleepWhenEmpty, enabled: false } });
  expect(on).toMatch(/name="mode" value="nightly"[^>]*checked/);
  expect(on).not.toMatch(/name="sleepWhenEmpty"[^>]*checked/);
});

test('messages render once from the fixed map, fade on the client, and escape html', () => {
  const flashed = renderPanel({ ...base, message: MESSAGES['schedule-saved'] });
  expect(flashed).toMatch(/<p id="flash" class="msg">Night watch saved\.<\/p>/);
  expect(flashed).toMatch(/getElementById\('flash'\)[\s\S]*8000/);
  expect(renderPanel(base)).not.toContain('id="flash"');
  expect(Object.keys(MESSAGES).sort()).toEqual(['already-running', 'already-stopped', 'bad-time', 'error', 'schedule-saved']);
  const html = renderPanel({ ...base, serverName: '<b>x</b>' });
  expect(html).not.toContain('<b>x</b>');
  expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
});

test('home screen tags and manifest links on every page', () => {
  for (const html of [renderPanel(base), renderLogin()]) {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon-180.png">');
    expect(html).toContain('<meta name="theme-color" content="#14201B">');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml">');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">');
  }
});

test('login page has the password field and optional error, and no status script', () => {
  expect(renderLogin()).toContain('name="password"');
  expect(renderLogin()).not.toContain('class="error"');
  expect(renderLogin('Wrong password')).toContain('Wrong password');
  expect(renderLogin()).not.toContain('/status.json');
});

test('icon svg is a standalone 512 mark', () => {
  const svg = renderIconSvg();
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('viewBox="0 0 512 512"');
  expect(svg).toContain('#14201B');
  expect(svg).toContain('#B8863B');
});

test('no em dashes anywhere in rendered output', () => {
  expect(renderPanel(base)).not.toContain('\u2014');
  expect(renderLogin()).not.toContain('\u2014');
});

test('names line shows online characters and hides when unknown or empty', () => {
  const named = renderPanel({ ...base, playerNames: ['Fellesin', 'Halo'] });
  expect(named).toMatch(/<p id="names" class="names">Fellesin, Halo<\/p>/);
  expect(renderPanel(base)).toMatch(/<p id="names" class="names" hidden>/);
  expect(renderPanel({ ...base, playerNames: [] })).toMatch(/<p id="names" class="names" hidden>/);
  expect(renderPanel({ ...base, playerNames: ['<b>x</b>'] })).toContain('&lt;b&gt;x&lt;/b&gt;');
});

test('start and stop confirm through the hall dialog with a browser fallback', () => {
  const html = renderPanel(base);
  expect(html).toContain('<dialog id="confirm"');
  for (const id of ['confirmTitle', 'confirmBody', 'confirmYes', 'confirmNo']) expect(html).toContain(`id="${id}"`);
  for (const copy of ['Light the fires?', 'Douse the fires?', 'The hall takes about two minutes to warm up.', 'The world saves first.', 'Light them', 'Douse them', 'Not now']) expect(html).toContain(copy);
  expect(html).toContain('showModal');
  expect(html).toContain('confirm(');
  expect(html).toMatch(/<input type="hidden" name="action" id="actionInput" value="stop">/);
});

test('mods section lists the mods, the code with a copy button, and the steps', () => {
  const html = renderPanel({ ...base, mods: { names: ['Jotunn', 'InventorySlots'], profileCode: 'abc-123' } });
  expect(html).toContain('<h2>Mods</h2>');
  expect(html).toContain('Everyone runs the same mods: Jotunn, InventorySlots.');
  expect(html).toMatch(/<code id="profile">abc-123<\/code><button type="button" class="copy" data-for="profile">Copy<\/button>/);
  expect(html).toContain('Install <a href="https://thunderstore.io/package/ebkr/r2modman/">r2modman</a> and pick Valheim.');
  for (const step of ['Profiles, then Import / Update, then From code.', 'Paste the code.', 'Start modded.']) expect(html).toContain(step);
  expect(html).toContain('href="https://thunderstore.io/package/ebkr/r2modman/"');
  const soon = renderPanel({ ...base, mods: { names: ['Jotunn'], profileCode: null } });
  expect(soon).toContain('Profile code coming soon.');
  expect(soon).not.toContain('id="profile"');
  expect(renderPanel(base)).not.toContain('<h2>Mods</h2>');
  expect(renderPanel({ ...base, mods: { names: ['<b>x</b>'], profileCode: '<i>' } })).not.toMatch(/<b>x<\/b>|<i>/);
});
