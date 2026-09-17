# Valheim 1.0 dedicated server on AWS

Design spec, 2026-09-17. Personal project, personal AWS and GitHub accounts only.

## Goal

An always-on, private, password-protected Valheim 1.0 dedicated server for about 10
PC/Steam friends in the US East Coast and Toronto, defined entirely in AWS CDK
(TypeScript), with an optional nightly stop/start schedule that can be switched on later
without touching the server.

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| Provider, region | AWS, us-east-1 | User choice after cost comparison. m7a is not offered in ca-central-1. Toronto to Virginia is ~16 ms, NYC ~8 ms. |
| Instance | m7a.large (2 physical Zen 4 cores up to 3.7 GHz, 8 GiB) | Single-thread bound game. Equal to the image's documented minimum, below its recommended 4 cores. Start here, resize to m7a.xlarge if CPU pegs. |
| OS | Ubuntu 24.04 LTS, Canonical AMI via SSM parameter, cached in CDK context | Default lookup re-resolves each deploy and would replace the instance on every new AMI. |
| Runtime | Docker, image `ghcr.io/community-valheim-tools/valheim-server:1.3.0` | Successor to lloesche. 1.2.0+ required for 1.0 chunked world dirs. Pin, never `latest`. |
| Mode | Always-on, schedule off by default | User choice. Schedule is a config flag. |
| Access | SSM Session Manager only, no SSH, no key pair | Smaller surface, no key management. |
| Platform | Steam PC only, no crossplay, vanilla | User choice. Ports 2456-2457/udp only. |
| IaC | AWS CDK v2 TypeScript, one stack | User knows TS. State lives in CloudFormation. |
| Repo | `~/Documents/valheim-server`, own git repo, personal GitHub | Separate from work. |

## Architecture

One CloudFormation stack, `ValheimServerStack`, termination protection on.

**Network**
- `ec2.Vpc`: `10.0.0.0/24`, `maxAzs: 1`, `availabilityZones: [config.az]` (pinned to an AZ
  that offers m7a.large), `natGateways: 0`, one `PUBLIC` subnet,
  `restrictDefaultSecurityGroup: false` (avoids a Lambda custom resource).
- `ec2.SecurityGroup`: inbound UDP 2456-2457 from `0.0.0.0/0`. Nothing else inbound.
  Outbound open.
- `ec2.CfnEIP` (domain vpc, `RemovalPolicy.RETAIN`) + `ec2.CfnEIPAssociation` by
  `allocationId` and `instanceId`.

**Compute**
- `ec2.Instance` m7a.large in the public subnet, `httpTokens: REQUIRED`,
  `httpPutResponseHopLimit: 1` (blocks the container from the instance role),
  `detailedMonitoring: false`, `userDataCausesReplacement: false`,
  `propagateTagsToVolumeOnCreation: true`.
- Root: 16 GiB gp3, encrypted, delete on termination. OS and Docker images only.
- AMI: `MachineImage.fromSsmParameter('/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id', { cachedInContext: true })`.
  Refresh deliberately with `cdk context --reset` followed by a planned rebuild.
- Instance role: `AmazonSSMManagedInstanceCore`, `secretsmanager:GetSecretValue` on the one
  secret, `ssm:GetParameter` on the compose parameter (already covered by the managed
  policy, granted explicitly for clarity).

**Data volume**
- `ec2.Volume`: 30 GiB gp3, encrypted, `RemovalPolicy.RETAIN`, tag `Backup=daily`, same
  AZ. `ec2.CfnVolumeAttachment` at `/dev/sdf`.
- Mounted at `/opt/valheim`. Holds `config/` (worlds, backups, admin lists) and `data/`
  (downloaded server files). Survives instance replacement.

**Secrets and config**
- `secretsmanager.Secret` with `generateSecretString`:
  `secretStringTemplate: '{"discordWebhook":""}'`, `generateStringKey: 'password'`,
  `passwordLength: 12`, `excludePunctuation: true`. Valheim minimum is 5 characters. No
  punctuation so shell and YAML quoting stay trivial. Discord webhook is optional and
  filled in later by an npm script that preserves the password.
- `ssm.StringParameter` holding the rendered `compose.yaml`. Rendered at synth time from
  `server/compose.yaml` with values from `config.ts`. Under the 4 KB standard-tier limit.

**Backups**
- In-container: image hourly zip of `worlds_local/` at :05, `BACKUPS_MAX_COUNT=48`,
  `BACKUPS_MAX_AGE=3`, only when idle (default).
- Game: Valheim's own autosave every `-saveinterval 900` seconds plus its rotating
  `-backups`.
- EBS: `dlm.CfnLifecyclePolicy`, `EBS_SNAPSHOT_MANAGEMENT`, `resourceTypes: ['VOLUME']`,
  `targetTags: [{Backup: daily}]`, daily at `10:00` UTC (inside the stopped window in both
  EST and EDT when the schedule is on), `retainRule.count: 7`, `copyTags: true`. Custom
  `iam.Role` for `dlm.amazonaws.com` with managed policy
  `service-role/AWSDataLifecycleManagerServiceRole`. The default DLM role does not exist
  in a fresh account.

**Optional schedule** (`config.schedule.enabled`, default `false`)
- Two `scheduler.Schedule` (stable L2 since aws-cdk-lib 2.186) with
  `scheduler_targets.Universal`: `service: 'ec2'`, `action: 'stopInstances'` /
  `'startInstances'`, input `{ InstanceIds: [instance.instanceId] }`,
  `ScheduleExpression.cron` in `TimeZone.AMERICA_TORONTO`, `policyStatements` scoped to
  the instance ARN. Zero resources when disabled.

**Cost guard**
- `budgets.CfnBudget`: monthly COST, `config.budgetUsd` (default 115),
  ACTUAL > 80% and FORECASTED > 100%, email subscriber `config.alertEmail`.

**Outputs**
- Public IP, connect string `IP:2456`, Steam favorites string `IP:2457`, instance ID,
  `aws ssm start-session --target <id>` command, `aws secretsmanager get-secret-value`
  command, data volume ID, secret ARN.

## `config.ts`

```ts
export const config = {
  account: '<12 digits>',
  region: 'us-east-1',
  az: 'us-east-1?',                  // from describe-instance-type-offerings
  instanceType: 'm7a.large',
  serverName: '<name>',
  worldName: '<world>',
  adminSteamIds: ['<steamid64>'],
  alertEmail: '<email>',
  budgetUsd: 115,
  imageTag: '1.3.0',
  saveIntervalSeconds: 900,
  timezone: 'America/Toronto',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  discordNotifications: false,       // true once the webhook is stored in the secret
};
```

`bin/valheim-server.ts` sets `env: { account, region }` from config so the AMI context
lookup works.

## Boot sequence (user data, runs once)

Thin bootstrapper. No `set -x`. Steps:

1. `apt-get install -y ca-certificates curl unzip jq`.
2. AWS CLI v2 via `curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash -s -- --system`
   (Ubuntu 24.04 has no `awscli` apt package).
3. Docker CE from the official apt repo: `docker-ce docker-ce-cli containerd.io
   docker-buildx-plugin docker-compose-plugin`. Write `/etc/docker/daemon.json` with
   `log-driver json-file`, `max-size 50m`, `max-file 3`. Enable and start.
4. Data volume: wait up to 120 s for
   `/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol<id without dash>`. If `blkid`
   reports no filesystem, `mkfs.ext4 -L valheim`. Append
   `LABEL=valheim /opt/valheim ext4 defaults,nofail 0 2` to fstab, `mount -a`, create
   `config/` and `data/`, `chown 1000:1000`.
5. Write `/usr/local/bin/valheim-fetch-config` (executable): fetches the compose
   parameter to `/opt/valheim/compose.yaml` and the secret to `/opt/valheim/.env`
   (`SERVER_PASS=...`, `DISCORD_WEBHOOK=...`, mode 600). Region passed explicitly via
   `${AWS::Region}`; parameter name and secret ARN baked in as tokens.
6. Write `/etc/systemd/system/valheim.service`:
   `Requires=docker.service`, `After=docker.service network-online.target`,
   `Wants=network-online.target`, `Type=oneshot`, `RemainAfterExit=yes`,
   `ExecStartPre=/usr/local/bin/valheim-fetch-config`,
   `ExecStart=/usr/bin/docker compose -f /opt/valheim/compose.yaml up -d`,
   `ExecStop=/usr/bin/docker compose -f /opt/valheim/compose.yaml stop -t 120`,
   `TimeoutStopSec=150`, `WantedBy=multi-user.target`. `systemctl enable --now`.
7. `unattended-upgrades` left at Ubuntu defaults (security only, no auto reboot).

Every EC2 stop, scheduled or manual, therefore runs `docker compose stop -t 120`, which
sends SIGTERM to the container, which sends SIGINT to Valheim, which saves. The image's
internal `stopwaitsecs` is 90 s, so 120 s grace is required.

## `server/compose.yaml` (rendered into the SSM parameter)

```yaml
services:
  valheim:
    image: ghcr.io/community-valheim-tools/valheim-server:${imageTag}
    container_name: valheim
    cap_add: [sys_nice]
    stop_grace_period: 2m
    restart: unless-stopped
    ports:
      - "2456-2457:2456-2457/udp"
    env_file: /opt/valheim/.env          # SERVER_PASS, DISCORD_WEBHOOK
    environment:
      SERVER_NAME: "${serverName}"
      WORLD_NAME: "${worldName}"
      SERVER_PUBLIC: "false"
      SERVER_ARGS: "-saveinterval ${saveIntervalSeconds}"
      ADMINLIST_IDS: "${adminSteamIds joined by space}"
      PUID: "1000"
      PGID: "1000"
      TZ: "${timezone}"
      UPDATE_CRON: "0 * * * *"           # hourly instead of every 15 min on 2 cores
      UPDATE_IF_IDLE: "true"
      RESTART_CRON: "10 5 * * *"         # daily idle-only restart, 05:10 local
      BACKUPS: "true"
      BACKUPS_CRON: "5 * * * *"
      BACKUPS_MAX_COUNT: "48"
      BACKUPS_MAX_AGE: "3"
      # only when discordNotifications is true:
      POST_SERVER_LISTENING_HOOK: 'curl -sfSL -X POST -H "Content-Type: application/json" -d "{\"content\":\"Valheim server is up\"}" "$$DISCORD_WEBHOOK"'
      PRE_SERVER_SHUTDOWN_HOOK:  'curl -sfSL -X POST -H "Content-Type: application/json" -d "{\"content\":\"Valheim server shutting down\"}" "$$DISCORD_WEBHOOK"'
      # `$$` defers expansion to the container shell, so the URL never appears in the compose file
    volumes:
      - /opt/valheim/config:/config
      - /opt/valheim/data:/opt/valheim
```

Do not publish 2458 or 9001. Verify the `ADMINLIST_IDS` format against the current README
during implementation (1.0 may require a `V_` prefix on IDs).

## Changing things after deploy

| Change | How |
|---|---|
| Any compose or env value | Edit `config.ts` or `server/compose.yaml`, `npm run deploy`, `npm run restart-server` (SSM `AWS-RunShellScript`: `systemctl restart valheim`). |
| Image tag | Same as above. |
| Instance size | Edit `config.instanceType`, `npm run deploy`. CloudFormation stops, resizes, starts. Data volume untouched. |
| Ubuntu AMI | `cdk context --reset <key>`, `npm run deploy`. Instance is replaced. Data volume reattaches. Plan for ~10 min downtime. |
| Boot script (user data) | Rare. CloudFormation stop/starts the instance but cloud-init does not re-run on an existing instance. Either apply the change by hand over SSM or force a rebuild by refreshing the AMI. |
| Password | `aws secretsmanager put-secret-value` via `npm run set-password`, then restart-server. |
| Discord webhook | `npm run set-webhook <url>`, set `discordNotifications: true`, deploy, restart-server. |
| Enable schedule | `schedule.enabled = true`, deploy. |

## Restore

- Small rollback: SSM session, `systemctl stop valheim`, unzip a file from
  `/opt/valheim/config/backups/` over `worlds_local/`, `systemctl start valheim`.
- Snapshot restore (keeps the stack consistent, no volume swap):
  `aws ec2 create-volume --snapshot-id ... --availability-zone ...`, attach it to the
  running instance at `/dev/sdg`, SSM session, `systemctl stop valheim`, mount the
  restored volume read-only at `/mnt/restore`, `rsync -a --delete
  /mnt/restore/config/worlds_local/ /opt/valheim/config/worlds_local/`, unmount,
  `systemctl start valheim`, then detach and delete the temporary volume. The stack's
  data volume resource is never replaced, so there is no drift.

## Testing

- Jest (SWC transform from the current `cdk init` template):
  - Template snapshot of the default stack as a `cdk diff` guard.
  - Only one ingress rule: UDP 2456-2457 from 0.0.0.0/0. No rule with port 22.
  - Instance type equals `config.instanceType`; `MetadataOptions.HttpTokens` is `required`.
  - Data volume and EIP carry `DeletionPolicy: Retain`.
  - `AWS::Scheduler::Schedule` count is 0 with schedule disabled and 2 with it enabled.
  - Compose parameter value does not contain the literal password and does not publish
    2458 or 9001.
- Post-deploy, by hand, documented in README:
  1. `npm run status` shows instance running and EIP attached.
  2. SSM session: `systemctl is-active valheim`, `docker compose logs` shows the server
     listening on 2456.
  3. Join from Steam via Join IP with the output connect string.
  4. With a player online, `npm run stop-server`. Log shows the world save before the
     container exits. `npm run start-server`, rejoin, confirm state persisted.
  5. Watch `CPUUtilization` for the first week; resize if the average during play is
     above ~70%.

## Runbook (README sections)

Prerequisites (personal AWS account, `aws login --profile valheim`, `brew install --cask
session-manager-plugin`, Node 22, `npm i -g aws-cdk`), first deploy (`cdk bootstrap`, AZ
query, `config.ts`, `npm run deploy`), sharing with friends, joining, admin commands,
logs, start and stop, enabling the schedule, changing settings, bumping the image,
restore, importing a pre-1.0 world (copy `.db`+`.fwl` into `worlds_local/`, set
`WORLD_NAME`, one-way conversion, back up first, expect minutes of silence on first load),
enabling BepInEx, monthly kernel reboot, resizing, and destroy (data volume and EIP are
retained and must be deleted by hand).

## Pre-deploy checklist (user)

1. Personal AWS account exists, root has MFA, and `aws login --profile valheim` works.
2. `brew install --cask session-manager-plugin`.
3. Pick the AZ:
   `aws ec2 describe-instance-type-offerings --location-type availability-zone --filters Name=instance-type,Values=m7a.large --region us-east-1 --profile valheim --query 'InstanceTypeOfferings[].Location' --output text`
4. Fill `config.ts`: account, az, serverName, worldName, adminSteamIds, alertEmail.
5. `cdk bootstrap aws://<account>/us-east-1 --profile valheim`.

## Deferred

Auto-recovery alarm (AWS simplified recovery is on by default for m7a), CloudWatch Logs
shipping (known log-flood bug in the current Valheim build could inflate ingestion cost),
S3 offsite copy of hourly zips, Route 53 name, web start page, idle-based stop, Savings
Plan.

## Verified facts

- Valheim 1.0 / Deep North released 2026-09-09; hotfix 1.0.12 bumped network version, so
  the server must be current. Image auto-updates when idle.
- Image tags on GHCR have no `v` prefix: 1.3.0 is current (2026-09-13).
- m7a vCPUs are physical cores, no SMT. m7a.large $0.11592/hr. Not in ca-central-1.
- Public IPv4 $0.005/hr including attached EIPs, billed while stopped. gp3 $0.08/GB-mo,
  snapshots $0.05/GB-mo. Egress 100 GB/mo free then $0.09/GB. Expected always-on total
  about $102/mo; about $60/mo with a 13 h/day schedule.
- Egress estimate: vanilla caps 60 KiB/s per client; realistic 20-40 KB/s. 10 players at
  4 h/day is roughly 85-175 GB/mo.
- Budgets with notifications only are free. EventBridge Scheduler and DLM are free.
- Ubuntu 24.04 has no `awscli` apt package and the cloud image lacks `unzip`.
- `SERVER_PUBLIC=false` servers are joinable via Join IP on `host:2456` and Steam
  favorites on `ip:2457`. Idle detection falls back to UDP datagram counting.
