import { parsePlayers, PLAYERS_STALE_MS } from '../../lambda/panel/players';

const now = new Date('2026-09-18T02:00:00.000Z');
const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();

test('fresh payload yields the names', () => {
  expect(parsePlayers(JSON.stringify({ players: ['Fellesin', 'Halo'], updatedAt: at(10_000) }), now)).toEqual(['Fellesin', 'Halo']);
  expect(parsePlayers(JSON.stringify({ players: [], updatedAt: at(10_000) }), now)).toEqual([]);
});

test('stale, malformed or empty payloads are unknown', () => {
  expect(parsePlayers(JSON.stringify({ players: ['Fellesin'], updatedAt: at(PLAYERS_STALE_MS + 1) }), now)).toBeUndefined();
  expect(parsePlayers(JSON.stringify({ players: ['Fellesin'], updatedAt: at(PLAYERS_STALE_MS - 1) }), now)).toEqual(['Fellesin']);
  expect(parsePlayers('not json', now)).toBeUndefined();
  expect(parsePlayers('', now)).toBeUndefined();
  expect(parsePlayers(JSON.stringify({ players: 'Fellesin', updatedAt: at(0) }), now)).toBeUndefined();
  expect(parsePlayers(JSON.stringify({ players: ['ok', 3], updatedAt: at(0) }), now)).toBeUndefined();
  expect(parsePlayers(JSON.stringify({ players: [], updatedAt: 'never' }), now)).toBeUndefined();
});
