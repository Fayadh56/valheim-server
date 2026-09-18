export const MOUNT_POINT = '/opt/valheim';

export interface UserDataOptions {
  region: string;
  dataVolumeId: string;
  composeParameterName: string;
  secretArn: string;
}

export function buildUserData(o: UserDataOptions): string {
  return `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# The Elastic IP attaches a few seconds after boot; wait for outbound network.
for _ in $(seq 1 60); do
  curl -fsS --max-time 5 https://awscli.amazonaws.com/ >/dev/null 2>&1 && break
  sleep 5
done

apt-get update -y
apt-get install -y ca-certificates curl unzip jq

curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash -s -- --system

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "3" } }
EOF
systemctl enable docker
systemctl restart docker

VOLUME_ID="${o.dataVolumeId}"
DEVICE="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_\${VOLUME_ID//-/}"
for _ in $(seq 1 60); do [ -e "$DEVICE" ] && break; sleep 2; done
[ -e "$DEVICE" ] || { echo "data volume $DEVICE not found"; exit 1; }
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -L valheim "$DEVICE"
fi
mkdir -p ${MOUNT_POINT}
grep -q 'LABEL=valheim' /etc/fstab || echo 'LABEL=valheim ${MOUNT_POINT} ext4 defaults,nofail 0 2' >> /etc/fstab
mount -a
mkdir -p ${MOUNT_POINT}/config ${MOUNT_POINT}/data
chown -R 1000:1000 ${MOUNT_POINT}/config ${MOUNT_POINT}/data

cat > /usr/local/bin/valheim-fetch-config <<'EOF'
#!/bin/bash
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
EOF
chmod 0755 /usr/local/bin/valheim-fetch-config

cat > /etc/systemd/system/valheim.service <<'EOF'
[Unit]
Description=Valheim dedicated server (docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${MOUNT_POINT}
ExecStartPre=/usr/local/bin/valheim-fetch-config
ExecStart=/usr/bin/docker compose -f ${MOUNT_POINT}/compose.yaml up -d
ExecStop=/usr/bin/docker compose -f ${MOUNT_POINT}/compose.yaml stop -t 120
TimeoutStopSec=150

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now valheim.service
`;
}
