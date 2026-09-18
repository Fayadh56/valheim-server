import { createSocket } from 'node:dgram';

export interface ServerInfo {
  name: string;
  players: number;
  maxPlayers: number;
}

const HEADER = 0xffffffff;
const TYPE_INFO_REQUEST = 0x54;
const TYPE_CHALLENGE = 0x41;
const TYPE_INFO_RESPONSE = 0x49;

export const INFO_REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, TYPE_INFO_REQUEST]),
  Buffer.from('Source Engine Query\0', 'latin1'),
]);

export function isChallenge(buf: Buffer): boolean {
  return buf.length >= 9 && buf.readUInt32LE(0) === HEADER && buf[4] === TYPE_CHALLENGE;
}

export function parseInfo(buf: Buffer): ServerInfo {
  if (buf.length < 6 || buf.readUInt32LE(0) !== HEADER || buf[4] !== TYPE_INFO_RESPONSE) {
    throw new Error('not an A2S_INFO response');
  }
  let offset = 6; // header, type, protocol byte
  const readString = (): string => {
    const end = buf.indexOf(0, offset);
    if (end < 0) throw new Error('unterminated string in A2S_INFO response');
    const value = buf.toString('utf8', offset, end);
    offset = end + 1;
    return value;
  };
  const name = readString();
  readString(); // map
  readString(); // folder
  readString(); // game
  offset += 2; // app id
  if (offset + 1 >= buf.length) throw new Error('truncated A2S_INFO response');
  return { name, players: buf[offset], maxPlayers: buf[offset + 1] };
}

export function queryInfo(host: string, port: number, timeoutMs = 1500): Promise<ServerInfo | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const finish = (value: ServerInfo | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // a closed socket is the state we want
      }
      resolve(value);
    };
    const send = (packet: Buffer) => {
      try {
        socket.send(packet, port, host);
      } catch {
        finish(null);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('error', () => finish(null));
    socket.on('message', (message) => {
      if (isChallenge(message)) {
        send(Buffer.concat([INFO_REQUEST, message.subarray(5, 9)]));
        return;
      }
      try {
        finish(parseInfo(message));
      } catch {
        finish(null);
      }
    });
    send(INFO_REQUEST);
  });
}
