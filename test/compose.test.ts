import { parse } from 'yaml';
import { config } from '../lib/config';
import { renderCompose, ENV_FILE_PATH } from '../lib/compose';

type Service = {
  image: string; cap_add: string[]; stop_grace_period: string; restart: string;
  ports: string[]; env_file: string[]; environment: Record<string, string>; volumes: string[];
};

function service(overrides = {}): Service {
  return parse(renderCompose({ ...config, ...overrides })).services.valheim;
}

test('pins the image tag from config', () => {
  expect(service().image).toBe('ghcr.io/community-valheim-tools/valheim-server:1.3.0');
});

test('publishes only the game and query ports', () => {
  expect(service().ports).toEqual(['2456-2457:2456-2457/udp']);
});

test('has the runtime settings the image requires', () => {
  const s = service();
  expect(s.cap_add).toEqual(['sys_nice']);
  expect(s.stop_grace_period).toBe('2m');
  expect(s.restart).toBe('unless-stopped');
  expect(s.env_file).toEqual([ENV_FILE_PATH]);
  expect(s.volumes).toEqual(['/opt/valheim/config:/config', '/opt/valheim/data:/opt/valheim']);
});

test('never inlines the password', () => {
  const s = service();
  expect(Object.keys(s.environment)).not.toContain('SERVER_PASS');
  expect(renderCompose(config)).not.toMatch(/SERVER_PASS/);
});

test('sets the server environment', () => {
  const env = service().environment;
  expect(env).toMatchObject({
    SERVER_NAME: 'valheim-osrs-nerds',
    WORLD_NAME: 'OsrsNerds',
    SERVER_PUBLIC: 'true',
    SERVER_ARGS: '-saveinterval 900',
    ADMINLIST_IDS: '76561198097010635',
    PUID: '1000',
    PGID: '1000',
    TZ: 'America/Toronto',
    UPDATE_CRON: '0 * * * *',
    UPDATE_IF_IDLE: 'true',
    RESTART_CRON: '10 5 * * *',
    BACKUPS: 'true',
    BACKUPS_CRON: '5 * * * *',
    BACKUPS_MAX_COUNT: '48',
    BACKUPS_MAX_AGE: '3',
  });
});

test('joins multiple admin ids with spaces', () => {
  expect(service({ adminSteamIds: ['76561198097010635', '76561198000000001'] }).environment.ADMINLIST_IDS)
    .toBe('76561198097010635 76561198000000001');
});

test('adds discord hooks only when enabled, with compose-escaped variable', () => {
  expect(service({ discordNotifications: false }).environment.POST_SERVER_LISTENING_HOOK).toBeUndefined();
  const env = service({ discordNotifications: true }).environment;
  expect(env.POST_SERVER_LISTENING_HOOK).toContain('$$DISCORD_WEBHOOK');
  expect(env.PRE_SERVER_SHUTDOWN_HOOK).toContain('$$DISCORD_WEBHOOK');
  expect(env.POST_SERVER_LISTENING_HOOK).not.toMatch(/https?:/);
});

test('lists the server publicly so the panel can query player count', () => {
  expect(service().environment.SERVER_PUBLIC).toBe('true');
});

test('turns BepInEx on only when mods are enabled', () => {
  expect(renderCompose(config)).toContain('BEPINEX: "true"');
  expect(renderCompose({ ...config, mods: { ...config.mods, enabled: false } })).not.toContain('BEPINEX');
});
