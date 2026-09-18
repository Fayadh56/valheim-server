# Valheim Server on AWS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy an always-on, private Valheim 1.0 dedicated server on one EC2 instance, fully defined in CDK, with an optional nightly stop/start schedule.

**Architecture:** One CDK stack composed of small constructs: Network (VPC, security group, Elastic IP), ServerSettings (Secrets Manager password, SSM parameter holding the rendered compose file), ServerInstance (IAM role, retained data volume, m7a.large with a thin cloud-init bootstrapper that installs Docker and a systemd unit), Backups (DLM daily snapshots), optional Schedule (EventBridge Scheduler), CostGuard (Budget). Pure functions render the compose file and the boot script so they are unit-testable without AWS.

**Tech Stack:** TypeScript, aws-cdk-lib 2.270+, Jest 30 with @swc/jest, `yaml` package, bash operator script, Docker image `ghcr.io/community-valheim-tools/valheim-server:1.3.0`.

**Spec:** `docs/superpowers/specs/2026-09-17-valheim-server-aws-design.md`

## Global Constraints

- Region `us-east-1`, AZ `us-east-1a`, account `309448544182`, AWS profile `valheim`. Never use the `eks-dev` profile.
- Instance `m7a.large`, Ubuntu 24.04 AMI from `/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id` with `cachedInContext: true`.
- Image tag pinned to `1.3.0`. Never `latest`.
- Only UDP 2456-2457 inbound. No SSH, no key pair, no port 2458 or 9001.
- Data volume and Elastic IP use `RemovalPolicy.RETAIN`. Stack has `terminationProtection: true`.
- Compose file is stored in an SSM String parameter and fetched at every service start. Password lives only in Secrets Manager and in a mode-600 `.env` on the data volume.
- Every EC2 stop must run `docker compose stop -t 120` via the systemd unit.
- Git: repo-local identity `Fayadh Ahmed <fayadh56@gmail.com>`. Commit messages are short imperative sentences. No `Co-Authored-By` lines. No em dashes anywhere (code comments, docs, commits).
- Comments only for non-obvious logic. README prose stays short.
- Run `npm test` and `npx tsc --noEmit` before every commit. `npx cdk synth` needs AWS credentials until the AMI is cached, so only Task 12 runs it.
- Working directory for every command: `/Users/fayadh.ahmed/Documents/valheim-server`.

---

## File structure

| Path | Responsibility |
|---|---|
| `bin/valheim-server.ts` | CDK app entry. Instantiates the stack with `env` from config. |
| `lib/config.ts` | `ServerConfig` type, `validateConfig`, the `config` constant. Single source of user-editable values. |
| `lib/compose.ts` | Pure: `composeDefinition(config)` object and `renderCompose(config)` YAML string. |
| `lib/user-data.ts` | Pure: `buildUserData(options)` returns the bash bootstrap script. |
| `lib/network.ts` | `Network` construct: VPC, security group, Elastic IP allocation. |
| `lib/server-settings.ts` | `ServerSettings` construct: secret and compose parameter. |
| `lib/server-instance.ts` | `ServerInstance` construct: role, data volume, instance, attachment, EIP association. |
| `lib/backups.ts` | `Backups` construct: tag on data volume, DLM role and policy. |
| `lib/schedule.ts` | `Schedule` construct: two EventBridge Scheduler rules. |
| `lib/cost-guard.ts` | `CostGuard` construct: AWS Budget. |
| `lib/valheim-server-stack.ts` | Composes constructs, emits outputs. |
| `scripts/server.sh` | Operator commands: ip, status, start, stop, restart, logs, shell, password, set-webhook. |
| `test/helpers.ts` | `synth(overrides)` returning an assertions `Template`. |
| `test/*.test.ts` | One test file per module. |
| `README.md` | Runbook. |

---

### Task 1: Scaffold the CDK project and push to GitHub

**Files:**
- Create: `package.json`, `tsconfig.json`, `jest.config.js`, `cdk.json`, `.gitignore`, `.npmignore` (generated), `bin/valheim-server.ts`, `lib/valheim-server-stack.ts`, `test/valheim-server.test.ts` (generated, replaced in later tasks)

**Interfaces:**
- Produces: a project where `npm test` and `npx tsc --noEmit` run. The generated `lib/valheim-server-stack.ts` is a placeholder that Task 5 rewrites.

- [ ] **Step 1: Generate the template in a scratch directory named like the repo**

`cdk init` refuses a non-empty directory, so generate elsewhere and copy in.

```bash
TMP="$(mktemp -d)/valheim-server" && mkdir -p "$TMP" && cd "$TMP" \
  && npx --yes aws-cdk@latest init app --language typescript --generate-only \
  && ls
```
Expected: `bin/ lib/ test/ cdk.json jest.config.js package.json tsconfig.json README.md .gitignore .npmignore`.

- [ ] **Step 2: Copy into the repo, keeping the existing docs and .git**

```bash
rsync -a --exclude .git "$TMP/" /Users/fayadh.ahmed/Documents/valheim-server/ \
  && cd /Users/fayadh.ahmed/Documents/valheim-server && git status --short
```
Expected: new untracked files listed; `docs/` untouched.

- [ ] **Step 3: Install dependencies and add `yaml`**

```bash
npm install && npm install yaml
```
Expected: `node_modules/` created, `yaml` in `dependencies`.

- [ ] **Step 4: Verify the toolchain**

```bash
npx tsc --noEmit && npm test
```
Expected: tsc silent, Jest reports the generated sample test file (it may contain only a commented example and report "no tests", which is fine). If `npx tsc` fails because of the TypeScript 7 pin in the template, run `npm install --save-dev typescript@~5.9` and retry.

- [ ] **Step 5: Confirm `cdk.context.json` is not ignored**

```bash
grep -n 'cdk.context' .gitignore || echo "not ignored (good)"
```
Expected: `not ignored (good)`. If it is listed, delete that line; the cached AMI id must be committed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Scaffold CDK TypeScript project"
```

- [ ] **Step 7: Create the private GitHub repo and push**

```bash
gh repo create valheim-server --private --source . --remote origin --push \
  && git remote -v
```
Expected: `origin https://github.com/Fayadh56/valheim-server.git` and the two commits pushed.

---

### Task 2: Config module with validation

**Files:**
- Create: `lib/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScheduleConfig { enabled: boolean; stopAt: string; startAt: string }
  export interface ServerConfig {
    account: string; region: string; az: string; instanceType: string;
    serverName: string; worldName: string; adminSteamIds: string[];
    alertEmail: string; budgetUsd: number; imageTag: string;
    saveIntervalSeconds: number; timezone: string;
    schedule: ScheduleConfig; discordNotifications: boolean;
  }
  export function validateConfig(c: ServerConfig): ServerConfig  // throws Error listing every problem
  export const config: ServerConfig                              // the real, validated values
  ```

- [ ] **Step 1: Write the failing tests**

`test/config.test.ts`:
```ts
import { config, validateConfig, ServerConfig } from '../lib/config';

const valid: ServerConfig = { ...config };

test('real config is valid', () => {
  expect(() => validateConfig(config)).not.toThrow();
});

test('rejects a non 12 digit account', () => {
  expect(() => validateConfig({ ...valid, account: '123' })).toThrow(/account/);
});

test('rejects an az outside the region', () => {
  expect(() => validateConfig({ ...valid, az: 'us-west-2a' })).toThrow(/az/);
});

test('rejects latest as image tag', () => {
  expect(() => validateConfig({ ...valid, imageTag: 'latest' })).toThrow(/imageTag/);
});

test('rejects malformed steam ids', () => {
  expect(() => validateConfig({ ...valid, adminSteamIds: ['abc'] })).toThrow(/adminSteamIds/);
});

test('rejects bad schedule times', () => {
  expect(() => validateConfig({ ...valid, schedule: { ...valid.schedule, stopAt: '25:00' } })).toThrow(/HH:MM/);
});

test('reports every problem at once', () => {
  expect(() => validateConfig({ ...valid, account: 'x', imageTag: 'latest' })).toThrow(/account[\s\S]*imageTag/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/config.test.ts`
Expected: FAIL, cannot find module `../lib/config`.

- [ ] **Step 3: Implement**

`lib/config.ts`:
```ts
export interface ScheduleConfig {
  enabled: boolean;
  stopAt: string;
  startAt: string;
}

export interface ServerConfig {
  account: string;
  region: string;
  az: string;
  instanceType: string;
  serverName: string;
  worldName: string;
  adminSteamIds: string[];
  alertEmail: string;
  budgetUsd: number;
  imageTag: string;
  saveIntervalSeconds: number;
  timezone: string;
  schedule: ScheduleConfig;
  discordNotifications: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateConfig(c: ServerConfig): ServerConfig {
  const errors: string[] = [];
  if (!/^\d{12}$/.test(c.account)) errors.push('account must be 12 digits');
  if (!c.az.startsWith(c.region)) errors.push(`az ${c.az} is not in region ${c.region}`);
  if (!/^[A-Za-z0-9 _-]{1,64}$/.test(c.serverName)) errors.push('serverName: letters, digits, space, _ or -, max 64');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(c.worldName)) errors.push('worldName: letters, digits, _ or -, max 32');
  if (c.adminSteamIds.some((id) => !/^\d{17}$/.test(id))) errors.push('adminSteamIds must be 17-digit SteamID64 values');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.alertEmail)) errors.push('alertEmail is not an email address');
  if (!Number.isInteger(c.budgetUsd) || c.budgetUsd <= 0) errors.push('budgetUsd must be a positive integer');
  if (!/^\d+\.\d+\.\d+$/.test(c.imageTag)) errors.push('imageTag must be a pinned x.y.z tag, not latest');
  if (!Number.isInteger(c.saveIntervalSeconds) || c.saveIntervalSeconds < 60) errors.push('saveIntervalSeconds must be an integer of at least 60');
  if (!HHMM.test(c.schedule.stopAt) || !HHMM.test(c.schedule.startAt)) errors.push('schedule times must be HH:MM (24h)');
  if (errors.length > 0) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  return c;
}

export const config: ServerConfig = validateConfig({
  account: '309448544182',
  region: 'us-east-1',
  az: 'us-east-1a',
  instanceType: 'm7a.large',
  serverName: 'valheim-osrs-nerds',
  worldName: 'OsrsNerds',
  adminSteamIds: ['76561198097010635'],
  alertEmail: 'fayadh56@gmail.com',
  budgetUsd: 115,
  imageTag: '1.3.0',
  saveIntervalSeconds: 900,
  timezone: 'America/Toronto',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  discordNotifications: false,
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/config.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add lib/config.ts test/config.test.ts && git commit -m "Add validated server config"
```

---

### Task 3: Compose file renderer

**Files:**
- Create: `lib/compose.ts`
- Test: `test/compose.test.ts`

**Interfaces:**
- Consumes: `ServerConfig` from `lib/config.ts`.
- Produces:
  ```ts
  export const ENV_FILE_PATH = '/opt/valheim/.env';
  export function composeDefinition(c: ServerConfig): Record<string, unknown>
  export function renderCompose(c: ServerConfig): string   // YAML
  ```

- [ ] **Step 1: Write the failing tests**

`test/compose.test.ts`:
```ts
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

test('sets the private server environment', () => {
  const env = service().environment;
  expect(env).toMatchObject({
    SERVER_NAME: 'valheim-osrs-nerds',
    WORLD_NAME: 'OsrsNerds',
    SERVER_PUBLIC: 'false',
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
  expect(service().environment.POST_SERVER_LISTENING_HOOK).toBeUndefined();
  const env = service({ discordNotifications: true }).environment;
  expect(env.POST_SERVER_LISTENING_HOOK).toContain('$$DISCORD_WEBHOOK');
  expect(env.PRE_SERVER_SHUTDOWN_HOOK).toContain('$$DISCORD_WEBHOOK');
  expect(env.POST_SERVER_LISTENING_HOOK).not.toMatch(/https?:/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/compose.test.ts`
Expected: FAIL, cannot find module `../lib/compose`.

- [ ] **Step 3: Implement**

`lib/compose.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/compose.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add lib/compose.ts test/compose.test.ts && git commit -m "Render docker compose file from config"
```

---

### Task 4: Boot script builder

**Files:**
- Create: `lib/user-data.ts`
- Test: `test/user-data.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MOUNT_POINT = '/opt/valheim';
  export interface UserDataOptions { region: string; dataVolumeId: string; composeParameterName: string; secretArn: string }
  export function buildUserData(o: UserDataOptions): string
  ```
  All four option values may be CDK tokens; the function only concatenates them.

- [ ] **Step 1: Write the failing tests**

`test/user-data.test.ts`:
```ts
import { buildUserData, MOUNT_POINT } from '../lib/user-data';

const script = buildUserData({
  region: 'us-east-1',
  dataVolumeId: 'vol-0123456789abcdef0',
  composeParameterName: '/valheim/compose',
  secretArn: 'arn:aws:secretsmanager:us-east-1:309448544182:secret:valheim-AbCdEf',
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
});

test('mounts the data volume by label and formats only when blank', () => {
  expect(script).toContain('nvme-Amazon_Elastic_Block_Store_${VOLUME_ID//-/}');
  expect(script).toContain('VOLUME_ID="vol-0123456789abcdef0"');
  expect(script).toContain('if ! blkid "$DEVICE"');
  expect(script).toContain('mkfs.ext4 -L valheim');
  expect(script).toContain(`LABEL=valheim ${MOUNT_POINT} ext4 defaults,nofail 0 2`);
});

test('fetches compose and secret at every service start', () => {
  expect(script).toContain('aws ssm get-parameter --region "$REGION" --name "$PARAM"');
  expect(script).toContain('aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET"');
  expect(script).toContain('REGION="us-east-1"');
  expect(script).toContain('PARAM="/valheim/compose"');
  expect(script).toContain('SECRET="arn:aws:secretsmanager:us-east-1:309448544182:secret:valheim-AbCdEf"');
  expect(script).toContain('umask 077');
  expect(script).toContain('ExecStartPre=/usr/local/bin/valheim-fetch-config');
});

test('installs a systemd unit that stops the container gracefully', () => {
  expect(script).toContain('Requires=docker.service');
  expect(script).toContain('After=docker.service network-online.target');
  expect(script).toContain(`ExecStart=/usr/bin/docker compose -f ${MOUNT_POINT}/compose.yaml up -d`);
  expect(script).toContain(`ExecStop=/usr/bin/docker compose -f ${MOUNT_POINT}/compose.yaml stop -t 120`);
  expect(script).toContain('TimeoutStopSec=150');
  expect(script).toContain('systemctl enable --now valheim.service');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/user-data.test.ts`
Expected: FAIL, cannot find module `../lib/user-data`.

- [ ] **Step 3: Implement**

`lib/user-data.ts`. Note the escaping: `\${...}` keeps bash parameter expansion out of the TS template, and `\\n` gives printf a literal `\n`.

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/user-data.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add lib/user-data.ts test/user-data.test.ts && git commit -m "Build the instance boot script"
```

---

### Task 5: Network construct and stack skeleton

**Files:**
- Create: `lib/network.ts`, `test/helpers.ts`, `test/stack.test.ts`
- Modify: `lib/valheim-server-stack.ts` (replace generated content), `bin/valheim-server.ts` (replace generated content)
- Delete: `test/valheim-server.test.ts` (generated placeholder)

**Interfaces:**
- Produces:
  ```ts
  // lib/network.ts
  export const GAME_PORT = 2456; export const QUERY_PORT = 2457;
  export class Network extends Construct { readonly vpc: ec2.Vpc; readonly securityGroup: ec2.SecurityGroup; readonly eip: ec2.CfnEIP }
  // lib/valheim-server-stack.ts
  export interface ValheimServerStackProps extends cdk.StackProps { config: ServerConfig }
  export class ValheimServerStack extends cdk.Stack
  // test/helpers.ts
  export function synth(overrides?: Partial<ServerConfig>): Template
  ```

- [ ] **Step 1: Write the helper and failing tests**

`test/helpers.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { config, ServerConfig, validateConfig } from '../lib/config';
import { ValheimServerStack } from '../lib/valheim-server-stack';

export function synth(overrides: Partial<ServerConfig> = {}): Template {
  const merged = validateConfig({ ...config, ...overrides });
  const app = new cdk.App();
  const stack = new ValheimServerStack(app, 'TestStack', {
    config: merged,
    env: { account: merged.account, region: merged.region },
  });
  return Template.fromStack(stack);
}
```

`test/stack.test.ts`:
```ts
import { Match } from 'aws-cdk-lib/assertions';
import { synth } from './helpers';

describe('network', () => {
  const template = synth();

  test('one public subnet, no NAT, no default-SG lambda', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 1);
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::Lambda::Function', 0);
    template.hasResourceProperties('AWS::EC2::Subnet', { AvailabilityZone: 'us-east-1a', MapPublicIpOnLaunch: true });
  });

  test('security group allows only udp 2456-2457 from anywhere', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        Match.objectLike({ IpProtocol: 'udp', FromPort: 2456, ToPort: 2457, CidrIp: '0.0.0.0/0' }),
      ],
    });
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
    expect(JSON.stringify(template.toJSON())).not.toMatch(/"FromPort":22/);
  });

  test('elastic ip is retained', () => {
    template.hasResource('AWS::EC2::EIP', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `rm test/valheim-server.test.ts && npm test -- test/stack.test.ts`
Expected: FAIL, `ValheimServerStack` props mismatch or module not found.

- [ ] **Step 3: Implement the network construct**

`lib/network.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export const GAME_PORT = 2456;
export const QUERY_PORT = 2457;

export interface NetworkProps {
  az: string;
}

export class Network extends Construct {
  readonly vpc: ec2.Vpc;
  readonly securityGroup: ec2.SecurityGroup;
  readonly eip: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/24'),
      availabilityZones: [props.az],
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      restrictDefaultSecurityGroup: false,
    });

    this.securityGroup = new ec2.SecurityGroup(this, 'ServerSecurityGroup', {
      vpc: this.vpc,
      description: 'Valheim server: game and query ports only',
      allowAllOutbound: true,
    });
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udpRange(GAME_PORT, QUERY_PORT),
      'Valheim game and Steam query',
    );

    this.eip = new ec2.CfnEIP(this, 'Eip', { domain: 'vpc' });
    this.eip.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  }
}
```

- [ ] **Step 4: Rewrite the stack and app entry**

`lib/valheim-server-stack.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServerConfig } from './config';
import { Network } from './network';

export interface ValheimServerStackProps extends cdk.StackProps {
  config: ServerConfig;
}

export class ValheimServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ValheimServerStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    const network = new Network(this, 'Network', { az: config.az });

    new cdk.CfnOutput(this, 'PublicIp', { value: network.eip.attrPublicIp });
  }
}
```

`bin/valheim-server.ts`:
```ts
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { config } from '../lib/config';
import { ValheimServerStack } from '../lib/valheim-server-stack';

const app = new cdk.App();
new ValheimServerStack(app, 'ValheimServerStack', {
  config,
  env: { account: config.account, region: config.region },
  description: 'Valheim dedicated server',
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- test/stack.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "Add network construct and stack skeleton"
```

---

### Task 6: ServerSettings construct (secret and compose parameter)

**Files:**
- Create: `lib/server-settings.ts`
- Modify: `lib/valheim-server-stack.ts`
- Test: `test/stack.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `renderCompose` from `lib/compose.ts`.
- Produces:
  ```ts
  export class ServerSettings extends Construct { readonly secret: secretsmanager.Secret; readonly composeParameter: ssm.StringParameter }
  ```

- [ ] **Step 1: Append failing tests**

Append to `test/stack.test.ts`:
```ts
describe('server settings', () => {
  const template = synth();

  test('generates a 12 character alphanumeric password inside a json secret', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: '{"discordWebhook":""}',
        GenerateStringKey: 'password',
        PasswordLength: 12,
        ExcludePunctuation: true,
      }),
    });
  });

  test('stores the compose file in an ssm parameter without secrets or extra ports', () => {
    const params = template.findResources('AWS::SSM::Parameter');
    const values = Object.values(params).map((p) => p.Properties.Value as string);
    expect(values).toHaveLength(1);
    expect(values[0]).toContain('valheim-server:1.3.0');
    expect(values[0]).not.toMatch(/SERVER_PASS|2458|9001/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: FAIL on both new tests (no secret, no parameter).

- [ ] **Step 3: Implement**

`lib/server-settings.ts`:
```ts
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { renderCompose } from './compose';
import { ServerConfig } from './config';

export interface ServerSettingsProps {
  config: ServerConfig;
}

export class ServerSettings extends Construct {
  readonly secret: secretsmanager.Secret;
  readonly composeParameter: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: ServerSettingsProps) {
    super(scope, id);

    this.secret = new secretsmanager.Secret(this, 'Secret', {
      description: 'Valheim server password and optional Discord webhook',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ discordWebhook: '' }),
        generateStringKey: 'password',
        passwordLength: 12,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    this.composeParameter = new ssm.StringParameter(this, 'ComposeParameter', {
      description: 'docker compose file for the Valheim server',
      stringValue: renderCompose(props.config),
    });
  }
}
```

In `lib/valheim-server-stack.ts`, after the `Network` line add:
```ts
    const settings = new ServerSettings(this, 'Settings', { config });
```
and the import `import { ServerSettings } from './server-settings';`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/stack.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "Add server password secret and compose parameter"
```

---

### Task 7: ServerInstance construct

**Files:**
- Create: `lib/server-instance.ts`
- Modify: `lib/valheim-server-stack.ts`
- Test: `test/stack.test.ts` (append)

**Interfaces:**
- Consumes: `Network`, `ServerSettings`, `buildUserData`.
- Produces:
  ```ts
  export const UBUNTU_AMI_PARAMETER = '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id';
  export const DATA_DEVICE = '/dev/sdf';
  export class ServerInstance extends Construct { readonly instance: ec2.Instance; readonly dataVolume: ec2.Volume; readonly role: iam.Role }
  ```

- [ ] **Step 1: Append failing tests**

```ts
describe('server instance', () => {
  const template = synth();
  const json = JSON.stringify(template.toJSON());

  test('is an m7a.large in the pinned az with imdsv2 and no launch template', () => {
    template.hasResourceProperties('AWS::EC2::Instance', Match.objectLike({
      InstanceType: 'm7a.large',
      AvailabilityZone: 'us-east-1a',
      MetadataOptions: Match.objectLike({ HttpTokens: 'required', HttpPutResponseHopLimit: 1 }),
      BlockDeviceMappings: [
        Match.objectLike({ DeviceName: '/dev/sda1', Ebs: Match.objectLike({ VolumeSize: 16, VolumeType: 'gp3', Encrypted: true }) }),
      ],
    }));
    template.resourceCountIs('AWS::EC2::LaunchTemplate', 0);
    template.resourceCountIs('AWS::EC2::KeyPair', 0);
  });

  test('has a retained encrypted 30 GiB data volume attached at /dev/sdf', () => {
    template.hasResource('AWS::EC2::Volume', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: Match.objectLike({ Size: 30, VolumeType: 'gp3', Encrypted: true, AvailabilityZone: 'us-east-1a' }),
    });
    template.hasResourceProperties('AWS::EC2::VolumeAttachment', { Device: '/dev/sdf' });
  });

  test('associates the elastic ip', () => {
    template.resourceCountIs('AWS::EC2::EIPAssociation', 1);
  });

  test('role has ssm core access and read on the secret', () => {
    expect(json).toContain('AmazonSSMManagedInstanceCore');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'] }),
        ]),
      }),
    });
  });

  test('user data is the bootstrapper, not a config bake', () => {
    expect(json).toContain('valheim.service');
    expect(json).toContain('valheim-fetch-config');
    // the fetch script writes SERVER_PASS=%s at runtime; a literal 12-char value would mean a baked password
    expect(json).not.toMatch(/SERVER_PASS=[A-Za-z0-9]{12}/);
    expect(json).not.toMatch(/set -[a-z]*x/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: FAIL on the five new tests.

- [ ] **Step 3: Implement**

`lib/server-instance.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ServerConfig } from './config';
import { Network } from './network';
import { ServerSettings } from './server-settings';
import { buildUserData } from './user-data';

export const UBUNTU_AMI_PARAMETER =
  '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id';
export const DATA_DEVICE = '/dev/sdf';

export interface ServerInstanceProps {
  config: ServerConfig;
  network: Network;
  settings: ServerSettings;
}

export class ServerInstance extends Construct {
  readonly instance: ec2.Instance;
  readonly dataVolume: ec2.Volume;
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ServerInstanceProps) {
    super(scope, id);
    const { config, network, settings } = props;
    const stack = cdk.Stack.of(this);

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    settings.secret.grantRead(this.role);
    settings.composeParameter.grantRead(this.role);

    this.dataVolume = new ec2.Volume(this, 'DataVolume', {
      availabilityZone: config.az,
      size: cdk.Size.gibibytes(30),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userData = ec2.UserData.custom(
      buildUserData({
        region: stack.region,
        dataVolumeId: this.dataVolume.volumeId,
        composeParameterName: settings.composeParameter.parameterName,
        secretArn: settings.secret.secretArn,
      }),
    );

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      availabilityZone: config.az,
      instanceType: new ec2.InstanceType(config.instanceType),
      // cachedInContext pins the AMI in cdk.context.json so a routine deploy never replaces the instance
      machineImage: ec2.MachineImage.fromSsmParameter(UBUNTU_AMI_PARAMETER, {
        os: ec2.OperatingSystemType.LINUX,
        cachedInContext: true,
      }),
      securityGroup: network.securityGroup,
      role: this.role,
      userData,
      // The Elastic IP is the only public address; the boot script waits for it
      associatePublicIpAddress: false,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(16, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 1,
      detailedMonitoring: false,
      userDataCausesReplacement: false,
    });
    cdk.Tags.of(this.instance).add('Name', 'valheim-server');

    new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
      volumeId: this.dataVolume.volumeId,
      instanceId: this.instance.instanceId,
      device: DATA_DEVICE,
    });

    new ec2.CfnEIPAssociation(this, 'EipAssociation', {
      allocationId: network.eip.attrAllocationId,
      instanceId: this.instance.instanceId,
    });
  }
}
```

In `lib/valheim-server-stack.ts` after the settings line:
```ts
    const server = new ServerInstance(this, 'Server', { config, network, settings });
```
with import `import { ServerInstance } from './server-instance';`. Add output:
```ts
    new cdk.CfnOutput(this, 'InstanceId', { value: server.instance.instanceId });
```

If `httpPutResponseHopLimit` or `httpTokens` is rejected by the compiler, check `node -e "console.log(Object.keys(require('aws-cdk-lib/aws-ec2').HttpTokens))"`; if absent, upgrade aws-cdk-lib with `npm install aws-cdk-lib@latest`. Do not fall back to `requireImdsv2` (it creates a launch template and the test forbids it).

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/stack.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "Add server instance with retained data volume"
```

---

### Task 8: Backups construct (DLM)

**Files:**
- Create: `lib/backups.ts`
- Modify: `lib/valheim-server-stack.ts`
- Test: `test/stack.test.ts` (append)

**Interfaces:**
- Consumes: `server.dataVolume: ec2.Volume`.
- Produces: `export class Backups extends Construct`, constants `BACKUP_TAG`, `SNAPSHOT_TIME_UTC`, `SNAPSHOTS_TO_KEEP`.

- [ ] **Step 1: Append failing tests**

```ts
describe('backups', () => {
  const template = synth();

  test('tags the data volume for dlm', () => {
    template.hasResourceProperties('AWS::EC2::Volume', {
      Tags: Match.arrayWith([{ Key: 'Backup', Value: 'daily' }]),
    });
  });

  test('daily snapshot policy at 10:00 utc keeping 7', () => {
    template.hasResourceProperties('AWS::DLM::LifecyclePolicy', {
      State: 'ENABLED',
      PolicyDetails: Match.objectLike({
        PolicyType: 'EBS_SNAPSHOT_MANAGEMENT',
        ResourceTypes: ['VOLUME'],
        TargetTags: [{ Key: 'Backup', Value: 'daily' }],
        Schedules: [
          Match.objectLike({
            CreateRule: { Interval: 24, IntervalUnit: 'HOURS', Times: ['10:00'] },
            RetainRule: { Count: 7 },
            CopyTags: true,
          }),
        ],
      }),
    });
    expect(JSON.stringify(template.toJSON())).toContain('service-role/AWSDataLifecycleManagerServiceRole');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: FAIL on both.

- [ ] **Step 3: Implement**

`lib/backups.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import * as dlm from 'aws-cdk-lib/aws-dlm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export const BACKUP_TAG = { key: 'Backup', value: 'daily' };
// 10:00 UTC is 05:00 EST / 06:00 EDT, inside the stopped window when the schedule is on
export const SNAPSHOT_TIME_UTC = '10:00';
export const SNAPSHOTS_TO_KEEP = 7;

export interface BackupsProps {
  dataVolume: ec2.Volume;
}

export class Backups extends Construct {
  constructor(scope: Construct, id: string, props: BackupsProps) {
    super(scope, id);

    cdk.Tags.of(props.dataVolume).add(BACKUP_TAG.key, BACKUP_TAG.value);

    // Fresh accounts have no AWSDataLifecycleManagerDefaultRole, so make our own
    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSDataLifecycleManagerServiceRole'),
      ],
    });

    new dlm.CfnLifecyclePolicy(this, 'DailySnapshots', {
      description: 'Daily snapshots of the Valheim data volume',
      state: 'ENABLED',
      executionRoleArn: role.roleArn,
      policyDetails: {
        policyType: 'EBS_SNAPSHOT_MANAGEMENT',
        resourceTypes: ['VOLUME'],
        targetTags: [BACKUP_TAG],
        schedules: [
          {
            name: 'Daily',
            createRule: { interval: 24, intervalUnit: 'HOURS', times: [SNAPSHOT_TIME_UTC] },
            retainRule: { count: SNAPSHOTS_TO_KEEP },
            copyTags: true,
          },
        ],
      },
    });
  }
}
```

In the stack after the server line:
```ts
    new Backups(this, 'Backups', { dataVolume: server.dataVolume });
```
with import `import { Backups } from './backups';`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/stack.test.ts`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "Add daily EBS snapshots of the data volume"
```

---

### Task 9: Optional Schedule construct

**Files:**
- Create: `lib/schedule.ts`
- Modify: `lib/valheim-server-stack.ts`
- Test: `test/stack.test.ts` (append)

**Interfaces:**
- Consumes: `server.instance: ec2.Instance`, `ScheduleConfig`, `config.timezone`.
- Produces: `export class Schedule extends Construct`.

- [ ] **Step 1: Append failing tests**

```ts
describe('schedule', () => {
  test('creates nothing when disabled', () => {
    synth().resourceCountIs('AWS::Scheduler::Schedule', 0);
  });

  test('creates stop and start schedules in toronto time when enabled', () => {
    const template = synth({ schedule: { enabled: true, stopAt: '03:00', startAt: '16:00' } });
    template.resourceCountIs('AWS::Scheduler::Schedule', 2);
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      ScheduleExpression: 'cron(0 3 * * ? *)',
      ScheduleExpressionTimezone: 'America/Toronto',
      FlexibleTimeWindow: { Mode: 'OFF' },
    }));
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      ScheduleExpression: 'cron(0 16 * * ? *)',
    }));
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('aws-sdk:ec2:stopInstances');
    expect(json).toContain('aws-sdk:ec2:startInstances');
    expect(json).not.toContain('"Resource":"*"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: first new test passes (nothing exists yet), second FAILS.

- [ ] **Step 3: Check `TimeZone.of` exists**

```bash
node -e "const c=require('aws-cdk-lib'); console.log(typeof c.TimeZone.of, c.TimeZone.AMERICA_TORONTO.timezoneName)"
```
Expected: `function America/Toronto`. If `of` is `undefined`, replace `cdk.TimeZone.of(props.timezone)` below with a lookup: `const tz = props.timezone === 'America/Toronto' ? cdk.TimeZone.AMERICA_TORONTO : cdk.TimeZone.ETC_UTC;` and add a config validation error for unsupported zones.

- [ ] **Step 4: Implement**

`lib/schedule.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';
import { ScheduleConfig } from './config';

export interface ScheduleProps {
  instance: ec2.Instance;
  schedule: ScheduleConfig;
  timezone: string;
}

export class Schedule extends Construct {
  constructor(scope: Construct, id: string, props: ScheduleProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const tz = cdk.TimeZone.of(props.timezone);
    const instanceArn = stack.formatArn({
      service: 'ec2',
      resource: 'instance',
      resourceName: props.instance.instanceId,
    });
    const input = scheduler.ScheduleTargetInput.fromObject({ InstanceIds: [props.instance.instanceId] });

    const ec2Call = (action: 'stopInstances' | 'startInstances', iamAction: string) =>
      new targets.Universal({
        service: 'ec2',
        action,
        input,
        policyStatements: [new iam.PolicyStatement({ actions: [iamAction], resources: [instanceArn] })],
      });

    new scheduler.Schedule(this, 'Stop', {
      schedule: cronAt(props.schedule.stopAt, tz),
      target: ec2Call('stopInstances', 'ec2:StopInstances'),
      description: 'Stop the Valheim server for the night',
    });

    new scheduler.Schedule(this, 'Start', {
      schedule: cronAt(props.schedule.startAt, tz),
      target: ec2Call('startInstances', 'ec2:StartInstances'),
      description: 'Start the Valheim server for the evening',
    });
  }
}

function cronAt(hhmm: string, timeZone: cdk.TimeZone): scheduler.ScheduleExpression {
  const [hour, minute] = hhmm.split(':').map(Number);
  return scheduler.ScheduleExpression.cron({ minute: String(minute), hour: String(hour), timeZone });
}
```

In the stack after the backups line:
```ts
    if (config.schedule.enabled) {
      new Schedule(this, 'Schedule', {
        instance: server.instance,
        schedule: config.schedule,
        timezone: config.timezone,
      });
    }
```
with import `import { Schedule } from './schedule';`.

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- test/stack.test.ts`
Expected: 14 passed. If the `"Resource":"*"` assertion fails, inspect `template.findResources('AWS::IAM::Policy')` for the scheduler role and confirm the `policyStatements` were applied; the `Universal` target must not fall back to its default wildcard policy.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "Add optional nightly stop and start schedule"
```

---

### Task 10: CostGuard, outputs, snapshot test

**Files:**
- Create: `lib/cost-guard.ts`
- Modify: `lib/valheim-server-stack.ts`
- Test: `test/stack.test.ts` (append), `test/__snapshots__/stack.test.ts.snap` (generated)

**Interfaces:**
- Produces: `export class CostGuard extends Construct`; stack outputs `PublicIp`, `ConnectString`, `SteamFavoritesString`, `InstanceId`, `DataVolumeId`, `SecretArn`, `ComposeParameterName`, `ShellCommand`, `PasswordCommand`. `scripts/server.sh` (Task 11) reads these by key.

- [ ] **Step 1: Append failing tests**

```ts
describe('cost guard and outputs', () => {
  const template = synth();

  test('monthly budget with actual 80% and forecast 100% email alerts', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: 115, Unit: 'USD' },
      }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', Threshold: 80, ThresholdType: 'PERCENTAGE' }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'fayadh56@gmail.com' }],
        }),
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'FORECASTED', Threshold: 100 }),
        }),
      ],
    });
  });

  test('exposes the operator outputs', () => {
    const outputs = Object.keys(template.findOutputs('*'));
    expect(outputs.sort()).toEqual([
      'ComposeParameterName', 'ConnectString', 'DataVolumeId', 'InstanceId',
      'PasswordCommand', 'PublicIp', 'SecretArn', 'ShellCommand', 'SteamFavoritesString',
    ]);
  });

  test('template snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: budget and outputs tests FAIL; snapshot is written on first run (passes).

- [ ] **Step 3: Implement**

`lib/cost-guard.ts`:
```ts
import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';

export interface CostGuardProps {
  budgetUsd: number;
  email: string;
}

export class CostGuard extends Construct {
  constructor(scope: Construct, id: string, props: CostGuardProps) {
    super(scope, id);
    const subscribers = [{ subscriptionType: 'EMAIL', address: props.email }];

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'valheim-server-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.budgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers,
        },
        {
          notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' },
          subscribers,
        },
      ],
    });
  }
}
```

Final `lib/valheim-server-stack.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Backups } from './backups';
import { ServerConfig } from './config';
import { CostGuard } from './cost-guard';
import { GAME_PORT, Network, QUERY_PORT } from './network';
import { Schedule } from './schedule';
import { ServerInstance } from './server-instance';
import { ServerSettings } from './server-settings';

export interface ValheimServerStackProps extends cdk.StackProps {
  config: ServerConfig;
}

export class ValheimServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ValheimServerStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    const network = new Network(this, 'Network', { az: config.az });
    const settings = new ServerSettings(this, 'Settings', { config });
    const server = new ServerInstance(this, 'Server', { config, network, settings });
    new Backups(this, 'Backups', { dataVolume: server.dataVolume });
    if (config.schedule.enabled) {
      new Schedule(this, 'Schedule', {
        instance: server.instance,
        schedule: config.schedule,
        timezone: config.timezone,
      });
    }
    new CostGuard(this, 'CostGuard', { budgetUsd: config.budgetUsd, email: config.alertEmail });

    const ip = network.eip.attrPublicIp;
    const instanceId = server.instance.instanceId;
    new cdk.CfnOutput(this, 'PublicIp', { value: ip });
    new cdk.CfnOutput(this, 'ConnectString', { value: `${ip}:${GAME_PORT}`, description: 'In-game Join IP' });
    new cdk.CfnOutput(this, 'SteamFavoritesString', { value: `${ip}:${QUERY_PORT}`, description: 'Steam server browser favorites' });
    new cdk.CfnOutput(this, 'InstanceId', { value: instanceId });
    new cdk.CfnOutput(this, 'DataVolumeId', { value: server.dataVolume.volumeId });
    new cdk.CfnOutput(this, 'SecretArn', { value: settings.secret.secretArn });
    new cdk.CfnOutput(this, 'ComposeParameterName', { value: settings.composeParameter.parameterName });
    new cdk.CfnOutput(this, 'ShellCommand', {
      value: `aws ssm start-session --target ${instanceId} --region ${this.region}`,
    });
    new cdk.CfnOutput(this, 'PasswordCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${settings.secret.secretArn} --region ${this.region} --query SecretString --output text`,
    });
  }
}
```

- [ ] **Step 4: Run to verify pass, then refresh the snapshot**

Run: `npm test -- test/stack.test.ts -u && npm test`
Expected: all suites pass (config 7, compose 7, user-data 6, stack 17). The `-u` rewrites the snapshot taken in step 2 against the finished stack.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "Add budget alert, stack outputs and template snapshot"
```

---

### Task 11: Operator script, npm scripts, README

**Files:**
- Create: `scripts/server.sh`
- Modify: `package.json` (scripts), `README.md` (replace generated content)

**Interfaces:**
- Consumes: stack outputs by key (`InstanceId`, `SecretArn`, `ConnectString`, `SteamFavoritesString`).
- Produces: `npm run deploy|diff|synth|server -- <cmd>`.

- [ ] **Step 1: Write the script**

`scripts/server.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-valheim}"
STACK="${STACK_NAME:-ValheimServerStack}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

secret_json() {
  aws secretsmanager get-secret-value --secret-id "$(output SecretArn)" --query SecretString --output text
}

# Runs one shell command on the instance through SSM and prints status, stdout, stderr.
run_on_server() {
  local id cmd_id
  id="$(output InstanceId)"
  cmd_id="$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
    --parameters "commands=[\"$1\"]" --query Command.CommandId --output text)"
  aws ssm wait command-executed --command-id "$cmd_id" --instance-id "$id" || true
  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
    --query '[Status, StandardOutputContent, StandardErrorContent]' --output text
}

case "${1:-}" in
  ip)
    echo "Join IP:          $(output ConnectString)"
    echo "Steam favorites:  $(output SteamFavoritesString)" ;;
  status)
    aws ec2 describe-instances --instance-ids "$(output InstanceId)" \
      --query 'Reservations[0].Instances[0].State.Name' --output text ;;
  start)
    aws ec2 start-instances --instance-ids "$(output InstanceId)" \
      --query 'StartingInstances[0].CurrentState.Name' --output text ;;
  stop)
    aws ec2 stop-instances --instance-ids "$(output InstanceId)" \
      --query 'StoppingInstances[0].CurrentState.Name' --output text ;;
  restart)
    run_on_server 'systemctl restart valheim && systemctl is-active valheim' ;;
  logs)
    run_on_server "docker logs --tail ${2:-100} valheim 2>&1" ;;
  service)
    run_on_server 'systemctl status valheim --no-pager; df -h /opt/valheim; ls -la /opt/valheim/config/worlds_local 2>/dev/null' ;;
  shell)
    aws ssm start-session --target "$(output InstanceId)" ;;
  password)
    secret_json | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' ;;
  set-webhook)
    [ -n "${2:-}" ] || { echo "usage: $0 set-webhook <discord webhook url>" >&2; exit 1; }
    updated="$(secret_json | python3 -c 'import json,sys; d=json.load(sys.stdin); d["discordWebhook"]=sys.argv[1]; print(json.dumps(d))' "$2")"
    aws secretsmanager put-secret-value --secret-id "$(output SecretArn)" --secret-string "$updated" \
      --query VersionId --output text
    echo "Now set discordNotifications: true in lib/config.ts, then npm run deploy and npm run server -- restart" ;;
  *)
    echo "usage: $0 {ip|status|start|stop|restart|logs [lines]|service|shell|password|set-webhook <url>}" >&2
    exit 1 ;;
esac
```

- [ ] **Step 2: Syntax check and usage test**

```bash
chmod +x scripts/server.sh && bash -n scripts/server.sh && (scripts/server.sh || true) 2>&1 | head -1
```
Expected: `usage: scripts/server.sh {ip|status|...}`.

- [ ] **Step 3: Add npm scripts**

In `package.json` replace the `scripts` block with:
```json
"scripts": {
  "build": "tsc",
  "test": "jest",
  "synth": "cdk synth",
  "diff": "cdk diff --profile ${AWS_PROFILE:-valheim}",
  "deploy": "cdk deploy --profile ${AWS_PROFILE:-valheim} --require-approval never",
  "bootstrap": "cdk bootstrap aws://309448544182/us-east-1 --profile ${AWS_PROFILE:-valheim}",
  "server": "bash scripts/server.sh",
  "cdk": "cdk"
}
```
Keep any other existing keys (`watch` may be dropped).

- [ ] **Step 4: Write the README**

Replace `README.md` with this content (short by design):

````markdown
# valheim-server

Private Valheim 1.0 dedicated server on AWS, defined with CDK. One m7a.large in us-east-1,
always on, with an optional nightly schedule. Design: `docs/superpowers/specs/`.

## Prerequisites

- Personal AWS account, IAM user with admin, logged in: `aws login --profile valheim`
- `brew install --cask session-manager-plugin`
- Node 22, `npm install`

## First deploy

```bash
npm run bootstrap        # once per account
npm test
npm run deploy           # 5 to 10 minutes; first boot installs Docker and pulls the image
npm run server -- ip     # share with friends
npm run server -- password
```
Commit `cdk.context.json` after the first deploy. It pins the Ubuntu AMI.

## Day to day

| Task | Command |
|---|---|
| Is it up | `npm run server -- status` and `npm run server -- logs 50` |
| Start / stop | `npm run server -- start` / `npm run server -- stop` (stop saves the world first) |
| Shell on the box | `npm run server -- shell` |
| Change a setting | edit `lib/config.ts`, `npm run deploy`, `npm run server -- restart` |
| Bump the image | change `imageTag` in `lib/config.ts`, same as above |
| Resize | change `instanceType`, `npm run deploy` (about 10 min downtime) |
| Nightly schedule | set `schedule.enabled: true`, `npm run deploy` |
| Discord alerts | `npm run server -- set-webhook <url>`, then follow the printed steps |

## Joining

In game: Start Game, Join Game, Join IP, paste the Join IP string, enter the password.
Steam server browser: View, Game Servers, Favorites, add the Steam favorites string.

## Admin

Steam IDs in `adminSteamIds` get admin. In game press F5 for the console: `kick`, `ban`, `save`.

## Backups and restore

Three layers: Valheim autosaves every 15 minutes, the container zips `worlds_local` hourly
(48 kept), and a daily EBS snapshot of the data volume is kept for 7 days.

Small rollback: `npm run server -- shell`, then
`sudo systemctl stop valheim`, unzip a file from `/opt/valheim/config/backups/` over
`/opt/valheim/config/worlds_local/`, `sudo systemctl start valheim`.

Snapshot restore: create a volume from the snapshot in us-east-1a, attach it to the
instance at `/dev/sdg`, shell in, stop the service, mount it read-only at `/mnt/restore`,
`rsync -a --delete /mnt/restore/config/worlds_local/ /opt/valheim/config/worlds_local/`,
unmount, start the service, then detach and delete the temporary volume.

## Importing a pre-1.0 world

Copy `<World>.db` and `<World>.fwl` into `/opt/valheim/config/worlds_local/` on the
instance, set `worldName` to `<World>`, deploy and restart. The first start converts the
world to 1.0's directory format. This is one way. Keep a copy of the old files.

## Mods

Set `BEPINEX: "true"` in `lib/compose.ts`, deploy, restart. Mods go in
`/opt/valheim/config/bepinex/plugins/`.

## Maintenance

Ubuntu applies security updates automatically but does not reboot. Once a month:
`npm run server -- stop` then `start`. Watch CPU in CloudWatch during the first week and
resize to m7a.xlarge if it sits above 70% while people play.

## Refreshing the Ubuntu AMI

`npx cdk context --reset <key from cdk.context.json>` then `npm run deploy`. The instance
is replaced; the data volume and Elastic IP survive.

## Destroy

Disable termination protection in the CloudFormation console, `npx cdk destroy --profile
valheim`, then delete the retained data volume, its snapshots, and the Elastic IP by hand.

## Cost

About $102 a month always on. A budget alert emails at 80% actual and 100% forecast of $115.
````

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npx tsc --noEmit && git add -A && git commit -m "Add operator script and runbook" && git push
```

---

### Task 12: Bootstrap, deploy, verify

This task talks to AWS. Requires `aws sts get-caller-identity --profile valheim` to return `user/valheim-admin`. If it fails, the user must run `aws login --profile valheim` again.

**Files:**
- Create: `cdk.context.json` (written by the AMI lookup)

- [ ] **Step 1: Confirm identity and bootstrap**

```bash
aws sts get-caller-identity --profile valheim --query Arn --output text \
  && npm run bootstrap
```
Expected: Arn ends in `user/valheim-admin`; bootstrap ends with `Environment aws://309448544182/us-east-1 bootstrapped.`

- [ ] **Step 2: Synthesize once to cache the AMI, and commit the context**

```bash
npx cdk synth --profile valheim --quiet && cat cdk.context.json \
  && git add cdk.context.json && git commit -m "Pin Ubuntu 24.04 AMI in context"
```
Expected: `cdk.context.json` contains one `ssm:account=309448544182:parameterName=/aws/service/canonical/...:region=us-east-1` key with an `ami-` value.

- [ ] **Step 3: Show the diff, then deploy**

```bash
npm run diff 2>&1 | tail -40
```
Review: about 20 resources, all creates. Then:
```bash
npm run deploy 2>&1 | tail -30
```
Expected within 10 minutes: `ValheimServerStack: deploying...`, then `✅ ValheimServerStack` and the Outputs block including `ConnectString`.

- [ ] **Step 4: Wait for the boot script**

The instance is running but Docker install and image pull take 3 to 6 minutes. Poll:
```bash
ID=$(aws cloudformation describe-stacks --profile valheim --stack-name ValheimServerStack \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
for i in $(seq 1 30); do
  st=$(aws ssm describe-instance-information --profile valheim --filters "Key=InstanceIds,Values=$ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  echo "ssm: $st"; [ "$st" = "Online" ] && break; sleep 20
done
npm run server -- service
```
Expected: `Active: active (exited)` for valheim.service, `/opt/valheim` mounted with about 29G size, and a `worlds_local` directory (may be empty until the first save).

- [ ] **Step 5: Confirm the server is listening**

```bash
npm run server -- logs 200 | grep -Ei 'listening|Game server connected|Session "|valheim_server' | tail -5
```
Expected: a line showing the server registered or listening on 2456. If the log shows `steamcmd` still downloading, wait a minute and rerun.

- [ ] **Step 6: Hand the connect details to the user**

```bash
npm run server -- ip && npm run server -- password
```
User joins from Steam with Join IP. Confirm in `logs` that a player connected.

- [ ] **Step 7: Graceful stop test**

With the user still connected:
```bash
npm run server -- stop && sleep 90 && npm run server -- status
```
Expected: `stopping` then `stopped`. Then:
```bash
npm run server -- start && sleep 120 && npm run server -- logs 100 | grep -Ei 'World saved|Saving|Load world' | tail -5
```
Expected: the previous run's log (visible before the container recreated) contained a save on shutdown, and the new run loads the same world. The user rejoins and sees their character where they left it.

- [ ] **Step 8: Final commit and push**

```bash
git status --short && git push
```
Expected: clean tree, `main` pushed.

---

## Self-review notes

- Spec coverage: network (T5), compute and data volume (T7), secrets and compose parameter (T6), boot and systemd (T4, T7), server env (T3), backups (T8), schedule (T9), cost guard and outputs (T10), scripts and runbook (T11), pre-deploy and verification (T12). Deferred items in the spec stay deferred.
- Names used across tasks: `Network.eip`, `Network.securityGroup`, `Network.vpc`; `ServerSettings.secret`, `ServerSettings.composeParameter`; `ServerInstance.instance`, `ServerInstance.dataVolume`; `synth()` in `test/helpers.ts`; output keys listed in T10 and consumed by name in T11.
- Placeholder scan: none. Every step has its code or exact command.
