import { cronToTime, timeToCron, validateTime } from '../../lambda/panel/schedule';

test('converts HH:MM to an EventBridge cron', () => {
  expect(timeToCron('16:05')).toBe('cron(5 16 * * ? *)');
  expect(timeToCron('00:30')).toBe('cron(30 0 * * ? *)');
});

test('converts an EventBridge cron back to zero padded HH:MM', () => {
  expect(cronToTime('cron(0 3 * * ? *)')).toBe('03:00');
  expect(cronToTime('cron(5 16 * * ? *)')).toBe('16:05');
});

test('round trips', () => {
  expect(cronToTime(timeToCron('23:59'))).toBe('23:59');
});

test('validates times', () => {
  expect(validateTime('09:00')).toBe(true);
  expect(validateTime('9:00')).toBe(false);
  expect(validateTime('24:00')).toBe(false);
  expect(validateTime('12:60')).toBe(false);
  expect(validateTime('')).toBe(false);
});

test('rejects unsupported cron shapes', () => {
  expect(() => cronToTime('cron(0 3 * * MON *)')).toThrow(/unsupported/);
  expect(() => timeToCron('9:00')).toThrow(/invalid time/);
});
