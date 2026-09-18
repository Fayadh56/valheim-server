import { stringify } from 'yaml';
import { ServerConfig } from './config';

const IMAGE = 'ghcr.io/community-valheim-tools/valheim-server';

export const ENV_FILE_PATH = '/opt/valheim/.env';

export function composeDefinition(c: ServerConfig): Record<string, unknown> {
  const environment: Record<string, string> = {
    SERVER_NAME: c.serverName,
    WORLD_NAME: c.worldName,
    SERVER_PUBLIC: 'false',
    SERVER_ARGS: `-saveinterval ${c.saveIntervalSeconds}`,
    ADMINLIST_IDS: c.adminSteamIds.join(' '),
    PUID: '1000',
    PGID: '1000',
    TZ: c.timezone,
    UPDATE_CRON: '0 * * * *',
    UPDATE_IF_IDLE: 'true',
    RESTART_CRON: '10 5 * * *',
    BACKUPS: 'true',
    BACKUPS_CRON: '5 * * * *',
    BACKUPS_MAX_COUNT: '48',
    BACKUPS_MAX_AGE: '3',
  };
  if (c.discordNotifications) {
    environment.POST_SERVER_LISTENING_HOOK = discordHook('Valheim server is up');
    environment.PRE_SERVER_SHUTDOWN_HOOK = discordHook('Valheim server is shutting down');
  }
  return {
    services: {
      valheim: {
        image: `${IMAGE}:${c.imageTag}`,
        container_name: 'valheim',
        cap_add: ['sys_nice'],
        stop_grace_period: '2m',
        restart: 'unless-stopped',
        ports: ['2456-2457:2456-2457/udp'],
        env_file: [ENV_FILE_PATH],
        environment,
        volumes: ['/opt/valheim/config:/config', '/opt/valheim/data:/opt/valheim'],
      },
    },
  };
}

// `$$` stops compose from interpolating at parse time; the container shell expands
// DISCORD_WEBHOOK at run time, so the URL never appears in the compose file.
function discordHook(message: string): string {
  return `curl -sfSL -X POST -H 'Content-Type: application/json' -d '{"content":"${message}"}' "$$DISCORD_WEBHOOK"`;
}

export function renderCompose(c: ServerConfig): string {
  return stringify(composeDefinition(c));
}
