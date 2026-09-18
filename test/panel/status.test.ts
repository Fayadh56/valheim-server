import { PanelView } from '../../lambda/panel/html';
import { buildStatus } from '../../lambda/panel/status';

const view: PanelView = {
  serverName: 'x', state: 'running', sinceIso: '2026-09-18T00:00:00.000Z', players: 2, maxPlayers: 10,
  connectString: 'a:1', steamString: 'a:2', schedule: { enabled: true, stopAt: '03:00', startAt: '16:00' },
  sleepWhenEmpty: { enabled: true, emptySince: null, idleMinutes: 60 }, timezone: 'America/Toronto', nowIso: '2026-09-18T01:00:00.000Z',
};

test('maps the view to the status payload', () => {
  expect(buildStatus(view)).toEqual({
    state: 'running', since: '2026-09-18T00:00:00.000Z', players: 2, maxPlayers: 10,
    schedule: view.schedule, sleepWhenEmpty: view.sleepWhenEmpty, updatedAt: '2026-09-18T01:00:00.000Z',
  });
});

test('unknown values become null', () => {
  const s = buildStatus({ ...view, state: 'stopped', sinceIso: undefined, players: undefined, maxPlayers: undefined });
  expect(s.since).toBeNull();
  expect(s.players).toBeNull();
  expect(s.maxPlayers).toBeNull();
});
