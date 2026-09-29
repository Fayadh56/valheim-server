import type { Aws } from '../../lambda/panel/aws';
import { NO_TIMER } from '../../lambda/panel/sleep';
import { createSleeper, readSleeperEnv, SLEEP_MESSAGE, SleeperDeps } from '../../lambda/panel/sleeper';

const now = new Date('2026-09-18T02:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function fake(opts: { state?: string; players?: number | null; enabled?: string; emptySince?: string; webhook?: string; second?: number | null } = {}) {
  const params: Record<string, string> = { '/p/enabled': opts.enabled ?? 'true', '/p/since': opts.emptySince ?? NO_TIMER };
  const calls: string[] = [];
  let queries = 0;
  const aws = {
    describeInstance: async () => ({ state: opts.state ?? 'running' }),
    startInstance: async () => { calls.push('start'); },
    stopInstance: async (id: string) => { calls.push(`stop:${id}`); },
    getSchedules: async () => { throw new Error('unused'); },
    updateSchedules: async () => { throw new Error('unused'); },
    getServerPassword: async () => 'pw',
    getParameter: async (name: string) => params[name],
    putParameter: async (name: string, value: string) => { params[name] = value; calls.push(`put:${name}=${value}`); },
    getWebhook: async () => opts.webhook ?? 'https://discord.example/hook',
    postDiscord: async (_hook: string, content: string) => { calls.push(`discord:${content}`); },
  } as unknown as Aws;
  const deps: SleeperDeps = {
    aws,
    env: { instanceId: 'i-1', serverHost: 'h', worlds: [{ name: 'A', queryPort: 2457 }, { name: 'B', queryPort: 2459 }], secretArn: 'arn:s', sleepEnabledParameter: '/p/enabled', emptySinceParameter: '/p/since', idleMinutes: 60 },
    queryPlayers: async (_host: string, port: number) => {
      queries += 1;
      const players = port === 2459 && opts.second !== undefined ? opts.second : opts.players;
      return players === undefined ? { players: 0 } : players === null ? null : { players };
    },
    now: () => now.getTime(),
  };
  return { run: createSleeper(deps), calls, params, queries: () => queries };
}

test('marks the timer when the server is empty', async () => {
  const f = fake();
  await expect(f.run()).resolves.toEqual({ action: 'mark', emptySince: now.toISOString() });
  expect(f.params['/p/since']).toBe(now.toISOString());
  expect(f.calls.filter((c) => c.startsWith('stop'))).toEqual([]);
  expect(f.queries()).toBe(2);
});

test('clears the timer when players are online', async () => {
  const f = fake({ players: 3, emptySince: ago(20) });
  await expect(f.run()).resolves.toEqual({ action: 'clear' });
  expect(f.params['/p/since']).toBe(NO_TIMER);
});

test('stops once, clears the timer and tells Discord after an idle hour', async () => {
  const f = fake({ emptySince: ago(61) });
  await expect(f.run()).resolves.toEqual({ action: 'stop' });
  expect(f.calls).toEqual(['stop:i-1', `put:/p/since=${NO_TIMER}`, `discord:${SLEEP_MESSAGE}`]);
});

test('does nothing when the feature is off', async () => {
  const f = fake({ enabled: 'false', emptySince: ago(600) });
  await expect(f.run()).resolves.toEqual({ action: 'none' });
  expect(f.calls).toEqual([]);
});

test('skips the Discord post when no webhook is stored', async () => {
  const f = fake({ emptySince: ago(61), webhook: '' });
  await f.run();
  expect(f.calls.some((c) => c.startsWith('discord'))).toBe(false);
  expect(f.calls[0]).toBe('stop:i-1');
  expect(f.params['/p/since']).toBe(NO_TIMER);
});

test('does not query players when the server is not running', async () => {
  const f = fake({ state: 'stopped', emptySince: ago(5) });
  await expect(f.run()).resolves.toEqual({ action: 'clear' });
  expect(f.calls).toEqual([`put:/p/since=${NO_TIMER}`]);
  expect(f.queries()).toBe(0);
});

test('sums players across worlds and never stops on a failed query', async () => {
  const f = fake({ players: 0, second: 2, emptySince: ago(20) });
  await expect(f.run()).resolves.toEqual({ action: 'clear' });
  expect(f.queries()).toBe(2);
  const g = fake({ players: 0, second: null, emptySince: ago(90) });
  await expect(g.run()).resolves.toEqual({ action: 'none' });
});

test('readSleeperEnv requires every variable', () => {
  const full = { INSTANCE_ID: 'i', SERVER_HOST: 'h', WORLDS: JSON.stringify([{ name: 'A', port: 2456, queryPort: 2457, playersParameter: '/p' }]), SECRET_ARN: 'a', SLEEP_ENABLED_PARAMETER: '/e', EMPTY_SINCE_PARAMETER: '/s', SLEEP_IDLE_MINUTES: '60' };
  expect(readSleeperEnv(full)).toEqual({ instanceId: 'i', serverHost: 'h', worlds: [{ name: 'A', queryPort: 2457 }], secretArn: 'a', sleepEnabledParameter: '/e', emptySinceParameter: '/s', idleMinutes: 60 });
  const { SLEEP_IDLE_MINUTES: _o, ...missing } = full;
  expect(() => readSleeperEnv(missing)).toThrow(/SLEEP_IDLE_MINUTES/);
  expect(() => readSleeperEnv({ ...full, WORLDS: '[]' })).toThrow(/WORLDS/);
});
