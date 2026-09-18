import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { MODS_CONFIG_PATH, MODS_PARAMETER_NAME } from './mods';
import { playersWatcherInstall } from './players-watcher';

export const MOUNT_POINT = '/opt/valheim';
export const FETCH_CONFIG_PATH = '/usr/local/bin/valheim-fetch-config';
export const MODS_SYNC_PATH = '/usr/local/bin/valheim-mods';
export const MODS_SYNC_SCRIPT = readFileSync(path.join(__dirname, '..', 'server', 'valheim-mods.py'), 'utf8');

export interface InstanceScriptOptions {
  region: string;
  composeParameterName: string;
  secretArn: string;
}

export function fetchConfigScript(o: InstanceScriptOptions): string {
  return `#!/bin/bash
set -euo pipefail
REGION="${o.region}"
PARAM="${o.composeParameterName}"
SECRET="${o.secretArn}"
aws ssm get-parameter --region "$REGION" --name "$PARAM" --query Parameter.Value --output text > ${MOUNT_POINT}/compose.yaml.tmp
mv ${MOUNT_POINT}/compose.yaml.tmp ${MOUNT_POINT}/compose.yaml
SECRET_JSON="$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET" --query SecretString --output text)"
umask 077
printf 'SERVER_PASS=%s\\nDISCORD_WEBHOOK=%s\\n' \\
  "$(jq -r .password <<<"$SECRET_JSON")" \\
  "$(jq -r .discordWebhook <<<"$SECRET_JSON")" > ${MOUNT_POINT}/.env.tmp
mv ${MOUNT_POINT}/.env.tmp ${MOUNT_POINT}/.env
umask 022
aws ssm get-parameter --region "$REGION" --name ${MODS_PARAMETER_NAME} --query Parameter.Value --output text > ${MOUNT_POINT}/mods.json.tmp
mv ${MOUNT_POINT}/mods.json.tmp ${MOUNT_POINT}/mods.json
aws ssm get-parameters-by-path --region "$REGION" --path ${MODS_CONFIG_PATH}/ --query 'Parameters[].[Name,Value]' --output json > ${MOUNT_POINT}/mods-config.json.tmp
mv ${MOUNT_POINT}/mods-config.json.tmp ${MOUNT_POINT}/mods-config.json
${MODS_SYNC_PATH} sync ${MOUNT_POINT}/mods.json ${MOUNT_POINT}/mods-config.json
`;
}

// Shared by cloud-init on new instances and by scripts/install-scripts.ts on the live one
export function installScripts(o: InstanceScriptOptions): string {
  return `cat > ${FETCH_CONFIG_PATH} <<'EOF'
${fetchConfigScript(o)}EOF
chmod 0755 ${FETCH_CONFIG_PATH}
cat > ${MODS_SYNC_PATH} <<'PYEOF'
${MODS_SYNC_SCRIPT}
PYEOF
chmod 0755 ${MODS_SYNC_PATH}
${playersWatcherInstall(o.region)}`;
}
