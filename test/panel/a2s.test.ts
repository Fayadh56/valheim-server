import { createSocket } from 'node:dgram';
import { INFO_REQUEST, isChallenge, parseInfo, queryInfo } from '../../lambda/panel/a2s';

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function cstr(s: string): Buffer {
  return Buffer.from(`${s}\0`, 'utf8');
}

function infoResponse(name: string, players: number, maxPlayers: number): Buffer {
  return Buffer.concat([
    HEADER,
    Buffer.from([0x49, 0x11]),
    cstr(name), cstr('Valheim map'), cstr('valheim'), cstr('Valheim'),
    Buffer.from([0x0a, 0x00]),              // app id (little endian, irrelevant)
    Buffer.from([players, maxPlayers, 0x00]),
    Buffer.from([0x64, 0x6c, 0x00, 0x00]),  // dedicated, linux, public, no vac
    cstr('1.0.12'),
  ]);
}

const challenge = Buffer.concat([HEADER, Buffer.from([0x41, 0xde, 0xad, 0xbe, 0xef])]);

test('parses players, max players and name from an info response', () => {
  expect(parseInfo(infoResponse('valheim-osrs-nerds', 3, 10))).toEqual({
    name: 'valheim-osrs-nerds',
    players: 3,
    maxPlayers: 10,
  });
});

test('recognizes a challenge packet', () => {
  expect(isChallenge(challenge)).toBe(true);
  expect(isChallenge(infoResponse('x', 0, 10))).toBe(false);
});

test('rejects malformed packets', () => {
  expect(() => parseInfo(Buffer.from([1, 2, 3]))).toThrow(/A2S_INFO/);
  expect(() => parseInfo(Buffer.concat([HEADER, Buffer.from([0x49, 0x11]), Buffer.from('no terminator')]))).toThrow(/unterminated/);
});

test('the request packet is the standard A2S_INFO query', () => {
  expect(INFO_REQUEST.subarray(0, 5)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]));
  expect(INFO_REQUEST.subarray(5).toString('latin1')).toBe('Source Engine Query\0');
});

test('completes the challenge handshake against a local fake server', async () => {
  const server = createSocket('udp4');
  let sawChallengeReply = false;
  server.on('message', (msg, rinfo) => {
    if (msg.length === INFO_REQUEST.length) {
      server.send(challenge, rinfo.port, rinfo.address);
    } else if (msg.subarray(INFO_REQUEST.length).equals(challenge.subarray(5, 9))) {
      sawChallengeReply = true;
      server.send(infoResponse('local', 2, 10), rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await expect(queryInfo('127.0.0.1', port, 2000)).resolves.toEqual({ name: 'local', players: 2, maxPlayers: 10 });
    expect(sawChallengeReply).toBe(true);
  } finally {
    server.close();
  }
});

test('returns null when nothing answers', async () => {
  await expect(queryInfo('127.0.0.1', 1, 200)).resolves.toBeNull();
});
