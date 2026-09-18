import { COOKIE_MAX_AGE_SECONDS, passwordsMatch, signCookie, verifyCookie } from '../../lambda/panel/auth';

const password = 'rEDAfML359Ba';
const now = 1_800_000_000_000;

test('a signed cookie verifies before it expires', () => {
  const cookie = signCookie(password, now + 1000);
  expect(verifyCookie(password, cookie, now)).toBe(true);
});

test('rejects the wrong password', () => {
  const cookie = signCookie(password, now + 1000);
  expect(verifyCookie('wrongwrong12', cookie, now)).toBe(false);
});

test('rejects an expired cookie', () => {
  const cookie = signCookie(password, now - 1);
  expect(verifyCookie(password, cookie, now)).toBe(false);
});

test('rejects a tampered expiry or signature', () => {
  const cookie = signCookie(password, now + 1000);
  const [exp, sig] = cookie.split('.');
  expect(verifyCookie(password, `${Number(exp) + 60_000}.${sig}`, now)).toBe(false);
  expect(verifyCookie(password, `${exp}.${'0'.repeat(sig.length)}`, now)).toBe(false);
  expect(verifyCookie(password, `${exp}.nothex`, now)).toBe(false);
  expect(verifyCookie(password, undefined, now)).toBe(false);
  expect(verifyCookie(password, 'garbage', now)).toBe(false);
});

test('max age is thirty days', () => {
  expect(COOKIE_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
});

test('password comparison is exact', () => {
  expect(passwordsMatch(password, password)).toBe(true);
  expect(passwordsMatch(password, password + 'x')).toBe(false);
  expect(passwordsMatch(password, 'rEDAfML359Bb')).toBe(false);
});
