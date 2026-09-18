import { MESSAGES, PanelView, renderLogin, renderPanel } from '../../lambda/panel/html';

const base: PanelView = {
  serverName: 'valheim-osrs-nerds',
  state: 'running',
  since: 'Sep 18, 12:02 a.m.',
  players: 3,
  maxPlayers: 10,
  connectString: '100.29.76.244:2456',
  steamString: '100.29.76.244:2457',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  timezone: 'America/Toronto',
  updatedAt: '12:05 a.m.',
};

test('running panel shows status, players, connect strings and schedule', () => {
  const html = renderPanel(base);
  expect(html).toContain('Running since Sep 18, 12:02 a.m.');
  expect(html).toContain('Players: 3 / 10');
  expect(html).toContain('100.29.76.244:2456');
  expect(html).toContain('100.29.76.244:2457');
  expect(html).toContain('value="03:00"');
  expect(html).toContain('value="16:00"');
  expect(html).toContain('America/Toronto');
  expect(html).toMatch(/<button[^>]*name="action" value="start"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*name="action" value="stop"(?![^>]*disabled)/);
  expect(html).toContain('confirm(');
  expect(html).toContain('http-equiv="refresh" content="30"');
});

test('stopped panel disables stop and shows unknown players as such', () => {
  const html = renderPanel({ ...base, state: 'stopped', since: undefined, players: undefined, maxPlayers: undefined });
  expect(html).toContain('Stopped');
  expect(html).not.toContain('Players:');
  expect(html).toMatch(/<button[^>]*name="action" value="stop"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*name="action" value="start"(?![^>]*disabled)/);
});

test('running panel without a query answer says unknown', () => {
  expect(renderPanel({ ...base, players: undefined, maxPlayers: undefined })).toContain('Players: unknown');
});

test('renders a known message and ignores unknown ones', () => {
  expect(renderPanel({ ...base, message: MESSAGES['starting'] })).toContain('Starting the server');
  expect(renderPanel({ ...base, message: undefined })).not.toContain('class="msg"');
});

test('schedule checkbox reflects enabled', () => {
  expect(renderPanel({ ...base, schedule: { ...base.schedule, enabled: true } })).toMatch(/name="enabled"[^>]*checked/);
  expect(renderPanel(base)).not.toMatch(/name="enabled"[^>]*checked/);
});

test('escapes html in dynamic text', () => {
  expect(renderPanel({ ...base, serverName: '<b>x</b>' })).not.toContain('<b>x</b>');
  expect(renderPanel({ ...base, serverName: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
});

test('login page shows the error when given', () => {
  expect(renderLogin()).toContain('name="password"');
  expect(renderLogin()).not.toContain('class="error"');
  expect(renderLogin('Wrong password')).toContain('Wrong password');
});
