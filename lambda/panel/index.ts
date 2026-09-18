import type { APIGatewayProxyStructuredResultV2 as Result, LambdaFunctionURLEvent } from 'aws-lambda';
import { COOKIE_MAX_AGE_SECONDS, COOKIE_NAME, passwordsMatch, signCookie, verifyCookie } from './auth';
import type { Aws } from './aws';
import { InstanceState, MESSAGES, PanelView, renderIconSvg, renderLogin, renderPanel } from './html';
import { ICON_180_PNG_BASE64 } from './icon';
import { parsePlayers } from './players';
import { cronToTime, timeToCron, validateTime } from './schedule';
import { NO_TIMER } from './sleep';
import { buildStatus } from './status';

export interface Env {
  instanceId: string;
  serverHost: string;
  gamePort: number;
  queryPort: number;
  secretArn: string;
  stopScheduleName: string;
  startScheduleName: string;
  timezone: string;
  serverName: string;
  sleepEnabledParameter: string;
  emptySinceParameter: string;
  playersParameter: string;
  sleepIdleMinutes: number;
}

export interface Deps {
  aws: Aws;
  env: Env;
  queryPlayers(host: string, port: number): Promise<{ players: number; maxPlayers: number } | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const PASSWORD_CACHE_MS = 5 * 60 * 1000;
const WRONG_PASSWORD_DELAY_MS = 1000;
const NO_STORE = 'no-store';
const DAY = 'public, max-age=86400';
const PINE = '#14201B';

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const need = (name: string): string => {
    const value = source[name];
    if (!value) throw new Error(`missing environment variable ${name}`);
    return value;
  };
  return {
    instanceId: need('INSTANCE_ID'),
    serverHost: need('SERVER_HOST'),
    gamePort: Number(need('GAME_PORT')),
    queryPort: Number(need('QUERY_PORT')),
    secretArn: need('SECRET_ARN'),
    stopScheduleName: need('STOP_SCHEDULE_NAME'),
    startScheduleName: need('START_SCHEDULE_NAME'),
    timezone: need('TIMEZONE'),
    serverName: need('SERVER_NAME'),
    sleepEnabledParameter: need('SLEEP_ENABLED_PARAMETER'),
    emptySinceParameter: need('EMPTY_SINCE_PARAMETER'),
    playersParameter: need('PLAYERS_PARAMETER'),
    sleepIdleMinutes: Number(need('SLEEP_IDLE_MINUTES')),
  };
}

export function createHandler(deps: Deps) {
  const { aws, env } = deps;
  let cachedPassword: { value: string; fetchedAt: number } | undefined;

  const password = async (): Promise<string> => {
    if (!cachedPassword || deps.now() - cachedPassword.fetchedAt > PASSWORD_CACHE_MS) {
      cachedPassword = { value: await aws.getServerPassword(env.secretArn), fetchedAt: deps.now() };
    }
    return cachedPassword.value;
  };

  return async (event: LambdaFunctionURLEvent): Promise<Result> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method === 'GET' && path === '/manifest.webmanifest') return manifest();
    if (method === 'GET' && path === '/icon.svg') return { statusCode: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': DAY }, body: renderIconSvg() };
    if (method === 'GET' && path === '/icon-180.png') return { statusCode: 200, headers: { 'content-type': 'image/png', 'cache-control': DAY }, body: ICON_180_PNG_BASE64, isBase64Encoded: true };

    const secret = await password();
    const authed = verifyCookie(secret, cookieValue(event), deps.now());

    if (method === 'GET' && path === '/') {
      return authed ? html(renderPanel(await view(event.queryStringParameters?.msg))) : html(renderLogin());
    }
    if (method === 'GET' && path === '/status.json') {
      if (!authed) return json(401, { error: 'login' });
      return json(200, buildStatus(await view()));
    }
    if (method === 'POST' && path === '/login') {
      const submitted = form(event).get('password') ?? '';
      if (!passwordsMatch(submitted, secret)) {
        await deps.sleep(WRONG_PASSWORD_DELAY_MS);
        return html(renderLogin('Wrong password'));
      }
      const cookie = signCookie(secret, deps.now() + COOKIE_MAX_AGE_SECONDS * 1000);
      return redirect('/', [`${COOKIE_NAME}=${cookie}; ${COOKIE_ATTRIBUTES}; Max-Age=${COOKIE_MAX_AGE_SECONDS}`]);
    }
    if (method === 'POST') {
      if (!authed) return text(401, 'Log in first');
      if (!sameOrigin(event)) return text(403, 'Cross-site request rejected');
      if (path === '/logout') return redirect('/', [`${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`]);
      if (path === '/action') return action(form(event).get('action'));
      if (path === '/schedule') return saveNightWatch(form(event));
    }
    return text(404, 'Not found');
  };

  async function view(msg?: string): Promise<PanelView> {
    const [instance, schedules, sleepEnabled, emptySince, playersRaw] = await Promise.all([
      aws.describeInstance(env.instanceId),
      aws.getSchedules(env.stopScheduleName, env.startScheduleName),
      aws.getParameter(env.sleepEnabledParameter),
      aws.getParameter(env.emptySinceParameter),
      aws.getParameter(env.playersParameter),
    ]);
    const nowIso = new Date(deps.now()).toISOString();
    const running = instance.state === 'running';
    const info = running ? await deps.queryPlayers(env.serverHost, env.queryPort) : null;
    return {
      serverName: env.serverName,
      state: toState(instance.state),
      sinceIso: instance.launchTime?.toISOString(),
      players: info?.players,
      maxPlayers: info?.maxPlayers,
      connectString: `${env.serverHost}:${env.gamePort}`,
      steamString: `${env.serverHost}:${env.queryPort}`,
      schedule: { enabled: schedules.enabled, stopAt: cronToTime(schedules.stopCron), startAt: cronToTime(schedules.startCron) },
      sleepWhenEmpty: {
        enabled: sleepEnabled === 'true',
        emptySince: emptySince && emptySince !== NO_TIMER ? emptySince : null,
        idleMinutes: env.sleepIdleMinutes,
      },
      playerNames: parsePlayers(playersRaw, new Date(nowIso)),
      timezone: env.timezone,
      message: msg ? MESSAGES[msg] : undefined,
      nowIso,
    };
  }

  async function action(name: string | null): Promise<Result> {
    if (name !== 'start' && name !== 'stop') return text(400, 'Unknown action');
    try {
      const { state } = await aws.describeInstance(env.instanceId);
      if (name === 'start') {
        if (state !== 'stopped') return redirect('/?msg=already-running');
        await aws.startInstance(env.instanceId);
        return redirect('/?msg=starting');
      }
      if (state !== 'running') return redirect('/?msg=already-stopped');
      await aws.stopInstance(env.instanceId);
      return redirect('/?msg=stopping');
    } catch (error) {
      console.error('action failed', error);
      return redirect('/?msg=error');
    }
  }

  async function saveNightWatch(fields: URLSearchParams): Promise<Result> {
    const stopAt = fields.get('stopAt') ?? '';
    const startAt = fields.get('startAt') ?? '';
    if (!validateTime(stopAt) || !validateTime(startAt)) return redirect('/?msg=bad-time');
    try {
      await aws.updateSchedules(env.stopScheduleName, env.startScheduleName, {
        enabled: fields.get('mode') === 'nightly',
        stopCron: timeToCron(stopAt),
        startCron: timeToCron(startAt),
      });
      await aws.putParameter(env.sleepEnabledParameter, fields.get('sleepWhenEmpty') === 'on' ? 'true' : 'false');
      return redirect('/?msg=schedule-saved');
    } catch (error) {
      console.error('night watch update failed', error);
      return redirect('/?msg=error');
    }
  }

  function manifest(): Result {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/manifest+json', 'cache-control': DAY },
      body: JSON.stringify({
        name: 'Valheim server',
        short_name: 'Valheim',
        start_url: '/',
        display: 'standalone',
        background_color: PINE,
        theme_color: PINE,
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon-180.png', sizes: '180x180', type: 'image/png' },
        ],
      }),
    };
  }
}

const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

function cookieValue(event: LambdaFunctionURLEvent): string | undefined {
  const prefix = `${COOKIE_NAME}=`;
  return event.cookies?.find((c) => c.startsWith(prefix))?.slice(prefix.length);
}

function form(event: LambdaFunctionURLEvent): URLSearchParams {
  const raw = event.body ?? '';
  return new URLSearchParams(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
}

// Browsers send Origin on form posts; fall back to Referer for the rare client that omits it.
function sameOrigin(event: LambdaFunctionURLEvent): boolean {
  const host = event.headers.host;
  const source = event.headers.origin ?? event.headers.referer;
  if (!host || !source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function toState(state: string): InstanceState {
  return (['running', 'stopped', 'pending', 'stopping'] as const).find((s) => s === state) ?? 'unknown';
}

function html(body: string): Result {
  return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_STORE }, body };
}

function json(statusCode: number, body: unknown): Result {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE }, body: JSON.stringify(body) };
}

function text(statusCode: number, body: string): Result {
  return { statusCode, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NO_STORE }, body };
}

function redirect(location: string, cookies?: string[]): Result {
  return { statusCode: 303, headers: { location, 'cache-control': NO_STORE }, body: '', ...(cookies ? { cookies } : {}) };
}
