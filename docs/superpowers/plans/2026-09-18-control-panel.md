# Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected web page, served by one Lambda, where friends see server status and player count, start or stop the server, and edit the nightly schedule.

**Architecture:** A `ControlPanel` CDK construct adds a Node.js 22 Lambda behind a Function URL to the existing stack. The Lambda is split into pure modules (auth cookie, A2S query parsing, cron/time conversion, HTML rendering) plus one thin AWS SDK wrapper, composed by a `createHandler(deps)` factory so the handler is unit-testable with fakes. The two EventBridge schedules become permanent, named resources whose state and times the Lambda edits at runtime.

**Tech Stack:** aws-cdk-lib 2.270 (`aws-lambda-nodejs`, `aws-scheduler`), esbuild, Node.js 22 on ARM64, AWS SDK v3 (EC2, Scheduler, Secrets Manager), `node:dgram` for the Steam query, Jest 30.

**Spec:** `docs/superpowers/specs/2026-09-18-control-panel-design.md`

## Global Constraints

- Work on branch `panel` from `main`. Merge back to `main` at the end.
- Repo: `/Users/fayadh.ahmed/Documents/valheim-server`, CommonJS (`__dirname` available), TypeScript with `module: NodeNext`. Jest roots are `test/`, pattern `**/*.test.ts`.
- Lambda code lives in `lambda/panel/`. Only `lambda/panel/aws.ts` may import `@aws-sdk/*`. The Lambda entry file is `lambda/panel/handler.ts`; `lambda/panel/index.ts` exports the factory and must have no side effects at import.
- Auth: the page password is the server password from the existing secret (`password` key of the JSON). Cookie `valheim_panel`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Wrong password waits 1000 ms.
- Schedules are always created, named `valheim-stop` and `valheim-start`, group `default`, state from `config.schedule.enabled`.
- Lambda IAM: `ec2:DescribeInstances` on `*`; `ec2:StartInstances`, `ec2:StopInstances` on the instance ARN; `scheduler:GetSchedule`, `scheduler:UpdateSchedule` on the two schedule ARNs; `iam:PassRole` on the scheduler target role; secret read via `grantRead`. Nothing else.
- Lambda: `NODEJS_22_X`, `ARM_64`, 256 MB, 10 s timeout, bundling `externalModules: ['@aws-sdk/*'], minify: true, sourceMap: false`, log group retention 14 days, Function URL auth `NONE`.
- `SERVER_PUBLIC` becomes `'true'` in the compose file.
- Tests skip Lambda bundling via App context `'aws:cdk:bundling-stacks': []`.
- Git: short imperative commit messages, no `Co-Authored-By`, no em dashes anywhere. Comments only for non-obvious logic. README prose stays short.
- Run `npm test` and `npx tsc --noEmit` before every commit. No `cdk synth` or AWS commands until Task 9.

---

## File structure

| Path | Responsibility |
|---|---|
| `lib/config.ts` | Add `panel: { enabled: boolean }`. |
| `lib/compose.ts` | `SERVER_PUBLIC: 'true'`. |
| `lib/schedule.ts` | Always-on named schedules, shared target role, exported ARNs and names. |
| `lib/control-panel.ts` | `ControlPanel` construct: NodejsFunction, IAM, Function URL. |
| `lib/valheim-server-stack.ts` | Always create `Schedule`; create `ControlPanel` when enabled; `PanelUrl` output. |
| `lambda/panel/schedule.ts` | Pure: cron text to HH:MM and back, validation. |
| `lambda/panel/auth.ts` | Pure: cookie signing and verification, constant-time password compare. |
| `lambda/panel/a2s.ts` | Steam A2S_INFO request, challenge handshake, response parsing. |
| `lambda/panel/html.ts` | Pure: login and panel page rendering, message map. |
| `lambda/panel/aws.ts` | The only AWS SDK importer: `Aws` interface and `createAws()`. |
| `lambda/panel/index.ts` | `readEnv()`, `createHandler(deps)`. No side effects. |
| `lambda/panel/handler.ts` | Lambda entry: `export const handler = createHandler({...real deps})`. |
| `scripts/server.sh` | `panel` subcommand. |
| `README.md` | Control panel section, joining note. |
| `test/panel/*.test.ts` | Unit tests for the Lambda modules. |
| `test/stack.test.ts`, `test/compose.test.ts`, `test/helpers.ts` | Stack assertions, compose change, bundling skip. |

---

### Task 1: Config flag, public server, dependencies, test bundling skip

**Files:**
- Modify: `lib/config.ts`, `lib/compose.ts`, `test/compose.test.ts`, `test/helpers.ts`, `package.json` (via npm install)
- Test: `test/compose.test.ts`, `test/config.test.ts`

**Interfaces:**
- Produces: `ServerConfig.panel: { enabled: boolean }`; real config `panel: { enabled: true }`. Compose env `SERVER_PUBLIC: 'true'`. Dev dependencies `esbuild`, `@aws-sdk/client-ec2`, `@aws-sdk/client-scheduler`, `@aws-sdk/client-secrets-manager`, `@types/aws-lambda`.

- [ ] **Step 1: Create the branch and install dependencies**

```bash
git checkout -b panel main
npm install --save-dev esbuild @aws-sdk/client-ec2 @aws-sdk/client-scheduler @aws-sdk/client-secrets-manager @types/aws-lambda
```
Expected: `package.json` devDependencies gain the five packages.

- [ ] **Step 2: Change the compose test to expect a public server**

In `test/compose.test.ts`, rename the test `'sets the private server environment'` to `'sets the server environment'` and change the line `SERVER_PUBLIC: 'false',` to `SERVER_PUBLIC: 'true',`. Add this test at the end of the file:

```ts
test('lists the server publicly so the panel can query player count', () => {
  expect(service().environment.SERVER_PUBLIC).toBe('true');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- test/compose.test.ts`
Expected: FAIL, two tests expecting `'true'` receive `'false'`.

- [ ] **Step 4: Implement config and compose changes**

In `lib/config.ts`, add to `ServerConfig` after `discordNotifications: boolean;`:
```ts
  panel: PanelConfig;
```
and above `ServerConfig` add:
```ts
export interface PanelConfig {
  enabled: boolean;
}
```
In the `config` constant add after `discordNotifications: false,`:
```ts
  panel: { enabled: true },
```
In `lib/compose.ts` change `SERVER_PUBLIC: 'false',` to `SERVER_PUBLIC: 'true',`.

- [ ] **Step 5: Skip Lambda bundling in tests**

Replace `const app = new cdk.App();` in `test/helpers.ts` with:
```ts
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
```

- [ ] **Step 6: Run the full suite and refresh the snapshot**

Run: `npm test -- test/stack.test.ts -u && npm test && npx tsc --noEmit`
Expected: compose 8 passed, stack snapshot updated (the `SERVER_PUBLIC` line), 44 tests total passing, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Make the server public and add the panel flag"
```

---

### Task 2: Permanent named schedules with a shared target role

**Files:**
- Modify: `lib/schedule.ts`, `lib/valheim-server-stack.ts`, `test/stack.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const STOP_SCHEDULE_NAME = 'valheim-stop';
  export const START_SCHEDULE_NAME = 'valheim-start';
  export class Schedule extends Construct {
    readonly targetRole: iam.Role;
    readonly stopScheduleArn: string;
    readonly startScheduleArn: string;
  }
  ```
  Stack: `const schedule = new Schedule(this, 'Schedule', { instance: server.instance, schedule: config.schedule, timezone: config.timezone });` always.

- [ ] **Step 1: Replace the schedule tests**

In `test/stack.test.ts`, replace the whole `describe('schedule', ...)` block with:

```ts
describe('schedule', () => {
  test('always creates both named schedules, disabled by default', () => {
    const template = synth();
    template.resourceCountIs('AWS::Scheduler::Schedule', 2);
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      Name: 'valheim-stop',
      State: 'DISABLED',
      ScheduleExpression: 'cron(0 3 * * ? *)',
      ScheduleExpressionTimezone: 'America/Toronto',
      FlexibleTimeWindow: { Mode: 'OFF' },
    }));
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      Name: 'valheim-start',
      State: 'DISABLED',
      ScheduleExpression: 'cron(0 16 * * ? *)',
    }));
  });

  test('enables both schedules when the flag is on', () => {
    const template = synth({ schedule: { enabled: true, stopAt: '03:00', startAt: '16:00' } });
    template.resourcePropertiesCountIs('AWS::Scheduler::Schedule', Match.objectLike({ State: 'ENABLED' }), 2);
  });

  test('both schedules share one target role scoped to the instance', () => {
    const template = synth();
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('aws-sdk:ec2:stopInstances');
    expect(json).toContain('aws-sdk:ec2:startInstances');
    const roles = template.findResources('AWS::IAM::Role', {
      Properties: Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Principal: { Service: 'scheduler.amazonaws.com' } })]),
        }),
      }),
    });
    expect(Object.keys(roles)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: FAIL, first test finds 0 schedules; third finds 2 scheduler roles or none.

- [ ] **Step 3: Rewrite the construct**

`lib/schedule.ts`:
```ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';
import { ScheduleConfig } from './config';

export const STOP_SCHEDULE_NAME = 'valheim-stop';
export const START_SCHEDULE_NAME = 'valheim-start';

export interface ScheduleProps {
  instance: ec2.Instance;
  schedule: ScheduleConfig;
  timezone: string;
}

export class Schedule extends Construct {
  readonly targetRole: iam.Role;
  readonly stopScheduleArn: string;
  readonly startScheduleArn: string;

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

    // One role for both targets so the control panel can PassRole a single ARN on UpdateSchedule
    this.targetRole = new iam.Role(this, 'TargetRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    const ec2Call = (action: 'stopInstances' | 'startInstances', iamAction: string) =>
      new targets.Universal({
        service: 'ec2',
        action,
        input,
        role: this.targetRole,
        policyStatements: [new iam.PolicyStatement({ actions: [iamAction], resources: [instanceArn] })],
      });

    new scheduler.Schedule(this, 'Stop', {
      scheduleName: STOP_SCHEDULE_NAME,
      enabled: props.schedule.enabled,
      schedule: cronAt(props.schedule.stopAt, tz),
      target: ec2Call('stopInstances', 'ec2:StopInstances'),
      description: 'Stop the Valheim server for the night',
    });

    new scheduler.Schedule(this, 'Start', {
      scheduleName: START_SCHEDULE_NAME,
      enabled: props.schedule.enabled,
      schedule: cronAt(props.schedule.startAt, tz),
      target: ec2Call('startInstances', 'ec2:StartInstances'),
      description: 'Start the Valheim server for the evening',
    });

    this.stopScheduleArn = scheduleArn(stack, STOP_SCHEDULE_NAME);
    this.startScheduleArn = scheduleArn(stack, START_SCHEDULE_NAME);
  }
}

function scheduleArn(stack: cdk.Stack, name: string): string {
  return stack.formatArn({ service: 'scheduler', resource: 'schedule', resourceName: `default/${name}` });
}

function cronAt(hhmm: string, timeZone: cdk.TimeZone): scheduler.ScheduleExpression {
  const [hour, minute] = hhmm.split(':').map(Number);
  return scheduler.ScheduleExpression.cron({ minute: String(minute), hour: String(hour), timeZone });
}
```

- [ ] **Step 4: Wire the stack unconditionally**

In `lib/valheim-server-stack.ts` replace the `if (config.schedule.enabled) { ... }` block with:
```ts
    const schedule = new Schedule(this, 'Schedule', {
      instance: server.instance,
      schedule: config.schedule,
      timezone: config.timezone,
    });
```
(`schedule` is used by Task 7. Until then TypeScript may warn about an unused variable only if `noUnusedLocals` is on; the template tsconfig does not set it.)

- [ ] **Step 5: Run to verify pass, refresh the snapshot**

Run: `npm test -- test/stack.test.ts -u && npm test && npx tsc --noEmit`
Expected: 3 schedule tests pass, snapshot updated with two schedules and one scheduler role, all suites green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Make the stop and start schedules permanent named resources"
```

---

### Task 3: Pure helpers: cron conversion and cookie auth

**Files:**
- Create: `lambda/panel/schedule.ts`, `lambda/panel/auth.ts`
- Test: `test/panel/schedule.test.ts`, `test/panel/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lambda/panel/schedule.ts
  export function validateTime(hhmm: string): boolean
  export function timeToCron(hhmm: string): string      // '16:05' -> 'cron(5 16 * * ? *)'
  export function cronToTime(expr: string): string      // 'cron(0 3 * * ? *)' -> '03:00'
  // lambda/panel/auth.ts
  export const COOKIE_NAME = 'valheim_panel';
  export const COOKIE_MAX_AGE_SECONDS = 2592000;
  export function signCookie(password: string, expiresAt: number): string
  export function verifyCookie(password: string, cookie: string | undefined, now?: number): boolean
  export function passwordsMatch(a: string, b: string): boolean
  ```

- [ ] **Step 1: Write the failing tests**

`test/panel/schedule.test.ts`:
```ts
import { cronToTime, timeToCron, validateTime } from '../../lambda/panel/schedule';

test('converts HH:MM to an EventBridge cron', () => {
  expect(timeToCron('16:05')).toBe('cron(5 16 * * ? *)');
  expect(timeToCron('00:30')).toBe('cron(30 0 * * ? *)');
});

test('converts an EventBridge cron back to zero padded HH:MM', () => {
  expect(cronToTime('cron(0 3 * * ? *)')).toBe('03:00');
  expect(cronToTime('cron(5 16 * * ? *)')).toBe('16:05');
});

test('round trips', () => {
  expect(cronToTime(timeToCron('23:59'))).toBe('23:59');
});

test('validates times', () => {
  expect(validateTime('09:00')).toBe(true);
  expect(validateTime('9:00')).toBe(false);
  expect(validateTime('24:00')).toBe(false);
  expect(validateTime('12:60')).toBe(false);
  expect(validateTime('')).toBe(false);
});

test('rejects unsupported cron shapes', () => {
  expect(() => cronToTime('cron(0 3 * * MON *)')).toThrow(/unsupported/);
  expect(() => timeToCron('9:00')).toThrow(/invalid time/);
});
```

`test/panel/auth.test.ts`:
```ts
import { COOKIE_MAX_AGE_SECONDS, passwordsMatch, signCookie, verifyCookie } from '../../lambda/panel/auth';

const password = 'rEDAfML359Ba';
const now = 1_800_000_000_000;

test('a signed cookie verifies before it expires', () => {
  const cookie = signCookie(password, now + 1000);
  expect(verifyCookie(password, cookie, now)).toBe(true);
});

test('rejects the wrong password', () => {
  const cookie = signCookie(password, now + 1000);
  expect(verifyCookie('wrongwrong12', cookie, now)).toBe(false);
});

test('rejects an expired cookie', () => {
  const cookie = signCookie(password, now - 1);
  expect(verifyCookie(password, cookie, now)).toBe(false);
});

test('rejects a tampered expiry or signature', () => {
  const cookie = signCookie(password, now + 1000);
  const [exp, sig] = cookie.split('.');
  expect(verifyCookie(password, `${Number(exp) + 60_000}.${sig}`, now)).toBe(false);
  expect(verifyCookie(password, `${exp}.${'0'.repeat(sig.length)}`, now)).toBe(false);
  expect(verifyCookie(password, `${exp}.nothex`, now)).toBe(false);
  expect(verifyCookie(password, undefined, now)).toBe(false);
  expect(verifyCookie(password, 'garbage', now)).toBe(false);
});

test('max age is thirty days', () => {
  expect(COOKIE_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
});

test('password comparison is exact', () => {
  expect(passwordsMatch(password, password)).toBe(true);
  expect(passwordsMatch(password, password + 'x')).toBe(false);
  expect(passwordsMatch(password, 'rEDAfML359Bb')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/panel`
Expected: FAIL, cannot find modules `../../lambda/panel/schedule` and `../../lambda/panel/auth`.

- [ ] **Step 3: Implement**

`lambda/panel/schedule.ts`:
```ts
const CRON = /^cron\((\d{1,2}) (\d{1,2}) \* \* \? \*\)$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateTime(hhmm: string): boolean {
  return HHMM.test(hhmm);
}

export function timeToCron(hhmm: string): string {
  if (!validateTime(hhmm)) throw new Error(`invalid time: ${hhmm}`);
  const [hour, minute] = hhmm.split(':').map(Number);
  return `cron(${minute} ${hour} * * ? *)`;
}

export function cronToTime(expr: string): string {
  const match = CRON.exec(expr);
  if (!match) throw new Error(`unsupported cron expression: ${expr}`);
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
```

`lambda/panel/auth.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'valheim_panel';
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const HEX64 = /^[0-9a-f]{64}$/;

export function signCookie(password: string, expiresAt: number): string {
  return `${expiresAt}.${hmac(password, String(expiresAt))}`;
}

export function verifyCookie(password: string, cookie: string | undefined, now = Date.now()): boolean {
  if (!cookie) return false;
  const dot = cookie.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(cookie.slice(0, dot));
  const signature = cookie.slice(dot + 1);
  if (!Number.isInteger(expiresAt) || expiresAt <= now || !HEX64.test(signature)) return false;
  const expected = hmac(password, String(expiresAt));
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export function passwordsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/panel && npx tsc --noEmit`
Expected: 11 passed across 2 files, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lambda/panel/schedule.ts lambda/panel/auth.ts test/panel && git commit -m "Add panel cron conversion and cookie auth helpers"
```

---

### Task 4: Steam A2S_INFO query

**Files:**
- Create: `lambda/panel/a2s.ts`
- Test: `test/panel/a2s.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ServerInfo { name: string; players: number; maxPlayers: number }
  export const INFO_REQUEST: Buffer
  export function isChallenge(buf: Buffer): boolean
  export function parseInfo(buf: Buffer): ServerInfo          // throws on malformed input
  export function queryInfo(host: string, port: number, timeoutMs?: number): Promise<ServerInfo | null>
  ```

- [ ] **Step 1: Write the failing tests**

`test/panel/a2s.test.ts`:
```ts
import { createSocket } from 'node:dgram';
import { INFO_REQUEST, isChallenge, parseInfo, queryInfo } from '../../lambda/panel/a2s';

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function cstr(s: string): Buffer {
  return Buffer.from(`${s}\0`, 'utf8');
}

function infoResponse(name: string, players: number, maxPlayers: number): Buffer {
  return Buffer.concat([
    HEADER,
    Buffer.from([0x49, 0x11]),
    cstr(name), cstr('Valheim map'), cstr('valheim'), cstr('Valheim'),
    Buffer.from([0x0a, 0x00]),              // app id (little endian, irrelevant)
    Buffer.from([players, maxPlayers, 0x00]),
    Buffer.from([0x64, 0x6c, 0x00, 0x00]),  // dedicated, linux, public, no vac
    cstr('1.0.12'),
  ]);
}

const challenge = Buffer.concat([HEADER, Buffer.from([0x41, 0xde, 0xad, 0xbe, 0xef])]);

test('parses players, max players and name from an info response', () => {
  expect(parseInfo(infoResponse('valheim-osrs-nerds', 3, 10))).toEqual({
    name: 'valheim-osrs-nerds',
    players: 3,
    maxPlayers: 10,
  });
});

test('recognizes a challenge packet', () => {
  expect(isChallenge(challenge)).toBe(true);
  expect(isChallenge(infoResponse('x', 0, 10))).toBe(false);
});

test('rejects malformed packets', () => {
  expect(() => parseInfo(Buffer.from([1, 2, 3]))).toThrow(/A2S_INFO/);
  expect(() => parseInfo(Buffer.concat([HEADER, Buffer.from([0x49, 0x11]), Buffer.from('no terminator')]))).toThrow(/unterminated/);
});

test('the request packet is the standard A2S_INFO query', () => {
  expect(INFO_REQUEST.subarray(0, 5)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]));
  expect(INFO_REQUEST.subarray(5).toString('latin1')).toBe('Source Engine Query\0');
});

test('completes the challenge handshake against a local fake server', async () => {
  const server = createSocket('udp4');
  let sawChallengeReply = false;
  server.on('message', (msg, rinfo) => {
    if (msg.length === INFO_REQUEST.length) {
      server.send(challenge, rinfo.port, rinfo.address);
    } else if (msg.subarray(INFO_REQUEST.length).equals(challenge.subarray(5, 9))) {
      sawChallengeReply = true;
      server.send(infoResponse('local', 2, 10), rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await expect(queryInfo('127.0.0.1', port, 2000)).resolves.toEqual({ name: 'local', players: 2, maxPlayers: 10 });
    expect(sawChallengeReply).toBe(true);
  } finally {
    server.close();
  }
});

test('returns null when nothing answers', async () => {
  await expect(queryInfo('127.0.0.1', 1, 200)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/panel/a2s.test.ts`
Expected: FAIL, cannot find module `../../lambda/panel/a2s`.

- [ ] **Step 3: Implement**

`lambda/panel/a2s.ts`:
```ts
import { createSocket } from 'node:dgram';

export interface ServerInfo {
  name: string;
  players: number;
  maxPlayers: number;
}

const HEADER = 0xffffffff;
const TYPE_INFO_REQUEST = 0x54;
const TYPE_CHALLENGE = 0x41;
const TYPE_INFO_RESPONSE = 0x49;

export const INFO_REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, TYPE_INFO_REQUEST]),
  Buffer.from('Source Engine Query\0', 'latin1'),
]);

export function isChallenge(buf: Buffer): boolean {
  return buf.length >= 9 && buf.readUInt32LE(0) === HEADER && buf[4] === TYPE_CHALLENGE;
}

export function parseInfo(buf: Buffer): ServerInfo {
  if (buf.length < 6 || buf.readUInt32LE(0) !== HEADER || buf[4] !== TYPE_INFO_RESPONSE) {
    throw new Error('not an A2S_INFO response');
  }
  let offset = 6; // header, type, protocol byte
  const readString = (): string => {
    const end = buf.indexOf(0, offset);
    if (end < 0) throw new Error('unterminated string in A2S_INFO response');
    const value = buf.toString('utf8', offset, end);
    offset = end + 1;
    return value;
  };
  const name = readString();
  readString(); // map
  readString(); // folder
  readString(); // game
  offset += 2; // app id
  if (offset + 1 >= buf.length) throw new Error('truncated A2S_INFO response');
  return { name, players: buf[offset], maxPlayers: buf[offset + 1] };
}

export function queryInfo(host: string, port: number, timeoutMs = 1500): Promise<ServerInfo | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const finish = (value: ServerInfo | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('error', () => finish(null));
    socket.on('message', (message) => {
      if (isChallenge(message)) {
        socket.send(Buffer.concat([INFO_REQUEST, message.subarray(5, 9)]), port, host);
        return;
      }
      try {
        finish(parseInfo(message));
      } catch {
        finish(null);
      }
    });
    socket.send(INFO_REQUEST, port, host);
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/panel/a2s.test.ts && npx tsc --noEmit`
Expected: 6 passed, tsc clean. The timeout test takes about 200 ms.

- [ ] **Step 5: Commit**

```bash
git add lambda/panel/a2s.ts test/panel/a2s.test.ts && git commit -m "Add Steam A2S_INFO query for player count"
```

---

### Task 5: HTML rendering

**Files:**
- Create: `lambda/panel/html.ts`
- Test: `test/panel/html.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type InstanceState = 'running' | 'stopped' | 'pending' | 'stopping' | 'unknown';
  export interface ScheduleView { enabled: boolean; stopAt: string; startAt: string }
  export interface PanelView {
    serverName: string; state: InstanceState; since?: string;
    players?: number; maxPlayers?: number;
    connectString: string; steamString: string;
    schedule: ScheduleView; timezone: string; message?: string; updatedAt: string;
  }
  export const MESSAGES: Record<string, string>
  export function renderLogin(error?: string): string
  export function renderPanel(view: PanelView): string
  ```

- [ ] **Step 1: Write the failing tests**

`test/panel/html.test.ts`:
```ts
import { MESSAGES, PanelView, renderLogin, renderPanel } from '../../lambda/panel/html';

const base: PanelView = {
  serverName: 'valheim-osrs-nerds',
  state: 'running',
  since: 'Sep 18, 12:02 a.m.',
  players: 3,
  maxPlayers: 10,
  connectString: '100.29.76.244:2456',
  steamString: '100.29.76.244:2457',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  timezone: 'America/Toronto',
  updatedAt: '12:05 a.m.',
};

test('running panel shows status, players, connect strings and schedule', () => {
  const html = renderPanel(base);
  expect(html).toContain('Running since Sep 18, 12:02 a.m.');
  expect(html).toContain('Players: 3 / 10');
  expect(html).toContain('100.29.76.244:2456');
  expect(html).toContain('100.29.76.244:2457');
  expect(html).toContain('value="03:00"');
  expect(html).toContain('value="16:00"');
  expect(html).toContain('America/Toronto');
  expect(html).toMatch(/<button[^>]*name="action" value="start"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*name="action" value="stop"(?![^>]*disabled)/);
  expect(html).toContain('confirm(');
  expect(html).toContain('http-equiv="refresh" content="30"');
});

test('stopped panel disables stop and shows unknown players as such', () => {
  const html = renderPanel({ ...base, state: 'stopped', since: undefined, players: undefined, maxPlayers: undefined });
  expect(html).toContain('Stopped');
  expect(html).not.toContain('Players:');
  expect(html).toMatch(/<button[^>]*name="action" value="stop"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*name="action" value="start"(?![^>]*disabled)/);
});

test('running panel without a query answer says unknown', () => {
  expect(renderPanel({ ...base, players: undefined, maxPlayers: undefined })).toContain('Players: unknown');
});

test('renders a known message and ignores unknown ones', () => {
  expect(renderPanel({ ...base, message: MESSAGES['starting'] })).toContain('Starting the server');
  expect(renderPanel({ ...base, message: undefined })).not.toContain('class="msg"');
});

test('schedule checkbox reflects enabled', () => {
  expect(renderPanel({ ...base, schedule: { ...base.schedule, enabled: true } })).toMatch(/name="enabled"[^>]*checked/);
  expect(renderPanel(base)).not.toMatch(/name="enabled"[^>]*checked/);
});

test('escapes html in dynamic text', () => {
  expect(renderPanel({ ...base, serverName: '<b>x</b>' })).not.toContain('<b>x</b>');
  expect(renderPanel({ ...base, serverName: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
});

test('login page shows the error when given', () => {
  expect(renderLogin()).toContain('name="password"');
  expect(renderLogin()).not.toContain('class="error"');
  expect(renderLogin('Wrong password')).toContain('Wrong password');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/panel/html.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`lambda/panel/html.ts`:
```ts
export type InstanceState = 'running' | 'stopped' | 'pending' | 'stopping' | 'unknown';

export interface ScheduleView {
  enabled: boolean;
  stopAt: string;
  startAt: string;
}

export interface PanelView {
  serverName: string;
  state: InstanceState;
  since?: string;
  players?: number;
  maxPlayers?: number;
  connectString: string;
  steamString: string;
  schedule: ScheduleView;
  timezone: string;
  message?: string;
  updatedAt: string;
}

export const MESSAGES: Record<string, string> = {
  starting: 'Starting the server. Give it about two minutes.',
  stopping: 'Stopping the server. The world saves first.',
  'already-running': 'The server is already running.',
  'already-stopped': 'The server is already stopped.',
  'schedule-saved': 'Schedule saved.',
  'bad-time': 'Times must be HH:MM on a 24 hour clock.',
  error: 'Something went wrong, try again.',
};

const STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 16px; max-width: 480px; margin-inline: auto; background: Canvas; color: CanvasText; }
  h1 { font-size: 1.25rem; margin: 8px 0 16px; }
  .card { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; background: #888; }
  .dot.running { background: #2e9e4f; }
  .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin: 6px 0; }
  code { font-size: 1rem; }
  button, input[type=submit] { font: inherit; padding: 10px 14px; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); background: Canvas; color: CanvasText; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: #2e9e4f; color: white; border-color: #2e9e4f; }
  button.danger { background: #b3261e; color: white; border-color: #b3261e; }
  input[type=time] { font: inherit; padding: 6px; }
  .msg { padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, #2e9e4f 15%, Canvas); margin-bottom: 12px; }
  .error { color: #b3261e; margin: 8px 0; }
  .muted { opacity: .7; font-size: .9rem; }
  form.inline { display: inline; }
`;

export function renderLogin(error?: string): string {
  return page('Valheim', `
    <h1>Valheim server</h1>
    <div class="card">
      <form method="post" action="/login">
        <label>Server password<br><input type="password" name="password" autocomplete="current-password" autofocus required></label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <p><button class="primary" type="submit">Enter</button></p>
      </form>
    </div>`);
}

export function renderPanel(v: PanelView): string {
  const running = v.state === 'running';
  const stopped = v.state === 'stopped';
  const players = v.players === undefined || v.maxPlayers === undefined ? 'unknown' : `${v.players} / ${v.maxPlayers}`;
  const status = running
    ? `Running since ${esc(v.since ?? '')}`
    : v.state === 'stopped' ? 'Stopped' : cap(v.state);
  const confirmStop = (v.players ?? 0) > 0
    ? ` onsubmit="return confirm('${v.players} player${v.players === 1 ? '' : 's'} online. Stop anyway?')"`
    : '';
  return page(v.serverName, `
    <h1>${esc(v.serverName)}</h1>
    ${v.message ? `<div class="msg">${esc(v.message)}</div>` : ''}
    <div class="card">
      <div class="row"><span><span class="dot ${running ? 'running' : ''}"></span>${status}</span></div>
      ${running ? `<div class="row"><span>Players: ${esc(players)}</span></div>` : ''}
      <div class="row">
        <form class="inline" method="post" action="/action">
          <button class="primary" type="submit" name="action" value="start"${stopped ? '' : ' disabled'}>Start</button>
        </form>
        <form class="inline" method="post" action="/action"${confirmStop}>
          <button class="danger" type="submit" name="action" value="stop"${running ? '' : ' disabled'}>Stop</button>
        </form>
      </div>
    </div>
    <div class="card">
      <div class="row"><span>Join IP</span><code id="join">${esc(v.connectString)}</code><button type="button" onclick="copy('join')">Copy</button></div>
      <div class="row"><span>Steam favorites</span><code id="steam">${esc(v.steamString)}</code><button type="button" onclick="copy('steam')">Copy</button></div>
      <p class="muted">Password is the one you were given.</p>
    </div>
    <div class="card">
      <form method="post" action="/schedule">
        <div class="row"><label><input type="checkbox" name="enabled" value="on"${v.schedule.enabled ? ' checked' : ''}> Nightly schedule enabled</label></div>
        <div class="row"><label>Stop at <input type="time" name="stopAt" value="${esc(v.schedule.stopAt)}" required></label></div>
        <div class="row"><label>Start at <input type="time" name="startAt" value="${esc(v.schedule.startAt)}" required></label></div>
        <p class="muted">Times are ${esc(v.timezone)}. When enabled, the server stops at the stop time and starts at the start time every day.</p>
        <button type="submit">Save schedule</button>
      </form>
    </div>
    <p class="muted">Updated ${esc(v.updatedAt)} · refreshes every 30 s ·
      <form class="inline" method="post" action="/logout"><button type="submit">Log out</button></form></p>
    <script>
      function copy(id) { navigator.clipboard.writeText(document.getElementById(id).textContent); }
    </script>`, true);
}

function page(title: string, body: string, refresh = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="30">' : ''}
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

Note the middle dot `·` in the footer is U+00B7, not an em dash; it is allowed.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- test/panel/html.test.ts && npx tsc --noEmit`
Expected: 7 passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lambda/panel/html.ts test/panel/html.test.ts && git commit -m "Render the control panel pages"
```

---

### Task 6: AWS wrapper, handler factory, Lambda entry

**Files:**
- Create: `lambda/panel/aws.ts`, `lambda/panel/index.ts`, `lambda/panel/handler.ts`
- Test: `test/panel/index.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 to 5.
- Produces:
  ```ts
  // lambda/panel/aws.ts
  export interface InstanceStatus { state: string; launchTime?: Date }
  export interface ScheduleSettings { enabled: boolean; stopCron: string; startCron: string }
  export interface Aws {
    describeInstance(id: string): Promise<InstanceStatus>;
    startInstance(id: string): Promise<void>;
    stopInstance(id: string): Promise<void>;
    getSchedules(stopName: string, startName: string): Promise<ScheduleSettings>;
    updateSchedules(stopName: string, startName: string, settings: ScheduleSettings): Promise<void>;
    getServerPassword(secretArn: string): Promise<string>;
  }
  export function createAws(): Aws
  // lambda/panel/index.ts
  export interface Env { instanceId; serverHost; gamePort; queryPort; secretArn; stopScheduleName; startScheduleName; timezone; serverName }  // all string except ports: number
  export interface Deps { aws: Aws; env: Env; queryPlayers(host: string, port: number): Promise<{ players: number; maxPlayers: number } | null>; sleep(ms: number): Promise<void>; now(): number }
  export function readEnv(source?: NodeJS.ProcessEnv): Env
  export function createHandler(deps: Deps): (event: LambdaFunctionURLEvent) => Promise<APIGatewayProxyStructuredResultV2>
  // lambda/panel/handler.ts
  export const handler
  ```

- [ ] **Step 1: Write the failing tests**

`test/panel/index.test.ts`:
```ts
import type { APIGatewayProxyStructuredResultV2 as Result, LambdaFunctionURLEvent } from 'aws-lambda';
import { signCookie } from '../../lambda/panel/auth';
import type { Aws, ScheduleSettings } from '../../lambda/panel/aws';
import { createHandler, Deps, readEnv } from '../../lambda/panel/index';

const password = 'rEDAfML359Ba';
const now = 1_800_000_000_000;

function fakeAws(overrides: Partial<Aws> = {}) {
  const calls: string[] = [];
  let schedules: ScheduleSettings = { enabled: false, stopCron: 'cron(0 3 * * ? *)', startCron: 'cron(0 16 * * ? *)' };
  const aws: Aws = {
    describeInstance: async () => ({ state: 'running', launchTime: new Date(now - 3_600_000) }),
    startInstance: async (id) => { calls.push(`start:${id}`); },
    stopInstance: async (id) => { calls.push(`stop:${id}`); },
    getSchedules: async () => schedules,
    updateSchedules: async (_s, _t, settings) => { calls.push('update'); schedules = settings; },
    getServerPassword: async () => password,
    ...overrides,
  };
  return { aws, calls, schedules: () => schedules };
}

function deps(aws: Aws, slept: number[] = []): Deps {
  return {
    aws,
    env: {
      instanceId: 'i-123', serverHost: '100.29.76.244', gamePort: 2456, queryPort: 2457,
      secretArn: 'arn:secret', stopScheduleName: 'valheim-stop', startScheduleName: 'valheim-start',
      timezone: 'America/Toronto', serverName: 'valheim-osrs-nerds',
    },
    queryPlayers: async () => ({ players: 2, maxPlayers: 10 }),
    sleep: async (ms) => { slept.push(ms); },
    now: () => now,
  };
}

function event(opts: { method?: string; path?: string; body?: string; cookie?: string; origin?: string; query?: Record<string, string> } = {}): LambdaFunctionURLEvent {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: opts.path ?? '/',
    rawQueryString: '',
    headers: { host: 'abc.lambda-url.us-east-1.on.aws', ...(opts.origin ? { origin: opts.origin } : {}) },
    cookies: opts.cookie ? [`valheim_panel=${opts.cookie}`] : undefined,
    queryStringParameters: opts.query,
    requestContext: { http: { method: opts.method ?? 'GET', path: opts.path ?? '/', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'jest' } } as LambdaFunctionURLEvent['requestContext'],
    body: opts.body,
    isBase64Encoded: false,
  } as LambdaFunctionURLEvent;
}

const good = () => signCookie(password, now + 60_000);
const sameOrigin = 'https://abc.lambda-url.us-east-1.on.aws';

function header(res: Result, name: string): string | undefined {
  return res.headers?.[name] as string | undefined;
}

test('unauthenticated GET shows the login page', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event());
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('name="password"');
  expect(res.body).not.toContain('Players');
});

test('wrong password waits a second and re-renders login with an error', async () => {
  const { aws } = fakeAws();
  const slept: number[] = [];
  const res = await createHandler(deps(aws, slept))(event({ method: 'POST', path: '/login', body: 'password=nope' }));
  expect(slept).toEqual([1000]);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Wrong password');
  expect(res.cookies).toBeUndefined();
});

test('correct password sets a cookie and redirects home', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/login', body: `password=${password}` }));
  expect(res.statusCode).toBe(303);
  expect(header(res, 'location')).toBe('/');
  expect(res.cookies?.[0]).toMatch(/^valheim_panel=\d+\.[0-9a-f]{64}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
});

test('authenticated GET renders the panel with players and schedule', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event({ cookie: good(), query: { msg: 'starting' } }));
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Running since');
  expect(res.body).toContain('Players: 2 / 10');
  expect(res.body).toContain('value="03:00"');
  expect(res.body).toContain('Starting the server');
  expect(header(res, 'cache-control')).toBe('no-store');
});

test('player query is skipped when stopped and unknown when it times out', async () => {
  const stopped = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  let queried = 0;
  const d = deps(stopped.aws);
  d.queryPlayers = async () => { queried += 1; return null; };
  const res = await createHandler(d)(event({ cookie: good() }));
  expect(queried).toBe(0);
  expect(res.body).toContain('Stopped');

  const running = fakeAws();
  const d2 = deps(running.aws);
  d2.queryPlayers = async () => null;
  expect((await createHandler(d2)(event({ cookie: good() }))).body).toContain('Players: unknown');
});

test('POST without a cookie or from another origin is rejected', async () => {
  const { aws, calls } = fakeAws();
  const h = createHandler(deps(aws));
  expect((await h(event({ method: 'POST', path: '/action', body: 'action=stop', origin: sameOrigin }))).statusCode).toBe(401);
  expect((await h(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good(), origin: 'https://evil.example' }))).statusCode).toBe(403);
  expect((await h(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good() }))).statusCode).toBe(403);
  expect(calls).toEqual([]);
});

test('start when stopped starts the instance and redirects', async () => {
  const { aws, calls } = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=start', cookie: good(), origin: sameOrigin }));
  expect(calls).toEqual(['start:i-123']);
  expect(res.statusCode).toBe(303);
  expect(header(res, 'location')).toBe('/?msg=starting');
});

test('stop when already stopped is a no-op with a message', async () => {
  const { aws, calls } = fakeAws({ describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=stop', cookie: good(), origin: sameOrigin }));
  expect(calls).toEqual([]);
  expect(header(res, 'location')).toBe('/?msg=already-stopped');
});

test('schedule save validates times and updates both schedules', async () => {
  const f = fakeAws();
  const h = createHandler(deps(f.aws));
  const bad = await h(event({ method: 'POST', path: '/schedule', body: 'enabled=on&stopAt=9:00&startAt=16:00', cookie: good(), origin: sameOrigin }));
  expect(header(bad, 'location')).toBe('/?msg=bad-time');
  expect(f.calls).toEqual([]);

  const ok = await h(event({ method: 'POST', path: '/schedule', body: 'enabled=on&stopAt=02:30&startAt=17:00', cookie: good(), origin: sameOrigin }));
  expect(header(ok, 'location')).toBe('/?msg=schedule-saved');
  expect(f.schedules()).toEqual({ enabled: true, stopCron: 'cron(30 2 * * ? *)', startCron: 'cron(0 17 * * ? *)' });

  const off = await h(event({ method: 'POST', path: '/schedule', body: 'stopAt=02:30&startAt=17:00', cookie: good(), origin: sameOrigin }));
  expect(header(off, 'location')).toBe('/?msg=schedule-saved');
  expect(f.schedules().enabled).toBe(false);
});

test('an AWS failure on an action redirects with the error message', async () => {
  const { aws } = fakeAws({ startInstance: async () => { throw new Error('boom'); }, describeInstance: async () => ({ state: 'stopped' }) });
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/action', body: 'action=start', cookie: good(), origin: sameOrigin }));
  expect(header(res, 'location')).toBe('/?msg=error');
});

test('logout clears the cookie', async () => {
  const { aws } = fakeAws();
  const res = await createHandler(deps(aws))(event({ method: 'POST', path: '/logout', cookie: good(), origin: sameOrigin }));
  expect(res.statusCode).toBe(303);
  expect(res.cookies?.[0]).toContain('Max-Age=0');
});

test('unknown paths are 404', async () => {
  const { aws } = fakeAws();
  expect((await createHandler(deps(aws))(event({ path: '/nope' }))).statusCode).toBe(404);
});

test('readEnv requires every variable and parses ports', () => {
  const full = {
    INSTANCE_ID: 'i-1', SERVER_HOST: 'h', GAME_PORT: '2456', QUERY_PORT: '2457', SECRET_ARN: 'a',
    STOP_SCHEDULE_NAME: 's', START_SCHEDULE_NAME: 't', TIMEZONE: 'America/Toronto', SERVER_NAME: 'n',
  };
  expect(readEnv(full)).toEqual({
    instanceId: 'i-1', serverHost: 'h', gamePort: 2456, queryPort: 2457, secretArn: 'a',
    stopScheduleName: 's', startScheduleName: 't', timezone: 'America/Toronto', serverName: 'n',
  });
  const { SECRET_ARN: _omit, ...missing } = full;
  expect(() => readEnv(missing)).toThrow(/SECRET_ARN/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/panel/index.test.ts`
Expected: FAIL, cannot find module `../../lambda/panel/index`.

- [ ] **Step 3: Implement the AWS wrapper**

`lambda/panel/aws.ts`:
```ts
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import { GetScheduleCommand, SchedulerClient, ScheduleState, UpdateScheduleCommand } from '@aws-sdk/client-scheduler';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export interface InstanceStatus {
  state: string;
  launchTime?: Date;
}

export interface ScheduleSettings {
  enabled: boolean;
  stopCron: string;
  startCron: string;
}

export interface Aws {
  describeInstance(id: string): Promise<InstanceStatus>;
  startInstance(id: string): Promise<void>;
  stopInstance(id: string): Promise<void>;
  getSchedules(stopName: string, startName: string): Promise<ScheduleSettings>;
  updateSchedules(stopName: string, startName: string, settings: ScheduleSettings): Promise<void>;
  getServerPassword(secretArn: string): Promise<string>;
}

export function createAws(): Aws {
  const ec2 = new EC2Client({});
  const scheduler = new SchedulerClient({});
  const secrets = new SecretsManagerClient({});

  const getSchedule = (name: string) => scheduler.send(new GetScheduleCommand({ Name: name, GroupName: 'default' }));

  const putSchedule = async (name: string, cron: string, enabled: boolean) => {
    const current = await getSchedule(name);
    await scheduler.send(new UpdateScheduleCommand({
      Name: name,
      GroupName: 'default',
      ScheduleExpression: cron,
      ScheduleExpressionTimezone: current.ScheduleExpressionTimezone,
      FlexibleTimeWindow: current.FlexibleTimeWindow ?? { Mode: 'OFF' },
      Target: current.Target,
      Description: current.Description,
      State: enabled ? ScheduleState.ENABLED : ScheduleState.DISABLED,
    }));
  };

  return {
    async describeInstance(id) {
      const out = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
      const instance = out.Reservations?.[0]?.Instances?.[0];
      return { state: instance?.State?.Name ?? 'unknown', launchTime: instance?.LaunchTime };
    },
    async startInstance(id) {
      await ec2.send(new StartInstancesCommand({ InstanceIds: [id] }));
    },
    async stopInstance(id) {
      await ec2.send(new StopInstancesCommand({ InstanceIds: [id] }));
    },
    async getSchedules(stopName, startName) {
      const [stop, start] = await Promise.all([getSchedule(stopName), getSchedule(startName)]);
      return {
        enabled: stop.State === ScheduleState.ENABLED,
        stopCron: stop.ScheduleExpression ?? '',
        startCron: start.ScheduleExpression ?? '',
      };
    },
    async updateSchedules(stopName, startName, settings) {
      await putSchedule(stopName, settings.stopCron, settings.enabled);
      await putSchedule(startName, settings.startCron, settings.enabled);
    },
    async getServerPassword(secretArn) {
      const out = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
      const parsed = JSON.parse(out.SecretString ?? '{}') as { password?: string };
      if (!parsed.password) throw new Error('secret has no password field');
      return parsed.password;
    },
  };
}
```

- [ ] **Step 4: Implement the handler factory**

`lambda/panel/index.ts`:
```ts
import type { APIGatewayProxyStructuredResultV2 as Result, LambdaFunctionURLEvent } from 'aws-lambda';
import { COOKIE_MAX_AGE_SECONDS, COOKIE_NAME, passwordsMatch, signCookie, verifyCookie } from './auth';
import type { Aws } from './aws';
import { InstanceState, MESSAGES, renderLogin, renderPanel } from './html';
import { cronToTime, timeToCron, validateTime } from './schedule';

export interface Env {
  instanceId: string;
  serverHost: string;
  gamePort: number;
  queryPort: number;
  secretArn: string;
  stopScheduleName: string;
  startScheduleName: string;
  timezone: string;
  serverName: string;
}

export interface Deps {
  aws: Aws;
  env: Env;
  queryPlayers(host: string, port: number): Promise<{ players: number; maxPlayers: number } | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const PASSWORD_CACHE_MS = 5 * 60 * 1000;
const WRONG_PASSWORD_DELAY_MS = 1000;
const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const need = (name: string): string => {
    const value = source[name];
    if (!value) throw new Error(`missing environment variable ${name}`);
    return value;
  };
  return {
    instanceId: need('INSTANCE_ID'),
    serverHost: need('SERVER_HOST'),
    gamePort: Number(need('GAME_PORT')),
    queryPort: Number(need('QUERY_PORT')),
    secretArn: need('SECRET_ARN'),
    stopScheduleName: need('STOP_SCHEDULE_NAME'),
    startScheduleName: need('START_SCHEDULE_NAME'),
    timezone: need('TIMEZONE'),
    serverName: need('SERVER_NAME'),
  };
}

export function createHandler(deps: Deps) {
  const { aws, env } = deps;
  let cachedPassword: { value: string; fetchedAt: number } | undefined;

  const password = async (): Promise<string> => {
    if (!cachedPassword || deps.now() - cachedPassword.fetchedAt > PASSWORD_CACHE_MS) {
      cachedPassword = { value: await aws.getServerPassword(env.secretArn), fetchedAt: deps.now() };
    }
    return cachedPassword.value;
  };

  return async (event: LambdaFunctionURLEvent): Promise<Result> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const secret = await password();
    const authed = verifyCookie(secret, cookieValue(event), deps.now());

    if (method === 'GET' && path === '/') {
      return authed ? html(await panel(event.queryStringParameters?.msg)) : html(renderLogin());
    }
    if (method === 'POST' && path === '/login') {
      const submitted = form(event).get('password') ?? '';
      if (!passwordsMatch(submitted, secret)) {
        await deps.sleep(WRONG_PASSWORD_DELAY_MS);
        return html(renderLogin('Wrong password'));
      }
      const cookie = signCookie(secret, deps.now() + COOKIE_MAX_AGE_SECONDS * 1000);
      return redirect('/', [`${COOKIE_NAME}=${cookie}; ${COOKIE_ATTRIBUTES}; Max-Age=${COOKIE_MAX_AGE_SECONDS}`]);
    }
    if (method === 'POST') {
      if (!authed) return text(401, 'Log in first');
      if (!sameOrigin(event)) return text(403, 'Cross-site request rejected');
      if (path === '/logout') return redirect('/', [`${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`]);
      if (path === '/action') return action(form(event).get('action'));
      if (path === '/schedule') return saveSchedule(form(event));
    }
    return text(404, 'Not found');
  };

  async function panel(msg: string | undefined): Promise<string> {
    const [instance, schedules] = await Promise.all([
      aws.describeInstance(env.instanceId),
      aws.getSchedules(env.stopScheduleName, env.startScheduleName),
    ]);
    const running = instance.state === 'running';
    const info = running ? await deps.queryPlayers(env.serverHost, env.queryPort) : null;
    return renderPanel({
      serverName: env.serverName,
      state: toState(instance.state),
      since: instance.launchTime ? formatTime(instance.launchTime, env.timezone, true) : undefined,
      players: info?.players,
      maxPlayers: info?.maxPlayers,
      connectString: `${env.serverHost}:${env.gamePort}`,
      steamString: `${env.serverHost}:${env.queryPort}`,
      schedule: { enabled: schedules.enabled, stopAt: cronToTime(schedules.stopCron), startAt: cronToTime(schedules.startCron) },
      timezone: env.timezone,
      message: msg ? MESSAGES[msg] : undefined,
      updatedAt: formatTime(new Date(deps.now()), env.timezone, false),
    });
  }

  async function action(name: string | null): Promise<Result> {
    if (name !== 'start' && name !== 'stop') return text(400, 'Unknown action');
    try {
      const { state } = await aws.describeInstance(env.instanceId);
      if (name === 'start') {
        if (state !== 'stopped') return redirect('/?msg=already-running');
        await aws.startInstance(env.instanceId);
        return redirect('/?msg=starting');
      }
      if (state !== 'running') return redirect('/?msg=already-stopped');
      await aws.stopInstance(env.instanceId);
      return redirect('/?msg=stopping');
    } catch (error) {
      console.error('action failed', error);
      return redirect('/?msg=error');
    }
  }

  async function saveSchedule(fields: URLSearchParams): Promise<Result> {
    const stopAt = fields.get('stopAt') ?? '';
    const startAt = fields.get('startAt') ?? '';
    if (!validateTime(stopAt) || !validateTime(startAt)) return redirect('/?msg=bad-time');
    try {
      await aws.updateSchedules(env.stopScheduleName, env.startScheduleName, {
        enabled: fields.get('enabled') === 'on',
        stopCron: timeToCron(stopAt),
        startCron: timeToCron(startAt),
      });
      return redirect('/?msg=schedule-saved');
    } catch (error) {
      console.error('schedule update failed', error);
      return redirect('/?msg=error');
    }
  }
}

const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

function cookieValue(event: LambdaFunctionURLEvent): string | undefined {
  const prefix = `${COOKIE_NAME}=`;
  return event.cookies?.find((c) => c.startsWith(prefix))?.slice(prefix.length);
}

function form(event: LambdaFunctionURLEvent): URLSearchParams {
  const raw = event.body ?? '';
  return new URLSearchParams(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
}

// Browsers send Origin on form posts; fall back to Referer for the rare client that omits it.
function sameOrigin(event: LambdaFunctionURLEvent): boolean {
  const host = event.headers.host;
  const source = event.headers.origin ?? event.headers.referer;
  if (!host || !source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function toState(state: string): InstanceState {
  return (['running', 'stopped', 'pending', 'stopping'] as const).find((s) => s === state) ?? 'unknown';
}

function formatTime(date: Date, timeZone: string, withDate: boolean): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
  }).format(date);
}

function html(body: string): Result {
  return { statusCode: 200, headers: HTML, body };
}

function text(statusCode: number, body: string): Result {
  return { statusCode, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body };
}

function redirect(location: string, cookies?: string[]): Result {
  return { statusCode: 303, headers: { location, 'cache-control': 'no-store' }, body: '', ...(cookies ? { cookies } : {}) };
}
```

`lambda/panel/handler.ts`:
```ts
import { queryInfo } from './a2s';
import { createAws } from './aws';
import { createHandler, readEnv } from './index';

export const handler = createHandler({
  aws: createAws(),
  env: readEnv(),
  queryPlayers: (host, port) => queryInfo(host, port),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- test/panel && npx tsc --noEmit`
Expected: index 13 passed, all panel suites green, tsc clean. If `Result` complains about `cookies`, the type is `APIGatewayProxyStructuredResultV2`, which has `cookies?: string[]`; check the `@types/aws-lambda` version is current with `npm ls @types/aws-lambda`.

- [ ] **Step 6: Commit**

```bash
git add lambda/panel test/panel/index.test.ts && git commit -m "Add the control panel Lambda handler"
```

---

### Task 7: ControlPanel construct and stack wiring

**Files:**
- Create: `lib/control-panel.ts`
- Modify: `lib/valheim-server-stack.ts`, `test/stack.test.ts`, `test/__snapshots__/stack.test.ts.snap`

**Interfaces:**
- Consumes: `Schedule` (`targetRole`, `stopScheduleArn`, `startScheduleArn`), `STOP_SCHEDULE_NAME`, `START_SCHEDULE_NAME`, `GAME_PORT`, `QUERY_PORT`, `server.instance`, `network.eip.attrPublicIp`, `settings.secret`.
- Produces: `export class ControlPanel extends Construct { readonly url: lambda.FunctionUrl }`; stack output `PanelUrl` when `config.panel.enabled`.

- [ ] **Step 1: Add the failing tests**

Append to `test/stack.test.ts`:
```ts
describe('control panel', () => {
  const template = synth();
  const json = JSON.stringify(template.toJSON());

  test('one arm64 node 22 lambda behind an open function url', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      MemorySize: 256,
      Timeout: 10,
      Environment: { Variables: Match.objectLike({ STOP_SCHEDULE_NAME: 'valheim-stop', START_SCHEDULE_NAME: 'valheim-start', GAME_PORT: '2456', QUERY_PORT: '2457', TIMEZONE: 'America/Toronto', SERVER_NAME: 'valheim-osrs-nerds' }) },
    }));
    template.resourceCountIs('AWS::Lambda::Url', 1);
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });

  test('lambda role is scoped to the instance, the two schedules and the target role', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'ec2:DescribeInstances', Resource: '*' }),
          Match.objectLike({ Action: ['ec2:StartInstances', 'ec2:StopInstances'] }),
          Match.objectLike({ Action: ['scheduler:GetSchedule', 'scheduler:UpdateSchedule'] }),
          Match.objectLike({ Action: 'iam:PassRole' }),
        ]),
      }),
    });
    expect(json).toContain('schedule/default/valheim-stop');
    expect(json).toContain('schedule/default/valheim-start');
    expect(json.match(/"Resource":"\*"/g) ?? []).toHaveLength(1);
  });

  test('exposes the panel url and creates nothing when disabled', () => {
    expect(Object.keys(template.findOutputs('*'))).toContain('PanelUrl');
    const off = synth({ panel: { enabled: false } });
    off.resourceCountIs('AWS::Lambda::Function', 0);
    off.resourceCountIs('AWS::Lambda::Url', 0);
    expect(Object.keys(off.findOutputs('*'))).not.toContain('PanelUrl');
  });
});
```
Also update the existing `'exposes the operator outputs'` test's expected array to include `'PanelUrl'` in sorted position (after `'InstanceId'`, before `'PasswordCommand'`).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/stack.test.ts`
Expected: FAIL on the three new tests and the outputs test.

- [ ] **Step 3: Implement the construct**

`lib/control-panel.ts`:
```ts
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { GAME_PORT, QUERY_PORT } from './network';
import { Schedule, START_SCHEDULE_NAME, STOP_SCHEDULE_NAME } from './schedule';

export interface ControlPanelProps {
  instance: ec2.Instance;
  publicIp: string;
  secret: secretsmanager.ISecret;
  schedule: Schedule;
  timezone: string;
  serverName: string;
}

export class ControlPanel extends Construct {
  readonly url: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ControlPanelProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    const fn = new nodejs.NodejsFunction(this, 'Function', {
      entry: path.join(__dirname, '..', 'lambda', 'panel', 'handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling: { externalModules: ['@aws-sdk/*'], minify: true, sourceMap: false },
      logGroup: new logs.LogGroup(this, 'Logs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        INSTANCE_ID: props.instance.instanceId,
        SERVER_HOST: props.publicIp,
        GAME_PORT: String(GAME_PORT),
        QUERY_PORT: String(QUERY_PORT),
        SECRET_ARN: props.secret.secretArn,
        STOP_SCHEDULE_NAME,
        START_SCHEDULE_NAME,
        TIMEZONE: props.timezone,
        SERVER_NAME: props.serverName,
      },
    });

    const instanceArn = stack.formatArn({
      service: 'ec2',
      resource: 'instance',
      resourceName: props.instance.instanceId,
    });
    // DescribeInstances does not support resource level permissions
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:DescribeInstances'], resources: ['*'] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:StartInstances', 'ec2:StopInstances'], resources: [instanceArn] }));
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['scheduler:GetSchedule', 'scheduler:UpdateSchedule'],
      resources: [props.schedule.stopScheduleArn, props.schedule.startScheduleArn],
    }));
    // UpdateSchedule passes the target role back to Scheduler
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [props.schedule.targetRole.roleArn] }));
    props.secret.grantRead(fn);

    this.url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
  }
}
```

- [ ] **Step 4: Wire the stack**

In `lib/valheim-server-stack.ts` add the import `import { ControlPanel } from './control-panel';` and, after the `CostGuard` line:
```ts
    if (config.panel.enabled) {
      const panel = new ControlPanel(this, 'Panel', {
        instance: server.instance,
        publicIp: network.eip.attrPublicIp,
        secret: settings.secret,
        schedule,
        timezone: config.timezone,
        serverName: config.serverName,
      });
      new cdk.CfnOutput(this, 'PanelUrl', { value: panel.url.url, description: 'Control panel for friends' });
    }
```

- [ ] **Step 5: Run to verify pass, refresh the snapshot**

Run: `npm test -- test/stack.test.ts -u && npm test && npx tsc --noEmit`
Expected: stack suite green including the new describe, snapshot updated, every suite green, tsc clean. If `iam:PassRole` is rendered as an array in the policy (`Action: ['iam:PassRole']`), adjust the test matcher to match the rendered shape and note it in the report.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add the control panel Lambda and function url"
```

---

### Task 8: Operator script and README

**Files:**
- Modify: `scripts/server.sh`, `README.md`

- [ ] **Step 1: Add the `panel` subcommand**

In `scripts/server.sh`, add before the `shell)` case:
```bash
  panel)
    echo "Control panel: $(output PanelUrl)" ;;
```
and update the usage string to `{ip|panel|status|start|stop|restart|logs [lines]|service|shell|password|set-webhook <url>}`.

- [ ] **Step 2: Update the README**

In `README.md`:
- In `## First deploy`, add a line after `npm run server -- password`: `npm run server -- panel    # web page for friends`.
- Add this section after `## Joining`:
````markdown
## Control panel

`npm run server -- panel` prints the URL. Friends log in with the server password (cookie
lasts 30 days). The page shows running or stopped, players online, the connect strings,
and the nightly schedule. Start and Stop act immediately; Stop asks for confirmation when
players are on. Schedule edits are live and survive deploys unless `schedule` in
`lib/config.ts` changes, in which case the next deploy resets them to those values.
````
- In `## Joining`, add: `The server is listed in the in-game server browser under its name, so friends can also find it there.`
- In `## Day to day`, add a row: `| Panel URL | \`npm run server -- panel\` |`.

- [ ] **Step 3: Verify and commit**

```bash
bash -n scripts/server.sh && (scripts/server.sh || true) 2>&1 | grep -q panel && echo "usage ok"
grep -c $'\xe2\x80\x94' README.md scripts/server.sh   # em dash check, expect 0 for both
npm test && npx tsc --noEmit
git add -A && git commit -m "Document the control panel and add the panel command" && git push -u origin panel
```

---

### Task 9: Deploy and verify

Controller task. Requires `aws sts get-caller-identity --profile valheim` to return `user/valheim-admin` in account 623096509435.

- [ ] **Step 1: Diff and deploy**

```bash
npm run diff 2>&1 | grep -E '^\[\+\]|^\[~\]|^\[-\]' | head -30
npm run deploy 2>&1 | tail -20
```
Expected: adds the Lambda, URL, log group, one scheduler role plus two schedules (the old per-target roles are replaced), updates the compose parameter, and prints `PanelUrl`. Bundling runs esbuild locally during synth.

- [ ] **Step 2: Apply the public flag to the running server**

```bash
npm run server -- restart
```
Expected: `active`. The container restarts with `SERVER_PUBLIC=true`; players are disconnected for about a minute.

- [ ] **Step 3: Verify the page**

Open `PanelUrl` in a browser. Expect the login page; enter the server password; expect the panel with `Running since`, both connect strings, and the schedule showing 03:00 and 16:00 unchecked. Within a minute of the restart, `Players: 0 / 10` appears. Have the user join and refresh: `Players: 1 / 10`.

- [ ] **Step 4: Verify actions and schedule**

Press Stop, confirm; the page redirects with `Stopping the server` and within a minute shows `Stopped`. Press Start; within two minutes `Running since` returns. Tick the schedule box, set stop 02:30 and start 17:00, Save; expect `Schedule saved`; confirm in the console or with:
```bash
aws scheduler get-schedule --name valheim-stop --group-name default --query '[State,ScheduleExpression]' --output text
```
Expected: `ENABLED cron(30 2 * * ? *)`. Then untick and save again to leave the schedule off, and confirm `DISABLED`.

- [ ] **Step 5: Merge and push**

```bash
git checkout main && git merge --ff-only panel && npm test && git push origin main && git push origin --delete panel && git branch -d panel
```

---

## Self-review notes

- Spec coverage: config flag and public server (T1); permanent named schedules with shared role and ARNs (T2); cron/time and cookie helpers (T3); A2S query with challenge (T4); pages and message map (T5); AWS wrapper, routes, same-origin check, wrong-password delay, password cache, error handling, `readEnv` (T6); construct, IAM, Function URL, log retention, output, disabled flag (T7); operator command and README (T8); deploy and manual verification including the schedule round trip (T9).
- Type consistency: `Aws`, `ScheduleSettings`, `InstanceStatus` defined in T6 `aws.ts` and consumed by `index.ts` and its tests; `PanelView`/`MESSAGES` from T5 used in T6; `Schedule.targetRole/stopScheduleArn/startScheduleArn` from T2 used in T7; `STOP_SCHEDULE_NAME`/`START_SCHEDULE_NAME` exported in T2, used in T7 and asserted in T7 tests.
- Placeholder scan: none.
