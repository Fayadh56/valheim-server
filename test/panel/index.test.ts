import type { APIGatewayProxyStructuredResultV2 as Result, LambdaFunctionURLEvent } from 'aws-lambda';
import { signCookie } from '../../lambda/panel/auth';
import type { Aws, ScheduleSettings } from '../../lambda/panel/aws';
import { createHandler, Deps, readEnv } from '../../lambda/panel/index';

const password = 'rEDAfML359Ba';
const now = 1_800_000_000_000;

function fakeAws(overrides: Partial<Aws> = {}) {
  const calls: string[] = [];
  let schedules: ScheduleSettings = { enabled: false, stopCron: 'cron(0 3 * * ? *)', startCron: 'cron(0 16 * * ? *)' };
  const aws: Aws = {
    describeInstance: async () => ({ state: 'running', launchTime: new Date(now - 3_600_000) }),
    startInstance: async (id) => { calls.push(`start:${id}`); },
    stopInstance: async (id) => { calls.push(`stop:${id}`); },
    getSchedules: async () => schedules,
    updateSchedules: async (_s, _t, settings) => { calls.push('update'); schedules = settings; },
    getServerPassword: async () => password,
    getWebhook: async () => '',
    getParameter: async () => '',
    putParameter: async () => {},
    postDiscord: async () => {},
    ...overrides,
  };
  return { aws, calls, schedules: () => schedules };
}

function deps(aws: Aws, slept: number[] = []): Deps {
  return {
    aws,
    env: {
      instanceId: 'i-123', serverHost: '100.29.76.244', gamePort: 2456, queryPort: 2457,
      secretArn: 'arn:secret', stopScheduleName: 'valheim-stop', startScheduleName: 'valheim-start',
      timezone: 'America/Toronto', serverName: 'valheim-osrs-nerds',
    },
    queryPlayers: async () => ({ players: 2, maxPlayers: 10 }),
    sleep: async (ms) => { slept.push(ms); },
    now: () => now,
  };
}

function event(opts: { method?: string; path?: string; body?: string; cookie?: string; origin?: string; query?: Record<string, string> } = {}): LambdaFunctionURLEvent {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: opts.path ?? '/',
    rawQueryString: '',
    headers: { host: 'abc.lambda-url.us-east-1.on.aws', ...(opts.origin ? { origin: opts.origin } : {}) },
    cookies: opts.cookie ? [`valheim_panel=${opts.cookie}`] : undefined,
    queryStringParameters: opts.query,
    requestContext: { http: { method: opts.method ?? 'GET', path: opts.path ?? '/', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'jest' } } as LambdaFunctionURLEvent['requestContext'],
    body: opts.body,
    isBase64Encoded: false,
  } as LambdaFunctionURLEvent;
}

const good = () => signCookie(password, now + 60_000);
const sameOrigin = 'https://abc.lambda-url.us-east-1.on.aws';

function header(res: Result, name: string): string | undefined {
  return res.headers?.[name] as string | undefined;
}

test('unauthenticated GET shows the login page', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event());
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('name="password"');
  expect(res.body).not.toContain('Players');
});

test('wrong password waits a second and re-renders login with an error', async () => {
  const { aws } = fakeAws();
  const slept: number[] = [];
  const res = await createHandler(deps(aws, slept))(event({ method: 'POST', path: '/login', body: 'password=nope' }));
  expect(slept).toEqual([1000]);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Wrong password');
  expect(res.cookies).toBeUndefined();
});

test('correct password sets a cookie and redirects home', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/login', body: `password=${password}` }));
  expect(res.statusCode).toBe(303);
  expect(header(res, 'location')).toBe('/');
  expect(res.cookies?.[0]).toMatch(/^valheim_panel=\d+\.[0-9a-f]{64}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
});

test('authenticated GET renders the panel with players and schedule', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event({ cookie: good(), query: { msg: 'starting' } }));
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Running since');
  expect(res.body).toContain('Players: 2 / 10');
  expect(res.body).toContain('value="03:00"');
  expect(res.body).toContain('Starting the server');
  expect(header(res, 'cache-control')).toBe('no-store');
});

test('player query is skipped when stopped and unknown when it times out', async () => {
  const stopped = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  let queried = 0;
  const d = deps(stopped.aws);
  d.queryPlayers = async () => { queried += 1; return null; };
  const res = await createHandler(d)(event({ cookie: good() }));
  expect(queried).toBe(0);
  expect(res.body).toContain('Stopped');

  const running = fakeAws();
  const d2 = deps(running.aws);
  d2.queryPlayers = async () => null;
  expect((await createHandler(d2)(event({ cookie: good() }))).body).toContain('Players: unknown');
});

test('POST without a cookie or from another origin is rejected', async () => {
  const { aws, calls } = fakeAws();
  const h = createHandler(deps(aws));
  expect((await h(event({ method: 'POST', path: '/action', body: 'action=stop', origin: sameOrigin }))).statusCode).toBe(401);
  expect((await h(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good(), origin: 'https://evil.example' }))).statusCode).toBe(403);
  expect((await h(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good() }))).statusCode).toBe(403);
  expect(calls).toEqual([]);
});

test('start when stopped starts the instance and redirects', async () => {
  const { aws, calls } = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=start', cookie: good(), origin: sameOrigin }));
  expect(calls).toEqual(['start:i-123']);
  expect(res.statusCode).toBe(303);
  expect(header(res, 'location')).toBe('/?msg=starting');
});

test('stop when already stopped is a no-op with a message', async () => {
  const { aws, calls } = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good(), origin: sameOrigin }));
  expect(calls).toEqual([]);
  expect(header(res, 'location')).toBe('/?msg=already-stopped');
});

test('schedule save validates times and updates both schedules', async () => {
  const f = fakeAws();
  const h = createHandler(deps(f.aws));
  const bad = await h(event({ method: 'POST', path: '/schedule', body: 'enabled=on&stopAt=9:00&startAt=16:00', cookie: good(), origin: sameOrigin }));
  expect(header(bad, 'location')).toBe('/?msg=bad-time');
  expect(f.calls).toEqual([]);

  const ok = await h(event({ method: 'POST', path: '/schedule', body: 'enabled=on&stopAt=02:30&startAt=17:00', cookie: good(), origin: sameOrigin }));
  expect(header(ok, 'location')).toBe('/?msg=schedule-saved');
  expect(f.schedules()).toEqual({ enabled: true, stopCron: 'cron(30 2 * * ? *)', startCron: 'cron(0 17 * * ? *)' });

  const off = await h(event({ method: 'POST', path: '/schedule', body: 'stopAt=02:30&startAt=17:00', cookie: good(), origin: sameOrigin }));
  expect(header(off, 'location')).toBe('/?msg=schedule-saved');
  expect(f.schedules().enabled).toBe(false);
});

test('an AWS failure on an action redirects with the error message', async () => {
  const { aws } = fakeAws({ startInstance: async () => { throw new Error('boom'); }, describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=start', cookie: good(), origin: sameOrigin }));
  expect(header(res, 'location')).toBe('/?msg=error');
});

test('logout clears the cookie', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/logout', cookie: good(), origin: sameOrigin }));
  expect(res.statusCode).toBe(303);
  expect(res.cookies?.[0]).toContain('Max-Age=0');
});

test('unknown paths are 404', async () => {
  const { aws } = fakeAws();
  expect((await createHandler(deps(aws))(event({ path: '/nope' }))).statusCode).toBe(404);
});

test('readEnv requires every variable and parses ports', () => {
  const full = {
    INSTANCE_ID: 'i-1', SERVER_HOST: 'h', GAME_PORT: '2456', QUERY_PORT: '2457', SECRET_ARN: 'a',
    STOP_SCHEDULE_NAME: 's', START_SCHEDULE_NAME: 't', TIMEZONE: 'America/Toronto', SERVER_NAME: 'n',
  };
  expect(readEnv(full)).toEqual({
    instanceId: 'i-1', serverHost: 'h', gamePort: 2456, queryPort: 2457, secretArn: 'a',
    stopScheduleName: 's', startScheduleName: 't', timezone: 'America/Toronto', serverName: 'n',
  });
  const { SECRET_ARN: _omit, ...missing } = full;
  expect(() => readEnv(missing)).toThrow(/SECRET_ARN/);
});
