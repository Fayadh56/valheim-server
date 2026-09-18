import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export const PLAYERS_PARAMETER_NAME = '/valheim/panel/players';
export const PLAYERS_WATCHER_PATH = '/usr/local/bin/valheim-players';
export const PLAYERS_WATCHER_SCRIPT = readFileSync(path.join(__dirname, '..', 'server', 'valheim-players.py'), 'utf8');

export function playersWatcherUnit(region: string): string {
  return `[Unit]
Description=Publish who is online in Valheim to SSM
Requires=docker.service
After=docker.service valheim.service
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/bin/python3 ${PLAYERS_WATCHER_PATH} ${PLAYERS_PARAMETER_NAME} ${region}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

// Shared by cloud-init on new instances and by scripts/install-watcher.ts on the live one
export function playersWatcherInstall(region: string): string {
  return `cat > ${PLAYERS_WATCHER_PATH} <<'PYEOF'
${PLAYERS_WATCHER_SCRIPT}
PYEOF
chmod 0755 ${PLAYERS_WATCHER_PATH}
cat > /etc/systemd/system/valheim-players.service <<'EOF'
${playersWatcherUnit(region)}
EOF
systemctl daemon-reload
systemctl enable --now valheim-players.service
systemctl restart valheim-players.service`;
}
