# Two Worlds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a second Valheim world as a second container on the same instance, with the same password and mods, and show both worlds on the panel.

**Architecture:** `config.worlds` replaces `worldName`. CDK renders one compose service per world (host ports mapped to each container's 2456/2457), one firewall rule and one players parameter per world, and bakes the world list into the instance scripts so the mod sync and the player watcher run once per world. The panel and sleeper receive the list as a `WORLDS` env var and query every world. A small S3 transfers bucket plus `npm run import-world` moves save files onto the box.

**Tech Stack:** aws-cdk-lib 2.270 (`aws-ec2`, `aws-ssm`, `aws-s3`), Python 3 stdlib on the instance, Node 22 Lambda, Jest 30.

**Spec:** `docs/superpowers/specs/2026-09-28-two-worlds-design.md`

## Global Constraints

- Branch `two-worlds` from `main`. Task 1 runs in the main tree (snapshot refresh is path-dependent); Task 2 in a worktree from the same base and must not touch the snapshot. Task 3 is the controller's.
- Worlds: `[{ name: 'OsrsNerds', port: 2456 }, { name: 'Iron Arbiters World', port: 2458 }]`. Name regex `^[A-Za-z0-9 _-]{1,32}$`. Ports even, 2456 to 2470, unique. Query port is always `port + 1`.
- Slug: lowercase, runs of non `[a-z0-9]` become `-`, leading and trailing `-` trimmed. `iron-arbiters-world`.
- Index 0 is the primary and keeps: container `valheim`, `/opt/valheim/config`, `/opt/valheim/data`, unit `valheim-players.service`, parameter `/valheim/panel/players`, Steam name `serverName`. Others: container `valheim-<slug>`, `/opt/valheim/worlds/<slug>/config` and `/data`, unit `valheim-players-<slug>.service`, parameter `/valheim/panel/players-<slug>`, Steam name `${serverName} - ${name}`.
- Panel and sleeper env `WORLDS`: `JSON.stringify` of `[{ name, port, queryPort, playersParameter }]` in config order. `SERVER_HOST` stays. `GAME_PORT`, `QUERY_PORT` and `PLAYERS_PARAMETER` env vars are removed.
- Only `lambda/panel/aws.ts` imports `@aws-sdk/*`. Exactly two `"Resource":"*"` in the template. Comments only for non-obvious logic. No em dashes anywhere. Short imperative commits, no Co-Authored-By. README prose stays short.
- `npm test` and `npx tsc --noEmit` before every commit. No `cdk synth`, `cdk deploy` or AWS commands until Task 3.

---

## File structure

| Path | Task | Responsibility |
|---|---|---|
| `lib/worlds.ts` | 1 | `MOUNT_POINT`, `slugify`, `containerName`, `worldPaths`, `playersParameterName`, `worldsEnv`. |
| `lib/config.ts` | 1 | `WorldConfig`, `worlds`, validation. |
| `lib/compose.ts` | 1 | One service per world. |
| `lib/network.ts` | 1 | One ingress rule per world. |
| `lib/server-instance.ts` | 1 | Players parameter per world, transfers bucket read. |
| `lib/transfers.ts` | 1 | The transfers bucket. |
| `lib/players-watcher.ts`, `server/valheim-players.py` | 1 | Container argument, one unit per world. |
| `lib/instance-scripts.ts`, `lib/user-data.ts` | 1 | Per-world directories and sync. |
| `lib/control-panel.ts`, `lib/valheim-server-stack.ts` | 1 | `WORLDS` env, grants, outputs. |
| `scripts/import-world.ts`, `scripts/install-scripts.ts`, `package.json`, `README.md` | 1 | Import command and docs. |
| `lambda/panel/index.ts`, `html.ts`, `status.ts`, `sleeper.ts` | 2 | Multi-world view, markup, JSON, sleep count. |

---

### Task 1: Config, compose, firewall, instance scripts, watcher units, transfers bucket, import command

**Files:**
- Create: `lib/worlds.ts`, `lib/transfers.ts`, `scripts/import-world.ts`, `test/worlds.test.ts`
- Modify: `lib/config.ts`, `lib/compose.ts`, `lib/network.ts`, `lib/server-instance.ts`, `lib/players-watcher.ts`, `server/valheim-players.py`, `lib/instance-scripts.ts`, `lib/user-data.ts`, `lib/control-panel.ts`, `lib/valheim-server-stack.ts`, `scripts/install-scripts.ts`, `package.json`, `README.md`, `test/config.test.ts`, `test/compose.test.ts`, `test/user-data.test.ts`, `test/stack.test.ts`, `test/__snapshots__/stack.test.ts.snap`

**Interfaces:**
- Produces (Task 2 relies on the `WORLDS` shape and the removed env vars):
  ```ts
  // lib/worlds.ts
  export const MOUNT_POINT = '/opt/valheim';
  export function slugify(name: string): string
  export function containerName(index: number, world: WorldConfig): string
  export function worldPaths(index: number, world: WorldConfig): { config: string; data: string }
  export function playersParameterName(index: number, world: WorldConfig): string
  export function worldsEnv(worlds: WorldConfig[]): string   // JSON for WORLDS
  // lib/config.ts
  export interface WorldConfig { name: string; port: number }
  ServerConfig.worlds: WorldConfig[]   // worldName removed
  ```

- [ ] **Step 1: Write the failing tests**

`test/worlds.test.ts`:
```ts
import { containerName, playersParameterName, slugify, worldPaths, worldsEnv } from '../lib/worlds';

const primary = { name: 'OsrsNerds', port: 2456 };
const second = { name: 'Iron Arbiters World', port: 2458 };

test('slugify lowercases and dashes', () => {
  expect(slugify('Iron Arbiters World')).toBe('iron-arbiters-world');
  expect(slugify('  Odd__Name -- ')).toBe('odd-name');
  expect(slugify('OsrsNerds')).toBe('osrsnerds');
});

test('the primary keeps the legacy names and paths; others get their slug', () => {
  expect(containerName(0, primary)).toBe('valheim');
  expect(containerName(1, second)).toBe('valheim-iron-arbiters-world');
  expect(worldPaths(0, primary)).toEqual({ config: '/opt/valheim/config', data: '/opt/valheim/data' });
  expect(worldPaths(1, second)).toEqual({ config: '/opt/valheim/worlds/iron-arbiters-world/config', data: '/opt/valheim/worlds/iron-arbiters-world/data' });
  expect(playersParameterName(0, primary)).toBe('/valheim/panel/players');
  expect(playersParameterName(1, second)).toBe('/valheim/panel/players-iron-arbiters-world');
});

test('worlds env carries name, ports and parameter in order', () => {
  expect(JSON.parse(worldsEnv([primary, second]))).toEqual([
    { name: 'OsrsNerds', port: 2456, queryPort: 2457, playersParameter: '/valheim/panel/players' },
    { name: 'Iron Arbiters World', port: 2458, queryPort: 2459, playersParameter: '/valheim/panel/players-iron-arbiters-world' },
  ]);
});
```

In `test/config.test.ts` replace the `rejects a world name with a space` test with:
```ts
test('validates the world list', () => {
  const ok = (worlds: ServerConfig['worlds']) => validateConfig({ ...valid, worlds });
  expect(() => ok([{ name: 'Osrs Nerds', port: 2456 }])).not.toThrow();
  expect(() => ok([])).toThrow(/worlds/);
  expect(() => ok([{ name: 'Bad!', port: 2456 }])).toThrow(/name/);
  expect(() => ok([{ name: 'A', port: 2456 }, { name: 'A', port: 2458 }])).toThrow(/once/);
  expect(() => ok([{ name: 'A', port: 2457 }])).toThrow(/even/);
  expect(() => ok([{ name: 'A', port: 2472 }])).toThrow(/2456 and 2470/);
  expect(() => ok([{ name: 'A', port: 2456 }, { name: 'B', port: 2456 }])).toThrow(/port 2456 twice/);
  expect(() => ok([{ name: '---', port: 2456 }])).toThrow(/slug/);
});
```

In `test/compose.test.ts`, keep every existing assertion on `service()` (the primary) and add:
```ts
test('renders one service per world, extras on their own ports and folders', () => {
  const services = parse(renderCompose(config)).services;
  expect(Object.keys(services)).toEqual(['valheim', 'valheim-iron-arbiters-world']);
  const second = services['valheim-iron-arbiters-world'];
  expect(second.container_name).toBe('valheim-iron-arbiters-world');
  expect(second.ports).toEqual(['2458-2459:2456-2457/udp']);
  expect(second.volumes).toEqual(['/opt/valheim/worlds/iron-arbiters-world/config:/config', '/opt/valheim/worlds/iron-arbiters-world/data:/opt/valheim']);
  expect(second.environment).toMatchObject({ SERVER_NAME: 'valheim-osrs-nerds - Iron Arbiters World', WORLD_NAME: 'Iron Arbiters World', BEPINEX: 'true' });
  expect(second.environment.POST_SERVER_LISTENING_HOOK).toContain('Valheim Iron Arbiters World is up');
  expect(services.valheim.environment.POST_SERVER_LISTENING_HOOK).toContain('Valheim OsrsNerds is up');
  expect(services.valheim.ports).toEqual(['2456-2457:2456-2457/udp']);
  expect(second.env_file).toEqual(services.valheim.env_file);
});
```
Change the existing expectation `WORLD_NAME: 'OsrsNerds'` stays; `SERVER_NAME: 'valheim-osrs-nerds'` stays.

In `test/user-data.test.ts` extend the mods test with:
```ts
  expect(script).toContain('mkdir -p /opt/valheim/worlds/iron-arbiters-world/config /opt/valheim/worlds/iron-arbiters-world/data');
  expect(script).toContain('chown 1000:1000 /opt/valheim/worlds/iron-arbiters-world/config /opt/valheim/worlds/iron-arbiters-world/data');
  expect(script).toContain('/usr/local/bin/valheim-mods sync /opt/valheim/mods.json /opt/valheim/mods-config.json --config-root /opt/valheim/config/bepinex --install-root /opt/valheim/data/bepinex/BepInEx --cache /opt/valheim/mods-cache');
  expect(script).toContain('/usr/local/bin/valheim-mods sync /opt/valheim/mods.json /opt/valheim/mods-config.json --config-root /opt/valheim/worlds/iron-arbiters-world/config/bepinex --install-root /opt/valheim/worlds/iron-arbiters-world/data/bepinex/BepInEx --cache /opt/valheim/mods-cache');
```
and change the watcher test to:
```ts
test('installs one player watcher per world', () => {
  expect(script).toContain('ExecStart=/usr/bin/python3 /usr/local/bin/valheim-players /valheim/panel/players us-east-1 valheim');
  expect(script).toContain('ExecStart=/usr/bin/python3 /usr/local/bin/valheim-players /valheim/panel/players-iron-arbiters-world us-east-1 valheim-iron-arbiters-world');
  expect(script).toContain('systemctl enable --now valheim-players.service');
  expect(script).toContain('systemctl enable --now valheim-players-iron-arbiters-world.service');
  expect(script).toContain("cat > /usr/local/bin/valheim-players <<'PYEOF'");
});
```
The `buildUserData` call at the top of that file gains `worlds: config.worlds` (import `config`).

In `test/stack.test.ts`:
- network: `security group allows only udp 2456-2457` becomes: two `SecurityGroupIngress` entries, `2456`-`2457` and `2458`-`2459`, both udp `0.0.0.0/0`; keep the no-port-22 check.
- server instance: replace the players parameter test with one asserting both `/valheim/panel/players` and `/valheim/panel/players-iron-arbiters-world` exist with the initial value, and that the instance role policy JSON contains `ssm:PutParameter` and `s3:GetObject`.
- new describe `transfers`: `AWS::S3::Bucket` with `LifecycleConfiguration.Rules[0].ExpirationInDays: 7`, `PublicAccessBlockConfiguration.BlockPublicAcls: true`, and the `TransfersBucket` output present (add it and `WorldPorts` to the outputs list).
- control panel: env matcher drops `GAME_PORT`, `QUERY_PORT`, `PLAYERS_PARAMETER` and gains `WORLDS: worldsEnv(config.worlds)`; the sleeper matcher gains `WORLDS` too; disabled-panel parameter count becomes `5 + overrides` (compose, two players, packages, profile code).
- `"Resource":"*"` stays 2.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/worlds.test.ts test/config.test.ts test/compose.test.ts test/user-data.test.ts`
Expected: FAIL (module missing, `worlds` unknown, single service).

- [ ] **Step 3: `lib/worlds.ts` and config**

```ts
import { WorldConfig } from './config';

export const MOUNT_POINT = '/opt/valheim';
export const PRIMARY_PLAYERS_PARAMETER = '/valheim/panel/players';

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The first world keeps the names and folders the single-world setup used, so nothing on disk moves
export function containerName(index: number, world: WorldConfig): string {
  return index === 0 ? 'valheim' : `valheim-${slugify(world.name)}`;
}

export function worldPaths(index: number, world: WorldConfig): { config: string; data: string } {
  const root = index === 0 ? MOUNT_POINT : `${MOUNT_POINT}/worlds/${slugify(world.name)}`;
  return { config: `${root}/config`, data: `${root}/data` };
}

export function playersParameterName(index: number, world: WorldConfig): string {
  return index === 0 ? PRIMARY_PLAYERS_PARAMETER : `${PRIMARY_PLAYERS_PARAMETER}-${slugify(world.name)}`;
}

export function worldsEnv(worlds: WorldConfig[]): string {
  return JSON.stringify(worlds.map((w, i) => ({ name: w.name, port: w.port, queryPort: w.port + 1, playersParameter: playersParameterName(i, w) })));
}
```
`lib/instance-scripts.ts` and `lib/user-data.ts` stop defining `MOUNT_POINT` and import it from `./worlds` (user-data keeps `export { MOUNT_POINT }` for the tests). `lib/players-watcher.ts` replaces its `PLAYERS_PARAMETER_NAME` with the import of `PRIMARY_PLAYERS_PARAMETER` (keep exporting `PLAYERS_PARAMETER_NAME = PRIMARY_PLAYERS_PARAMETER` so `control-panel.ts` still compiles until you change it).

`lib/config.ts`: add
```ts
export interface WorldConfig {
  name: string;
  port: number;
}
export const WORLD_PORT_MIN = 2456;
export const WORLD_PORT_MAX = 2470;
```
replace `worldName: string;` with `worlds: WorldConfig[];`, replace the `worldName` validation with:
```ts
  if (c.worlds.length === 0) errors.push('worlds must list at least one world');
  const names = new Set<string>(); const slugs = new Set<string>(); const ports = new Set<number>();
  for (const w of c.worlds) {
    if (!/^[A-Za-z0-9 _-]{1,32}$/.test(w.name)) errors.push(`world name ${JSON.stringify(w.name)}: letters, digits, space, _ or -, max 32`);
    if (names.has(w.name)) errors.push(`world ${w.name} is listed more than once`);
    const slug = w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) errors.push(`world ${JSON.stringify(w.name)} has an empty slug`);
    if (slugs.has(slug)) errors.push(`worlds ${w.name} and another share the slug ${slug}`);
    if (w.port % 2 !== 0) errors.push(`world ${w.name}: port must be even, the query port is the next one up`);
    if (w.port < WORLD_PORT_MIN || w.port > WORLD_PORT_MAX) errors.push(`world ${w.name}: port must be between ${WORLD_PORT_MIN} and ${WORLD_PORT_MAX}`);
    if (ports.has(w.port)) errors.push(`worlds use port ${w.port} twice`);
    names.add(w.name); slugs.add(slug); ports.add(w.port);
  }
```
(the slug is recomputed inline to avoid a config to worlds import cycle) and the value `worlds: [{ name: 'OsrsNerds', port: 2456 }, { name: 'Iron Arbiters World', port: 2458 }]` in place of `worldName`.

- [ ] **Step 4: Compose, network, parameters, transfers**

`lib/compose.ts`: import `{ containerName, worldPaths }` and build
```ts
export function composeDefinition(c: ServerConfig): Record<string, unknown> {
  const services = Object.fromEntries(c.worlds.map((world, index) => {
    const name = containerName(index, world);
    const paths = worldPaths(index, world);
    const environment: Record<string, string> = {
      SERVER_NAME: index === 0 ? c.serverName : `${c.serverName} - ${world.name}`,
      WORLD_NAME: world.name,
      ...(same keys as today from SERVER_PUBLIC to BACKUPS_MAX_AGE, SERVER_ARGS via serverArgs(c)),
    };
    if (c.discordNotifications) {
      environment.POST_SERVER_LISTENING_HOOK = discordHook(`Valheim ${world.name} is up`);
      environment.PRE_SERVER_SHUTDOWN_HOOK = discordHook(`Valheim ${world.name} is shutting down`);
    }
    if (c.mods.enabled) environment.BEPINEX = 'true';
    return [name, {
      image: `${IMAGE}:${c.imageTag}`,
      container_name: name,
      cap_add: ['sys_nice'],
      stop_grace_period: '2m',
      restart: 'unless-stopped',
      ports: [`${world.port}-${world.port + 1}:2456-2457/udp`],
      env_file: [ENV_FILE_PATH],
      environment,
      volumes: [`${paths.config}:/config`, `${paths.data}:/opt/valheim`],
    }];
  }));
  return { services };
}
```
`ENV_FILE_PATH` stays `/opt/valheim/.env`.

`lib/network.ts`: `NetworkProps { az: string; worlds: WorldConfig[] }`; remove `GAME_PORT`/`QUERY_PORT`; one rule per world:
```ts
    for (const world of props.worlds) {
      this.securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udpRange(world.port, world.port + 1), `Valheim ${world.name}`);
    }
```

`lib/transfers.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

// Scratch space for moving save files onto the instance; nothing here is worth keeping
export class Transfers extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
    });
  }
}
```
`autoDeleteObjects` adds a custom resource Lambda whose policy may contain `"Resource":"*"`; if the invariant test fails because of it, drop `autoDeleteObjects` (the bucket is emptied by the 7 day rule anyway) and say so in the report.

`lib/server-instance.ts`: props gain `transfers: Transfers`; replace `playersParameter` with `readonly playersParameters: ssm.StringParameter[]` built as
```ts
    this.playersParameters = config.worlds.map((world, index) => {
      const parameter = new ssm.StringParameter(this, index === 0 ? 'PlayersParameter' : `PlayersParameter${slugify(world.name).replace(/-/g, '')}`, {
        parameterName: playersParameterName(index, world),
        stringValue: JSON.stringify({ players: [], updatedAt: '1970-01-01T00:00:00.000Z' }),
        description: `Who is online in Valheim ${world.name}, written by the watcher on the instance`,
      });
      parameter.grantWrite(this.role);
      return parameter;
    });
    props.transfers.bucket.grantRead(this.role);
```
(the primary keeps construct id `PlayersParameter` so its logical id, and the live parameter, do not change). `buildUserData` gets `worlds: config.worlds`.

- [ ] **Step 5: Watcher and instance scripts**

`server/valheim-players.py`: `follow(parameter, region, container)` uses `["docker", "logs", "-f", container]`; main:
```python
    elif len(sys.argv) in (3, 4):
        sys.exit(follow(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else "valheim"))
    else:
        print("usage: valheim-players <parameter-name> <region> [container] | --replay", file=sys.stderr)
```

`lib/players-watcher.ts`:
```ts
export function playersWatcherUnit(region: string, parameter: string, container: string): string   // Description=Publish who is online in Valheim (${container}) to SSM; ExecStart=/usr/bin/python3 ${PLAYERS_WATCHER_PATH} ${parameter} ${region} ${container}
export function playersWatcherUnitName(index: number, world: WorldConfig): string   // 'valheim-players.service' | `valheim-players-${slug}.service`
export function playersWatcherInstall(region: string, worlds: WorldConfig[]): string
```
`playersWatcherInstall` writes the script once, then for each world a `cat > /etc/systemd/system/<unit> <<'EOF' ... EOF`, then one `systemctl daemon-reload` and per world `systemctl enable --now <unit>` and `systemctl restart <unit>`.

`lib/instance-scripts.ts`: `InstanceScriptOptions` gains `worlds: WorldConfig[]`. In `fetchConfigScript`, replace the single sync line with, per world (index, w):
```
mkdir -p <config> <data>
chown 1000:1000 <config> <data>
${MODS_SYNC_PATH} sync ${MOUNT_POINT}/mods.json ${MOUNT_POINT}/mods-config.json --config-root <config>/bepinex --install-root <data>/bepinex/BepInEx --cache ${MOUNT_POINT}/mods-cache
```
`installScripts` passes `o.worlds` to `playersWatcherInstall`. `lib/user-data.ts` `UserDataOptions` gains `worlds` and passes it through; `scripts/install-scripts.ts` passes `config.worlds`.

- [ ] **Step 6: Control panel, stack, import command, README**

`lib/control-panel.ts`: props replace `playersParameter` with `playersParameters: ssm.IStringParameter[]` and add `worlds: WorldConfig[]`. `sharedEnv` drops `QUERY_PORT` and gains `WORLDS: worldsEnv(props.worlds)`. The panel env drops `GAME_PORT` and `PLAYERS_PARAMETER`. Grants: `for (const p of props.playersParameters) p.grantRead(panel);`. Remove the `GAME_PORT`/`QUERY_PORT` import.

`lib/valheim-server-stack.ts`: `new Transfers(this, 'Transfers')`, pass it to `ServerInstance`; `Network` gets `worlds: config.worlds`; panel gets `worlds` and `playersParameters`; outputs use `config.worlds[0].port` and `+ 1`; add
```ts
    new cdk.CfnOutput(this, 'TransfersBucket', { value: transfers.bucket.bucketName, description: 'Scratch bucket for save file uploads' });
    new cdk.CfnOutput(this, 'WorldPorts', { value: config.worlds.map((w) => `${w.name}: ${w.port}`).join('; ') });
```

`scripts/import-world.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { config } from '../lib/config';
import { containerName, worldPaths } from '../lib/worlds';

const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'valheim' };
const aws = (...args: string[]) => execFileSync('aws', [...args, '--region', config.region], { encoding: 'utf8', env }).trim();
const output = (key: string) => aws('cloudformation', 'describe-stacks', '--stack-name', 'ValheimServerStack', '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, '--output', 'text');

const [name, ...files] = process.argv.slice(2);
const index = config.worlds.findIndex((w) => w.name === name);
if (index < 0 || files.length === 0) {
  console.error(`usage: npm run import-world -- "<world name>" <file.db> <file.fwl>\nworlds: ${config.worlds.map((w) => w.name).join(', ')}`);
  process.exit(1);
}
const world = config.worlds[index];
const bucket = output('TransfersBucket');
const instanceId = output('InstanceId');
const prefix = `worlds/${containerName(index, world)}/`;
for (const file of files) aws('s3', 'cp', file, `s3://${bucket}/${prefix}${basename(file)}`);

const container = containerName(index, world);
const target = `${worldPaths(index, world).config}/worlds_local`;
const commands = [
  `running=$(docker ps -q -f name=^${container}$)`,
  `[ -n "$running" ] && docker stop -t 120 ${container}`,
  `mkdir -p ${target}`,
  `aws s3 cp --recursive s3://${bucket}/${prefix} ${target}/ --region ${config.region}`,
  `chown -R 1000:1000 ${target}`,
  `ls -la ${target}`,
  `[ -n "$running" ] && docker start ${container} || true`,
];
const parameters = JSON.stringify({ commands });
const commandId = aws('ssm', 'send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript', '--comment', `import world ${world.name}`, '--parameters', parameters, '--query', 'Command.CommandId', '--output', 'text');
try {
  aws('ssm', 'wait', 'command-executed', '--command-id', commandId, '--instance-id', instanceId);
} catch {
  // the waiter also exits non-zero on Failed; the status below tells the two apart
}
const [status, stdout, stderr] = JSON.parse(aws('ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instanceId, '--query', '[Status,StandardOutputContent,StandardErrorContent]', '--output', 'json')) as [string, string, string];
console.log(`${status}\n${stdout}${stderr}`);
if (status !== 'Success') process.exit(1);
```
`package.json`: `"import-world": "tsx scripts/import-world.ts"`.

`README.md`: replace the world import paragraph with a `## Worlds` section: `config.worlds` lists every world and its port; the first one is the original; each extra world runs as its own container with the same password and mods; import a save with `npm run import-world -- "<name>" <file.db> <file.fwl>` (the world must be in the list and deployed first); the panel shows every world.

- [ ] **Step 7: Run to verify pass, refresh the snapshot**

Run: `npm test -- test/worlds.test.ts test/config.test.ts test/compose.test.ts test/user-data.test.ts && npm test -- test/stack.test.ts -u && npm test && npx tsc --noEmit`
Expected: green; snapshot shows the second service in the compose parameter, two ingress rules, two players parameters, the bucket, `WORLDS` env on both functions, longer user data (check it stays under 16 KB: about 14.5 KB).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Run one container per configured world"
```

---

### Task 2: Panel and sleeper across worlds

**Files:**
- Modify: `lambda/panel/index.ts`, `lambda/panel/html.ts`, `lambda/panel/status.ts`, `lambda/panel/sleeper.ts`, `test/panel/index.test.ts`, `test/panel/html.test.ts`, `test/panel/status.test.ts`, `test/panel/sleeper.test.ts`

**Interfaces:**
- Consumes: env `WORLDS` (JSON `[{ name, port, queryPort, playersParameter }]`), `SERVER_HOST`; `GAME_PORT`, `QUERY_PORT`, `PLAYERS_PARAMETER` no longer exist.
- Produces:
  ```ts
  // index.ts
  export interface WorldEnv { name: string; port: number; queryPort: number; playersParameter: string }
  export function parseWorlds(raw: string): WorldEnv[]        // throws on malformed input
  Env: { instanceId, serverHost, secretArn, stopScheduleName, startScheduleName, timezone, serverName, sleepEnabledParameter, emptySinceParameter, sleepIdleMinutes, modsParameter, profileCodeParameter, playersParameter?: never, worlds: WorldEnv[] }
  // html.ts
  export interface WorldView { name: string; players?: number; maxPlayers?: number; playerNames?: string[]; connectString: string; steamString: string }
  PanelView: connectString and steamString removed; worlds: WorldView[] added; players and playerNames stay (totals)
  export function worldLine(w: WorldView, state: InstanceState): string
  // status.ts
  StatusPayload.worlds: Array<{ name, players: number | null, maxPlayers: number | null, playerNames: string[] | null, connectString, steamString }>
  // sleeper.ts
  SleeperEnv: queryPort removed; worlds: Array<{ name: string; queryPort: number }> added
  ```

- [ ] **Step 1: Write the failing tests**

`test/panel/index.test.ts`: in `deps().env` remove `gamePort`, `queryPort`, `playersParameter` and add `worlds: [{ name: 'OsrsNerds', port: 2456, queryPort: 2457, playersParameter: '/p/players' }, { name: 'Iron Arbiters World', port: 2458, queryPort: 2459, playersParameter: '/p/players-iron' }]`. `queryPlayers` in `deps` becomes `async (_host, port) => (port === 2457 ? { players: 2, maxPlayers: 10 } : { players: 1, maxPlayers: 10 })`. `fakeAws.params` adds `'/p/players-iron': JSON.stringify({ players: ['Sir Freak'], updatedAt: new Date(now - 30_000).toISOString() })`. Update: the hall test expects `'3 vikings online'` (sum); the status test expects `players: 3` and `body.worlds` to equal
```ts
[
  { name: 'OsrsNerds', players: 2, maxPlayers: 10, playerNames: ['Fellesin', 'Halo'], connectString: '100.29.76.244:2456', steamString: '100.29.76.244:2457' },
  { name: 'Iron Arbiters World', players: 1, maxPlayers: 10, playerNames: ['Sir Freak'], connectString: '100.29.76.244:2458', steamString: '100.29.76.244:2459' },
]
```
and `body.playerNames` to equal `['Fellesin', 'Halo', 'Sir Freak']`. The names test asserts the page contains `Fellesin, Halo` and `Sir Freak` inside `id="world-names-0"` and `id="world-names-1"` respectively. The `player query is skipped when stopped` test: `queried` stays 0 when stopped; when one world's query returns null and the other 2, the page says `2 vikings online` (partial sums count what is known) and the null world's block says `Counting heads`; when both return null the page says `Counting heads`. `readEnv` test: `full` drops `GAME_PORT`, `QUERY_PORT`, `PLAYERS_PARAMETER`, adds `WORLDS: JSON.stringify([{ name: 'A', port: 2456, queryPort: 2457, playersParameter: '/p' }])`; expect `worlds[0].queryPort` 2457; `WORLDS: 'nope'` throws `/WORLDS/`; `WORLDS: '[]'` throws `/WORLDS/`.

`test/panel/html.test.ts`: `base` drops `connectString`/`steamString` and gains
```ts
  worlds: [
    { name: 'OsrsNerds', players: 2, maxPlayers: 10, playerNames: ['Fellesin', 'Halo'], connectString: '100.29.76.244:2456', steamString: '100.29.76.244:2457' },
    { name: 'Iron Arbiters World', players: 1, maxPlayers: 10, playerNames: ['Sir Freak'], connectString: '100.29.76.244:2458', steamString: '100.29.76.244:2459' },
  ],
```
Replace the `getting in section and copy buttons` and `names line` tests with:
```ts
test('one getting-in block per world with its count, names and copy buttons', () => {
  const html = renderPanel(base);
  expect(html).toContain('<h3>OsrsNerds</h3>');
  expect(html).toContain('<h3>Iron Arbiters World</h3>');
  expect(html).toMatch(/<p id="world-count-0" class="sub world-count">2 vikings online<\/p>/);
  expect(html).toMatch(/<p id="world-count-1" class="sub world-count">1 viking online<\/p>/);
  expect(html).toMatch(/<p id="world-names-0" class="names">Fellesin, Halo<\/p>/);
  expect(html).toMatch(/<code id="join-1">100\.29\.76\.244:2458<\/code><button type="button" class="copy" data-for="join-1">Copy<\/button>/);
  expect(html).toMatch(/<code id="steam-0">100\.29\.76\.244:2457<\/code>/);
  expect(html).not.toContain('id="names"');
  const stopped = renderPanel({ ...base, state: 'stopped', players: undefined, worlds: base.worlds.map((w) => ({ ...w, players: undefined, playerNames: undefined })) });
  expect(stopped).toMatch(/<p id="world-count-0" class="sub world-count" hidden><\/p>/);
  expect(stopped).toMatch(/<p id="world-names-0" class="names" hidden><\/p>/);
  expect(renderPanel({ ...base, worlds: [{ ...base.worlds[0], players: undefined }, base.worlds[1]] })).toContain('>Counting heads</p>');
  expect(renderPanel({ ...base, worlds: [{ ...base.worlds[0], name: '<b>x</b>' }, base.worlds[1]] })).toContain('<h3>&lt;b&gt;x&lt;/b&gt;</h3>');
});

test('worldLine copy', () => {
  const w = base.worlds[0];
  expect(worldLine({ ...w, players: undefined }, 'running')).toBe('Counting heads');
  expect(worldLine({ ...w, players: 0 }, 'running')).toBe('Nobody online yet');
  expect(worldLine({ ...w, players: 1 }, 'running')).toBe('1 viking online');
  expect(worldLine({ ...w, players: 4 }, 'running')).toBe('4 vikings online');
  expect(worldLine(w, 'stopped')).toBe('');
});
```
Keep `expect(html).toContain('3 vikings online, since 8:02 pm')` in the running page test (`players: 3` in base is the sum). Also assert the client script contains `s.worlds`.

`test/panel/status.test.ts`: `view` gains `worlds` (same two as html base) and drops the removed fields; the mapping test expects `worlds` with the nulls for unknowns (`players: null`, `maxPlayers: null`, `playerNames: null`).

`test/panel/sleeper.test.ts`: `env` drops `queryPort` and gains `worlds: [{ name: 'A', queryPort: 2457 }, { name: 'B', queryPort: 2459 }]`; `queryPlayers` returns `opts.players` for both worlds unless `opts.second` is set (add `second?: number | null` to `fake` opts: when set, port 2459 returns it). Add:
```ts
test('sums players across worlds and never stops on a failed query', async () => {
  const f = fake({ players: 0, second: 2, emptySince: ago(20) });
  await expect(f.run()).resolves.toEqual({ action: 'clear' });
  expect(f.queries()).toBe(2);
  const g = fake({ players: 0, second: null, emptySince: ago(90) });
  await expect(g.run()).resolves.toEqual({ action: 'none' });
});
```
and update the existing `queries()` expectations from 1 to 2. `readSleeperEnv` test (if present) mirrors the `WORLDS` change.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/panel`
Expected: FAIL across index, html, status, sleeper.

- [ ] **Step 3: index.ts**

```ts
export interface WorldEnv { name: string; port: number; queryPort: number; playersParameter: string }

export function parseWorlds(raw: string): WorldEnv[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('WORLDS is not valid JSON'); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('WORLDS must list at least one world');
  return parsed.map((w) => {
    const v = w as Partial<WorldEnv>;
    if (typeof v.name !== 'string' || typeof v.port !== 'number' || typeof v.queryPort !== 'number' || typeof v.playersParameter !== 'string') throw new Error('WORLDS entries need name, port, queryPort and playersParameter');
    return { name: v.name, port: v.port, queryPort: v.queryPort, playersParameter: v.playersParameter };
  });
}
```
`Env` drops `gamePort`, `queryPort`, `playersParameter`; adds `worlds: WorldEnv[]`; `readEnv` uses `worlds: parseWorlds(need('WORLDS'))`. In `view()`:
```ts
    const running = instance.state === 'running';
    const nowDate = new Date(deps.now());
    const worlds = await Promise.all(env.worlds.map(async (w) => {
      const [info, playersRaw] = await Promise.all([
        running ? deps.queryPlayers(env.serverHost, w.queryPort) : Promise.resolve(null),
        aws.getParameter(w.playersParameter),
      ]);
      return {
        name: w.name,
        players: info?.players,
        maxPlayers: info?.maxPlayers,
        playerNames: parsePlayers(playersRaw, nowDate),
        connectString: `${env.serverHost}:${w.port}`,
        steamString: `${env.serverHost}:${w.queryPort}`,
      };
    }));
    const known = worlds.filter((w) => w.players !== undefined);
    const named = worlds.filter((w) => w.playerNames !== undefined);
```
and the view gets `players: known.length ? known.reduce((n, w) => n + (w.players ?? 0), 0) : undefined`, `maxPlayers: known.length ? known.reduce((n, w) => n + (w.maxPlayers ?? 0), 0) : undefined`, `playerNames: named.length ? named.flatMap((w) => w.playerNames ?? []).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) : undefined`, `worlds`. The parameter reads can happen whether or not the instance runs (they are cheap), matching today.

- [ ] **Step 4: status.ts and sleeper.ts**

`status.ts`: add `worlds` to `StatusPayload` and map each `WorldView` with `?? null` for `players`, `maxPlayers`, `playerNames`.

`sleeper.ts`: `SleeperEnv` drops `queryPort`, adds `worlds: Array<{ name: string; queryPort: number }>`; `readSleeperEnv` parses `WORLDS` (same rules as `parseWorlds`; import it from `./index` is not allowed because index pulls the whole handler, so put `parseWorlds` in a new tiny module `lambda/panel/worlds.ts` and import it from both). When running:
```ts
    const infos = instance.state === 'running' ? await Promise.all(env.worlds.map((w) => deps.queryPlayers(env.serverHost, w.queryPort))) : [];
    const players = instance.state !== 'running' ? null : infos.some((i) => i === null) ? null : infos.reduce((n, i) => n + (i?.players ?? 0), 0);
```
and log `players`.

- [ ] **Step 5: html.ts**

`PanelView`: remove `connectString`/`steamString`, add `worlds: WorldView[]`. Remove the `#names` line from the markup and from `apply()`. Replace the Getting in rows with:
```ts
      <h2>Getting in</h2>
      ${v.worlds.map((w, i) => worldBlock(w, i, v.state)).join('\n')}
      <p class="note">Password is the one you were given.</p>
```
```ts
export function worldLine(w: WorldView, state: InstanceState): string {
  if (state !== 'running') return '';
  return w.players === undefined ? 'Counting heads' : w.players === 0 ? 'Nobody online yet' : w.players === 1 ? '1 viking online' : `${w.players} vikings online`;
}

function worldBlock(w: WorldView, i: number, state: InstanceState): string {
  const line = worldLine(w, state);
  const names = (w.playerNames ?? []).join(', ');
  return `<section class="world">
        <h3>${esc(w.name)}</h3>
        <p id="world-count-${i}" class="sub world-count"${line ? '' : ' hidden'}>${esc(line)}</p>
        <p id="world-names-${i}" class="names"${names ? '' : ' hidden'}>${esc(names)}</p>
        <div class="row"><span class="label">Join IP</span><code id="join-${i}">${esc(w.connectString)}</code><button type="button" class="copy" data-for="join-${i}">Copy</button></div>
        <div class="row"><span class="label">Steam browser</span><code id="steam-${i}">${esc(w.steamString)}</code><button type="button" class="copy" data-for="steam-${i}">Copy</button></div>
      </section>`;
}
```
CSS added to `STYLE`: `h3 { font-size: 1.1rem; font-weight: 400; margin: 1.25rem 0 .25rem; color: ${C.birch}; }` and `.world-count { margin-bottom: .25rem; }` and `.names { margin: 0 0 .5rem; }` (replace the old `.names` rule). Client script, inside `apply(s)`:
```
    (s.worlds || []).forEach(function (w, i) {
      var c = document.getElementById('world-count-' + i), n = document.getElementById('world-names-' + i);
      if (!c || !n) return;
      var line = s.state !== 'running' ? '' : w.players === null ? 'Counting heads' : w.players === 0 ? 'Nobody online yet' : w.players === 1 ? '1 viking online' : w.players + ' vikings online';
      c.textContent = line; c.hidden = !line;
      var names = (w.playerNames || []).join(', ');
      n.textContent = names; n.hidden = !names;
    });
```
(the comment above `clientScript` already covers the mirroring).

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- test/panel && npx tsc --noEmit`
Expected: all panel suites green (stack snapshot fails in the worktree for the known reason; leave it).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Show every world on the panel and count them all for sleep"
```

---

### Task 3: Deploy, import, verify (controller)

- [ ] Fold Task 2 onto `two-worlds`, full suite in the main tree, push.
- [ ] Check the hall at the moment of handing over the deploy and say it stops and starts the instance (user data and security group change). Fayadh runs `npm run deploy` with the hall empty.
- [ ] After the instance is back: `npm run install-scripts`, then `npm run import-world -- "Iron Arbiters World" "~/Documents/Iron Arbiters World.db" "~/Documents/Iron Arbiters World.fwl"`, then `npm run server -- restart` (hall empty).
- [ ] Verify: both containers up, both A2S queries answer on 2457 and 2459, journal shows two syncs and two watchers active, panel shows two blocks, Discord shows "Valheim Iron Arbiters World is up". Post the join address for the second world.
- [ ] Merge to `main`, push, delete branches and worktree.

---

## Self-review notes

- Spec coverage: config and slug rules (T1 S3), compose per world and hooks (T1 S4), firewall (T1 S4), parameters and grants (T1 S4), mods per world and directories (T1 S5), watcher per world (T1 S5), panel env and grants (T1 S6), transfers bucket and import (T1 S4, S6), panel view, markup, JSON and sleeper (T2), README (T1 S6), rollout (T3).
- Type consistency: `WORLDS` shape produced by `worldsEnv` equals what `parseWorlds` accepts; `playersParameterName` values match the parameter names CDK creates; container names and paths come from one module used by compose, scripts and the import command.
- The primary's construct id, parameter name, container name and folders are unchanged, so the deploy does not replace live resources.
- Placeholder scan: none.
