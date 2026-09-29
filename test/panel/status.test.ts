import { PanelView } from '../../lambda/panel/html';
import { buildStatus } from '../../lambda/panel/status';

const view: PanelView = {
  serverName: 'x', state: 'running', sinceIso: '2026-09-18T00:00:00.000Z', players: 2, maxPlayers: 10,
  worlds: [
    { name: 'OsrsNerds', players: 2, maxPlayers: 10, playerNames: ['Fellesin', 'Halo'], connectString: '100.29.76.244:2456', steamString: '100.29.76.244:2457' },
    { name: 'Iron Arbiters World', players: 1, maxPlayers: 10, playerNames: ['Sir Freak'], connectString: '100.29.76.244:2458', steamString: '100.29.76.244:2459' },
  ],
  schedule: { enabled: true, stopAt: '03:00', startAt: '16:00' },
  sleepWhenEmpty: { enabled: true, emptySince: null, idleMinutes: 60 }, timezone: 'America/Toronto', nowIso: '2026-09-18T01:00:00.000Z',
};

test('maps the view to the status payload', () => {
  expect(buildStatus(view)).toEqual({
    state: 'running', since: '2026-09-18T00:00:00.000Z', players: 2, maxPlayers: 10,
    schedule: view.schedule, sleepWhenEmpty: view.sleepWhenEmpty, playerNames: null, updatedAt: '2026-09-18T01:00:00.000Z',
    worlds: [
      { name: 'OsrsNerds', players: 2, maxPlayers: 10, playerNames: ['Fellesin', 'Halo'], connectString: '100.29.76.244:2456', steamString: '100.29.76.244:2457' },
      { name: 'Iron Arbiters World', players: 1, maxPlayers: 10, playerNames: ['Sir Freak'], connectString: '100.29.76.244:2458', steamString: '100.29.76.244:2459' },
    ],
  });
  const unknown = buildStatus({ ...view, worlds: [{ name: 'A', connectString: 'a:1', steamString: 'a:2' }] });
  expect(unknown.worlds).toEqual([{ name: 'A', players: null, maxPlayers: null, playerNames: null, connectString: 'a:1', steamString: 'a:2' }]);
});

test('unknown values become null', () => {
  const s = buildStatus({ ...view, state: 'stopped', sinceIso: undefined, players: undefined, maxPlayers: undefined });
  expect(s.since).toBeNull();
  expect(s.players).toBeNull();
  expect(s.maxPlayers).toBeNull();
});

test('player names map to the payload with null for unknown', () => {
  expect(buildStatus({ ...view, playerNames: ['Fellesin'] }).playerNames).toEqual(['Fellesin']);
  expect(buildStatus(view).playerNames).toBeNull();
});
