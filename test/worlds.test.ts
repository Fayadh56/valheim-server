import { activeWorlds, containerName, playersParameterName, slugify, worldPaths, worldsEnv } from '../lib/worlds';

const primary = { name: 'OsrsNerds', port: 2456 };
const second = { name: 'Iron Arbiters World', port: 2458 };

test('slugify lowercases and dashes', () => {
  expect(slugify('Iron Arbiters World')).toBe('iron-arbiters-world');
  expect(slugify('  Odd__Name -- ')).toBe('odd-name');
  expect(slugify('OsrsNerds')).toBe('osrsnerds');
});

test('the primary keeps the legacy names and paths; others get their slug', () => {
  expect(containerName(0, primary)).toBe('valheim');
  expect(containerName(1, second)).toBe('valheim-iron-arbiters-world');
  expect(worldPaths(0, primary)).toEqual({ config: '/opt/valheim/config', data: '/opt/valheim/data' });
  expect(worldPaths(1, second)).toEqual({ config: '/opt/valheim/worlds/iron-arbiters-world/config', data: '/opt/valheim/worlds/iron-arbiters-world/data' });
  expect(playersParameterName(0, primary)).toBe('/valheim/panel/players');
  expect(playersParameterName(1, second)).toBe('/valheim/panel/players-iron-arbiters-world');
});

test('worlds env carries name, ports and parameter in order', () => {
  expect(JSON.parse(worldsEnv([primary, second]))).toEqual([
    { name: 'OsrsNerds', port: 2456, queryPort: 2457, playersParameter: '/valheim/panel/players' },
    { name: 'Iron Arbiters World', port: 2458, queryPort: 2459, playersParameter: '/valheim/panel/players-iron-arbiters-world' },
  ]);
});

test('active worlds drops only the ones switched off', () => {
  expect(activeWorlds([primary, { ...second, enabled: false }])).toEqual([primary]);
  expect(activeWorlds([primary, { ...second, enabled: true }, { name: 'C', port: 2460 }])).toHaveLength(3);
});
