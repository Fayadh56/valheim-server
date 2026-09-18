import { decide, minutesIdle, NO_TIMER } from '../../lambda/panel/sleep';

const now = new Date('2026-09-18T02:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const base = { enabled: true, state: 'running', players: 0, emptySince: NO_TIMER, now, idleMinutes: 60 };

test('a stopped or booting server never accumulates idle time', () => {
  expect(decide({ ...base, state: 'stopped' })).toEqual({ action: 'none' });
  expect(decide({ ...base, state: 'stopped', emptySince: ago(10) })).toEqual({ action: 'clear' });
  expect(decide({ ...base, state: 'pending', emptySince: ago(10) })).toEqual({ action: 'clear' });
});

test('a failed player query keeps whatever timer exists', () => {
  expect(decide({ ...base, players: null })).toEqual({ action: 'none' });
  expect(decide({ ...base, players: null, emptySince: ago(90) })).toEqual({ action: 'none' });
});

test('players online clear the timer', () => {
  expect(decide({ ...base, players: 2 })).toEqual({ action: 'none' });
  expect(decide({ ...base, players: 2, emptySince: ago(30) })).toEqual({ action: 'clear' });
});

test('an empty server starts the timer', () => {
  expect(decide(base)).toEqual({ action: 'mark', emptySince: now.toISOString() });
});

test('stops at exactly the idle threshold, not before', () => {
  expect(decide({ ...base, emptySince: ago(59) })).toEqual({ action: 'none' });
  expect(decide({ ...base, emptySince: ago(60) })).toEqual({ action: 'stop' });
  expect(decide({ ...base, emptySince: ago(600) })).toEqual({ action: 'stop' });
});

test('never stops when the feature is off, but keeps timing', () => {
  expect(decide({ ...base, enabled: false, emptySince: ago(600) })).toEqual({ action: 'none' });
  expect(decide({ ...base, enabled: false })).toEqual({ action: 'mark', emptySince: now.toISOString() });
});

test('treats garbage timers as unset', () => {
  expect(decide({ ...base, emptySince: 'not a date' })).toEqual({ action: 'mark', emptySince: now.toISOString() });
  expect(decide({ ...base, emptySince: null })).toEqual({ action: 'mark', emptySince: now.toISOString() });
});

test('minutesIdle', () => {
  expect(minutesIdle(NO_TIMER, now)).toBeNull();
  expect(minutesIdle(null, now)).toBeNull();
  expect(minutesIdle(ago(23), now)).toBe(23);
  expect(minutesIdle(ago(0.5), now)).toBe(0);
});
