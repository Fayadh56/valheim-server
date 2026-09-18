import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const script = path.join(__dirname, '..', '..', 'server', 'valheim-players.py');

function replay(lines: string[]): string[] {
  const out = execFileSync('python3', [script, '--replay'], { input: `${lines.join('\n')}\n`, encoding: 'utf8' });
  return JSON.parse(out).players as string[];
}

const start = 'Sep 18 01:18:17 supervisord: valheim-server 09/18/2026 01:18:17: Valheim version: l-1.0.14 (network version 40)';
const connect = (id: string) => `Sep 18 01:22:39 supervisord: valheim-server 09/18/2026 01:22:39: Got connection SteamID ${id}`;
const character = (name: string) => `Sep 18 01:23:18 supervisord: valheim-server 09/18/2026 01:23:18: Got character ZDOID from ${name} : 1232314963:1`;
const close = (id: string) => `Sep 18 01:24:24 supervisord: valheim-server 09/18/2026 01:24:24: Closing socket ${id}`;
const noise = 'Sep 18 01:22:52 supervisord: valheim-server 09/18/2026 01:22:52: Server: New peer connected,sending global keys';

test('join then leave', () => {
  expect(replay([start, connect('1'), noise, character('Fellesin')])).toEqual(['Fellesin']);
  expect(replay([start, connect('1'), character('Fellesin'), close('1')])).toEqual([]);
});

test('two joins pair in order and sort case-insensitively', () => {
  expect(replay([start, connect('1'), connect('2'), character('halo'), character('Fellesin')])).toEqual(['Fellesin', 'halo']);
  expect(replay([start, connect('1'), connect('2'), character('halo'), character('Fellesin'), close('1')])).toEqual(['Fellesin']);
});

test('a respawn does not add a second entry or steal a connecting slot', () => {
  expect(replay([start, connect('1'), character('Fellesin'), character('Fellesin')])).toEqual(['Fellesin']);
  expect(replay([start, connect('1'), character('Fellesin'), connect('2'), character('Fellesin'), character('Halo')])).toEqual(['Fellesin', 'Halo']);
});

test('a server restart clears the roster', () => {
  expect(replay([start, connect('1'), character('Fellesin'), start])).toEqual([]);
});

test('closing a socket that never named a character is harmless', () => {
  expect(replay([start, connect('1'), close('1'), connect('2'), character('Halo')])).toEqual(['Halo']);
});
