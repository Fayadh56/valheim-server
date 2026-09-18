import type { APIGatewayProxyStructuredResultV2 as Result, LambdaFunctionURLEvent } from 'aws-lambda';
import { signCookie } from '../../lambda/panel/auth';
import type { Aws, ScheduleSettings } from '../../lambda/panel/aws';
import { ICON_180_PNG_BASE64 } from '../../lambda/panel/icon';
import { createHandler, Deps, readEnv } from '../../lambda/panel/index';
import { NO_TIMER } from '../../lambda/panel/sleep';

const password = 'rEDAfML359Ba';
const now = 1_800_000_000_000;

function fakeAws(overrides: Partial<Aws> = {}) {
  const calls: string[] = [];
  let schedules: ScheduleSettings = { enabled: false, stopCron: 'cron(0 3 * * ? *)', startCron: 'cron(0 16 * * ? *)' };
  const params: Record<string, string> = {
    '/p/enabled': 'true',
    '/p/since': NO_TIMER,
    '/p/players': JSON.stringify({ players: ['Fellesin', 'Halo'], updatedAt: new Date(now - 30_000).toISOString() }),
    '/p/mods': JSON.stringify([{ namespace: 'ValheimModding', name: 'Jotunn', version: '2.30.0' }]),
    '/p/code': 'none',
  };
  const aws: Aws = {
    describeInstance: async () => ({ state: 'running', launchTime: new Date(now - 3_600_000) }),
    startInstance: async (id) => { calls.push(`start:${id}`); },
    stopInstance: async (id) => { calls.push(`stop:${id}`); },
    getSchedules: async () => schedules,
    updateSchedules: async (_s, _t, settings) => { calls.push('update'); schedules = settings; },
    getServerPassword: async () => password,
    getWebhook: async () => '',
    getParameter: async (name) => params[name] ?? '',
    putParameter: async (name, value) => { params[name] = value; calls.push(`put:${name}=${value}`); },
    postDiscord: async () => {},
    ...overrides,
  };
  return { aws, calls, schedules: () => schedules, params };
}

function deps(aws: Aws, slept: number[] = []): Deps {
  return {
    aws,
    env: {
      instanceId: 'i-123', serverHost: '100.29.76.244', gamePort: 2456, queryPort: 2457,
      secretArn: 'arn:secret', stopScheduleName: 'valheim-stop', startScheduleName: 'valheim-start',
      timezone: 'America/Toronto', serverName: 'valheim-osrs-nerds',
      sleepEnabledParameter: '/p/enabled', emptySinceParameter: '/p/since', playersParameter: '/p/players', sleepIdleMinutes: 60,
      modsParameter: '/p/mods', profileCodeParameter: '/p/code',
    },
    queryPlayers: async () => ({ players: 2, maxPlayers: 10 }),
    sleep: async (ms) => { slept.push(ms); },
    now: () => now,
  };
}

function event(opts: { method?: string; path?: string; body?: string; cookie?: string; flash?: string; origin?: string; query?: Record<string, string> } = {}): LambdaFunctionURLEvent {
  const cookies = [...(opts.cookie ? [`valheim_panel=${opts.cookie}`] : []), ...(opts.flash ? [`valheim_flash=${opts.flash}`] : [])];
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: opts.path ?? '/',
    rawQueryString: '',
    headers: { host: 'abc.lambda-url.us-east-1.on.aws', ...(opts.origin ? { origin: opts.origin } : {}) },
    cookies: cookies.length ? cookies : undefined,
    queryStringParameters: opts.query,
    requestContext: { http: { method: opts.method ?? 'GET', path: opts.path ?? '/', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'jest' } } as LambdaFunctionURLEvent['requestContext'],
    body: opts.body,
    isBase64Encoded: false,
  } as LambdaFunctionURLEvent;
}

const good = () => signCookie(password, now + 60_000);
const sameOrigin = 'https://abc.lambda-url.us-east-1.on.aws';
const header = (res: Result, name: string) => res.headers?.[name] as string | undefined;
const flashCookie = (key: string) => `valheim_flash=${key}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=60`;
const clearedFlash = 'valheim_flash=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

test('unauthenticated GET shows the login page', async () => {
  const res = await createHandler(deps(fakeAws().aws))(event());
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('name="password"');
  expect(res.body).not.toContain('The hall is open');
});

test('wrong password waits a second and re-renders login with an error', async () => {
  const slept: number[] = [];
  const res = await createHandler(deps(fakeAws().aws, slept))(event({ method: 'POST', path: '/login', body: 'password=nope' }));
  expect(slept).toEqual([1000]);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Wrong password');
  expect(res.cookies).toBeUndefined();
});

test('correct password sets a cookie and redirects home', async () => {
  const res = await createHandler(deps(fakeAws().aws))(event({ method: 'POST', path: '/login', body: `password=${password}` }));
  expect(res.statusCode).toBe(303);
  expect(header(res, 'location')).toBe('/');
  expect(res.cookies?.[0]).toMatch(/^valheim_panel=\d+\.[0-9a-f]{64}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
});

test('authenticated GET renders the hall with players, schedule and sleep setting', async () => {
  const res = await createHandler(deps(fakeAws().aws))(event({ cookie: good(), flash: 'schedule-saved' }));
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('The hall is open');
  expect(res.body).toContain('2 vikings online');
  expect(res.body).toContain('value="03:00"');
  expect(res.body).toMatch(/name="sleepWhenEmpty"[^>]*checked/);
  expect(res.body).toContain('Night watch saved.');
  expect(res.cookies).toEqual([clearedFlash]);
  expect(header(res, 'cache-control')).toBe('no-store');
});

test('a message shows once: no flash cookie means no message, and the old query is ignored', async () => {
  const res = await createHandler(deps(fakeAws().aws))(event({ cookie: good(), query: { msg: 'stopping' } }));
  expect(res.body).not.toContain('id="flash"');
  expect(res.body).not.toContain('Dousing the fires.');
  expect(res.cookies).toBeUndefined();
});

test('status json requires the cookie and mirrors the page data', async () => {
  const h = createHandler(deps(fakeAws().aws));
  const denied = await h(event({ path: '/status.json' }));
  expect(denied.statusCode).toBe(401);
  expect(header(denied, 'content-type')).toContain('application/json');
  const res = await h(event({ path: '/status.json', cookie: good() }));
  expect(res.statusCode).toBe(200);
  expect(header(res, 'cache-control')).toBe('no-store');
  const body = JSON.parse(res.body as string);
  expect(body).toMatchObject({ state: 'running', players: 2, maxPlayers: 10, schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' }, sleepWhenEmpty: { enabled: true, emptySince: null, idleMinutes: 60 } });
  expect(body.since).toBe(new Date(now - 3_600_000).toISOString());
  expect(body.updatedAt).toBe(new Date(now).toISOString());
});

test('empty-since sentinel becomes null, a timestamp passes through', async () => {
  const f = fakeAws();
  f.params['/p/since'] = '2026-09-18T00:42:00.000Z';
  const res = await createHandler(deps(f.aws))(event({ path: '/status.json', cookie: good() }));
  expect(JSON.parse(res.body as string).sleepWhenEmpty.emptySince).toBe('2026-09-18T00:42:00.000Z');
});

test('player query is skipped when stopped and unknown when it times out', async () => {
  const stopped = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  let queried = 0;
  const d = deps(stopped.aws);
  d.queryPlayers = async () => { queried += 1; return null; };
  const res = await createHandler(d)(event({ cookie: good() }));
  expect(queried).toBe(0);
  expect(res.body).toContain('The hall is dark');
  const d2 = deps(fakeAws().aws);
  d2.queryPlayers = async () => null;
  expect((await createHandler(d2)(event({ cookie: good() }))).body).toContain('Counting heads');
});

test('names appear on the page and in status json when the watcher is fresh', async () => {
  const f = fakeAws();
  const h = createHandler(deps(f.aws));
  expect((await h(event({ cookie: good() }))).body).toContain('Fellesin, Halo');
  expect(JSON.parse((await h(event({ path: '/status.json', cookie: good() }))).body as string).playerNames).toEqual(['Fellesin', 'Halo']);
});

test('stale or broken watcher data hides names', async () => {
  const f = fakeAws();
  f.params['/p/players'] = JSON.stringify({ players: ['Fellesin'], updatedAt: new Date(now - 10 * 60_000).toISOString() });
  const h = createHandler(deps(f.aws));
  expect((await h(event({ cookie: good() }))).body).toMatch(/id="names" class="names" hidden/);
  expect(JSON.parse((await h(event({ path: '/status.json', cookie: good() }))).body as string).playerNames).toBeNull();
  f.params['/p/players'] = 'garbage';
  expect(JSON.parse((await h(event({ path: '/status.json', cookie: good() }))).body as string).playerNames).toBeNull();
});

test('mods section reflects the parameters', async () => {
  const f = fakeAws();
  const h = createHandler(deps(f.aws));
  expect((await h(event({ cookie: good() }))).body).toContain('Profile code coming soon.');
  f.params['/p/code'] = 'abc-123';
  expect((await h(event({ cookie: good() }))).body).toContain('<code id="profile">abc-123</code>');
  f.params['/p/mods'] = '[]';
  expect((await h(event({ cookie: good() }))).body).not.toContain('<h2>Mods</h2>');
});

test('manifest and icons are public with the right types', async () => {
  const h = createHandler(deps(fakeAws().aws));
  const manifest = await h(event({ path: '/manifest.webmanifest' }));
  expect(manifest.statusCode).toBe(200);
  expect(header(manifest, 'content-type')).toBe('application/manifest+json');
  expect(JSON.parse(manifest.body as string)).toMatchObject({ name: 'Valheim server', short_name: 'Valheim', start_url: '/', display: 'standalone', background_color: '#14201B', theme_color: '#14201B' });
  const svg = await h(event({ path: '/icon.svg' }));
  expect(header(svg, 'content-type')).toBe('image/svg+xml');
  expect(svg.body).toContain('viewBox="0 0 512 512"');
  const png = await h(event({ path: '/icon-180.png' }));
  expect(header(png, 'content-type')).toBe('image/png');
  expect(png.isBase64Encoded).toBe(true);
  expect(png.body).toBe(ICON_180_PNG_BASE64);
  expect(header(png, 'cache-control')).toBe('public, max-age=86400');
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
  expect(header(res, 'location')).toBe('/');
  expect(res.cookies).toBeUndefined();
});

test('stop when already stopped is a no-op with a message', async () => {
  const { aws, calls } = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good(), origin: sameOrigin }));
  expect(calls).toEqual([]);
  expect(header(res, 'location')).toBe('/');
  expect(res.cookies).toEqual([flashCookie('already-stopped')]);
});

test('night watch save: nightly mode enables schedules, always mode disables them, sleep checkbox persists', async () => {
  const f = fakeAws();
  const h = createHandler(deps(f.aws));
  const nightly = await h(event({ method: 'POST', path: '/schedule', body: 'mode=nightly&stopAt=02:30&startAt=17:00&sleepWhenEmpty=on', cookie: good(), origin: sameOrigin }));
  expect(header(nightly, 'location')).toBe('/');
  expect(nightly.cookies).toEqual([flashCookie('schedule-saved')]);
  expect(f.schedules()).toEqual({ enabled: true, stopCron: 'cron(30 2 * * ? *)', startCron: 'cron(0 17 * * ? *)' });
  expect(f.params['/p/enabled']).toBe('true');
  const always = await h(event({ method: 'POST', path: '/schedule', body: 'mode=always&stopAt=02:30&startAt=17:00', cookie: good(), origin: sameOrigin }));
  expect(header(always, 'location')).toBe('/');
  expect(f.schedules().enabled).toBe(false);
  expect(f.params['/p/enabled']).toBe('false');
  const bad = await h(event({ method: 'POST', path: '/schedule', body: 'mode=nightly&stopAt=9:00&startAt=17:00', cookie: good(), origin: sameOrigin }));
  expect(header(bad, 'location')).toBe('/');
  expect(bad.cookies).toEqual([flashCookie('bad-time')]);
});

test('an AWS failure on an action redirects with the error message', async () => {
  const { aws } = fakeAws({ startInstance: async () => { throw new Error('boom'); }, describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=start', cookie: good(), origin: sameOrigin }));
  expect(header(res, 'location')).toBe('/');
  expect(res.cookies).toEqual([flashCookie('error')]);
});

test('logout clears the cookie', async () => {
  const res = await createHandler(deps(fakeAws().aws))(event({ method: 'POST', path: '/logout', cookie: good(), origin: sameOrigin }));
  expect(res.statusCode).toBe(303);
  expect(res.cookies?.[0]).toContain('Max-Age=0');
});

test('unknown paths are 404', async () => {
  expect((await createHandler(deps(fakeAws().aws))(event({ path: '/nope' }))).statusCode).toBe(404);
});

test('readEnv requires every variable and parses numbers', () => {
  const full = {
    INSTANCE_ID: 'i-1', SERVER_HOST: 'h', GAME_PORT: '2456', QUERY_PORT: '2457', SECRET_ARN: 'a',
    STOP_SCHEDULE_NAME: 's', START_SCHEDULE_NAME: 't', TIMEZONE: 'America/Toronto', SERVER_NAME: 'n',
    SLEEP_ENABLED_PARAMETER: '/e', EMPTY_SINCE_PARAMETER: '/s', PLAYERS_PARAMETER: '/p', SLEEP_IDLE_MINUTES: '60',
    MODS_PARAMETER: '/m', PROFILE_CODE_PARAMETER: '/c',
  };
  expect(readEnv(full)).toMatchObject({ gamePort: 2456, queryPort: 2457, sleepEnabledParameter: '/e', emptySinceParameter: '/s', playersParameter: '/p', sleepIdleMinutes: 60, modsParameter: '/m', profileCodeParameter: '/c' });
  const { SLEEP_IDLE_MINUTES: _omit, ...missing } = full;
  expect(() => readEnv(missing)).toThrow(/SLEEP_IDLE_MINUTES/);
});
