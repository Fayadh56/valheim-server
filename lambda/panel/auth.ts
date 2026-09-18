import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'valheim_panel';
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const HEX64 = /^[0-9a-f]{64}$/;

export function signCookie(password: string, expiresAt: number): string {
  return `${expiresAt}.${hmac(password, String(expiresAt))}`;
}

export function verifyCookie(password: string, cookie: string | undefined, now = Date.now()): boolean {
  if (!cookie) return false;
  const dot = cookie.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(cookie.slice(0, dot));
  const signature = cookie.slice(dot + 1);
  if (!Number.isInteger(expiresAt) || expiresAt <= now || !HEX64.test(signature)) return false;
  const expected = hmac(password, String(expiresAt));
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export function passwordsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}
