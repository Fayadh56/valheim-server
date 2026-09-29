import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { WorldConfig } from './config';
import { containerName, playersParameterName, slugify } from './worlds';

export const PLAYERS_WATCHER_PATH = '/usr/local/bin/valheim-players';
export const PLAYERS_WATCHER_SCRIPT = readFileSync(path.join(__dirname, '..', 'server', 'valheim-players.py'), 'utf8');

export function playersWatcherUnit(region: string, parameter: string, container: string): string {
  return `[Unit]
Description=Publish who is online in Valheim (${container}) to SSM
Requires=docker.service
After=docker.service valheim.service
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/bin/python3 ${PLAYERS_WATCHER_PATH} ${parameter} ${region} ${container}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

export function playersWatcherUnitName(index: number, world: WorldConfig): string {
  return index === 0 ? 'valheim-players.service' : `valheim-players-${slugify(world.name)}.service`;
}

export function playersWatcherInstall(region: string, worlds: WorldConfig[]): string {
  const units = worlds.map((world, index) => ({
    name: playersWatcherUnitName(index, world),
    body: playersWatcherUnit(region, playersParameterName(index, world), containerName(index, world)),
  }));
  return `cat > ${PLAYERS_WATCHER_PATH} <<'PYEOF'
${PLAYERS_WATCHER_SCRIPT}
PYEOF
chmod 0755 ${PLAYERS_WATCHER_PATH}
${units.map((u) => `cat > /etc/systemd/system/${u.name} <<'EOF'
${u.body}
EOF`).join('\n')}
systemctl daemon-reload
${units.map((u) => `systemctl enable --now ${u.name}
systemctl restart ${u.name}`).join('\n')}`;
}
