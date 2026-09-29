import { config } from '../lib/config';
import { buildUserData, MOUNT_POINT } from '../lib/user-data';

const script = buildUserData({
  region: 'us-east-1',
  dataVolumeId: 'vol-0123456789abcdef0',
  composeParameterName: '/valheim/compose',
  secretArn: 'arn:aws:secretsmanager:us-east-1:309448544182:secret:valheim-AbCdEf',
  worlds: config.worlds,
});

test('is a strict bash script without xtrace', () => {
  expect(script.startsWith('#!/bin/bash\n')).toBe(true);
  expect(script).toContain('set -euo pipefail');
  expect(script).not.toMatch(/set -[a-z]*x/);
});

test('waits for the network before installing anything', () => {
  const wait = script.indexOf('curl -fsS --max-time 5 https://awscli.amazonaws.com/');
  expect(wait).toBeGreaterThan(0);
  expect(wait).toBeLessThan(script.indexOf('apt-get install'));
});

test('installs the aws cli with the official installer and docker from the docker repo', () => {
  expect(script).toContain('https://awscli.amazonaws.com/v2/install.sh');
  expect(script).toContain('docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin');
  expect(script).toContain('"max-size": "50m"');
  expect(script).toContain('"max-file": "3"');
});

test('mounts the data volume by label and formats only when blank', () => {
  expect(script).toContain('nvme-Amazon_Elastic_Block_Store_${VOLUME_ID//-/}');
  expect(script).toContain('VOLUME_ID="vol-0123456789abcdef0"');
  expect(script).toContain('if ! blkid "$DEVICE"');
  expect(script).toContain('mkfs.ext4 -L valheim');
  expect(script).toContain(`LABEL=valheim ${MOUNT_POINT} ext4 defaults,nofail 0 2`);
});

test('fetches compose, secret, mods and overrides at every service start, then syncs mods', () => {
  expect(script).toContain('aws ssm get-parameter --region "$REGION" --name "$PARAM"');
  expect(script).toContain('aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET"');
  expect(script).toContain('REGION="us-east-1"');
  expect(script).toContain('PARAM="/valheim/compose"');
  expect(script).toContain('SECRET="arn:aws:secretsmanager:us-east-1:309448544182:secret:valheim-AbCdEf"');
  expect(script).toContain('umask 077');
  expect(script).toContain('ExecStartPre=/usr/local/bin/valheim-fetch-config');
  expect(script).toContain('aws ssm get-parameter --region "$REGION" --name /valheim/mods/packages');
  expect(script).toContain('aws ssm get-parameters-by-path --region "$REGION" --path /valheim/mods/config/');
  expect(script).toContain('/usr/local/bin/valheim-mods sync /opt/valheim/mods.json /opt/valheim/mods-config.json');
  expect(script).toContain('mkdir -p /opt/valheim/worlds/iron-arbiters-world/config /opt/valheim/worlds/iron-arbiters-world/data');
  expect(script).toContain('chown 1000:1000 /opt/valheim/worlds/iron-arbiters-world/config /opt/valheim/worlds/iron-arbiters-world/data');
  expect(script).toContain('/usr/local/bin/valheim-mods sync /opt/valheim/mods.json /opt/valheim/mods-config.json --config-root /opt/valheim/config/bepinex --install-root /opt/valheim/data/bepinex/BepInEx --cache /opt/valheim/mods-cache');
  expect(script).toContain('/usr/local/bin/valheim-mods sync /opt/valheim/mods.json /opt/valheim/mods-config.json --config-root /opt/valheim/worlds/iron-arbiters-world/config/bepinex --install-root /opt/valheim/worlds/iron-arbiters-world/data/bepinex/BepInEx --cache /opt/valheim/mods-cache');
  expect(script).toContain("cat > /usr/local/bin/valheim-mods <<'PYEOF'");
  expect(script).toContain('Got character ZDOID from');
  const fetch = script.indexOf('cat > /usr/local/bin/valheim-fetch-config');
  const unit = script.indexOf('cat > /etc/systemd/system/valheim.service');
  expect(fetch).toBeGreaterThan(0);
  expect(fetch).toBeLessThan(unit);
});

test('installs a systemd unit that stops the container gracefully', () => {
  expect(script).toContain('Requires=docker.service');
  expect(script).toContain('After=docker.service network-online.target');
  expect(script).toContain('Type=oneshot');
  expect(script).toContain('RemainAfterExit=yes');
  expect(script).toContain(`ExecStart=/usr/bin/docker compose -f ${MOUNT_POINT}/compose.yaml up -d`);
  expect(script).toContain(`ExecStop=/usr/bin/docker compose -f ${MOUNT_POINT}/compose.yaml stop -t 120`);
  expect(script).toContain('TimeoutStopSec=150');
  expect(script).toContain('systemctl enable --now valheim.service');
});

test('installs one player watcher per world', () => {
  expect(script).toContain('ExecStart=/usr/bin/python3 /usr/local/bin/valheim-players /valheim/panel/players us-east-1 valheim');
  expect(script).toContain('ExecStart=/usr/bin/python3 /usr/local/bin/valheim-players /valheim/panel/players-iron-arbiters-world us-east-1 valheim-iron-arbiters-world');
  expect(script).toContain('systemctl enable --now valheim-players.service');
  expect(script).toContain('systemctl enable --now valheim-players-iron-arbiters-world.service');
  expect(script).toContain("cat > /usr/local/bin/valheim-players <<'PYEOF'");
});
