# Valheim control panel

Design spec, 2026-09-18. Adds a password-protected web page so friends can see server
status, start and stop the server, and edit the nightly schedule. Extends the stack in
`docs/superpowers/specs/2026-09-17-valheim-server-aws-design.md`.

## Goal

A single URL friends can bookmark. Enter the server password once, then see whether the
server is up, how many players are on, the connect string, and the schedule. Start, Stop,
and Save schedule buttons. Nothing else.

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| Auth | Shared password, the existing server password from Secrets Manager | Friends already have it. One thing to share. Changing it logs everyone out. |
| Hosting | One Lambda (Node.js 22, TypeScript, esbuild bundle) behind a Lambda Function URL, auth type NONE | Zero infrastructure beyond the function. Free tier. |
| Player count | Steam A2S_INFO query from the Lambda to `<EIP>:2457` | Requires `SERVER_PUBLIC=true`. User accepted the server being listed. |
| Schedules | The two EventBridge schedules always exist, named `valheim-stop` and `valheim-start`, state from `config.schedule.enabled` | The page toggles state and times at runtime with `UpdateSchedule`. |
| Config drift | `config.schedule` values are initial defaults only | CloudFormation only rewrites the schedules when the template changes them. README says so. |
| Feature flag | `config.panel.enabled` (default true) | Zero resources when false. |
| Toolchain | Same repo, same Jest setup; Lambda code under `lambda/panel/`, tests under `test/panel/` | Follow existing patterns. |

## Architecture

**New construct `ControlPanel`** (`lib/control-panel.ts`), created by the stack when
`config.panel.enabled`:

- `lambda_nodejs.NodejsFunction`: entry `lambda/panel/index.ts`, runtime
  `NODEJS_22_X`, `architecture: ARM_64`, memory 256 MB, timeout 10 s,
  `bundling: { externalModules: ['@aws-sdk/*'], minify: true, sourceMap: false }`.
  Environment: `INSTANCE_ID`, `SERVER_HOST` (the EIP), `GAME_PORT` (2456),
  `QUERY_PORT` (2457), `SECRET_ARN`, `STOP_SCHEDULE_NAME`, `START_SCHEDULE_NAME`,
  `TIMEZONE`, `SERVER_NAME`.
- `fn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE })`. Output `PanelUrl`.
- IAM on the function role, least privilege:
  - `ec2:DescribeInstances` on `*` (the API does not support resource scoping)
  - `ec2:StartInstances`, `ec2:StopInstances` on the instance ARN
  - `scheduler:GetSchedule`, `scheduler:UpdateSchedule` on the two schedule ARNs
    (`arn:aws:scheduler:<region>:<account>:schedule/default/valheim-stop` and `.../valheim-start`)
  - `iam:PassRole` on the scheduler target role, required by `UpdateSchedule` because the
    target's `RoleArn` is passed back
  - `secretsmanager:GetSecretValue` on the secret (via `secret.grantRead`)
- Log retention 14 days on the function's log group.

**Schedule construct changes** (`lib/schedule.ts`): always instantiated by the stack. Props
gain nothing; the construct sets `scheduleName: 'valheim-stop'` / `'valheim-start'`,
`enabled: props.schedule.enabled`, and exposes `readonly stopScheduleArn`,
`readonly startScheduleArn`, `readonly targetRole: iam.IRole` (the role the `Universal`
targets use; create one shared `iam.Role` for `scheduler.amazonaws.com` and pass it as
`role` to both targets so the Lambda can `PassRole` a single ARN).

**Compose change** (`lib/compose.ts`): `SERVER_PUBLIC: 'true'`. Test updated.

**Config change** (`lib/config.ts`): `panel: { enabled: boolean }`, default `{ enabled: true }`.

## Lambda modules (`lambda/panel/`)

Each file has one job and no AWS SDK import except `aws.ts`.

| File | Responsibility |
|---|---|
| `index.ts` | Handler: route by method and path, read cookie, call `aws.ts` and pure modules, return HTML or a 303 redirect. |
| `auth.ts` | `signCookie(password, expiresAt): string`, `verifyCookie(password, cookie): boolean`. HMAC-SHA256 over `expiresAt`; cookie value `expiresAt.hexsig`. Constant-time compare. |
| `a2s.ts` | `queryInfo(host, port, timeoutMs): Promise<{ players: number; maxPlayers: number; name: string } | null>`. Implements A2S_INFO with the challenge handshake over `dgram`. `parseInfo(buffer)` exported separately for tests. Returns `null` on timeout. |
| `schedule.ts` | `cronToTime(expr): string` (`cron(0 3 * * ? *)` to `03:00`), `timeToCron(hhmm): string`, `validateTime(hhmm): boolean`. |
| `html.ts` | `renderLogin(error?)`, `renderPanel(view: PanelView)`. Inline CSS, no external assets, works on a phone. `PanelView` is a plain object (state, since, players, maxPlayers, connectString, steamString, schedule {enabled, stopAt, startAt}, timezone, message?). |
| `aws.ts` | Thin wrappers: `describeInstance`, `startInstance`, `stopInstance`, `getSchedules`, `updateSchedules`, `getServerPassword`. Only file that imports `@aws-sdk/*`. |

### Routes

| Method, path | Behavior |
|---|---|
| `GET /` | No valid cookie: 200 login page. Valid cookie: 200 panel page (state, players via A2S when running, schedules). Page has `<meta http-equiv="refresh" content="30">`. |
| `POST /login` | Form field `password`. Wrong: sleep 1000 ms, 200 login page with error. Right: set cookie (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`), 303 to `/`. |
| `POST /action` | Requires cookie and same-origin check. Field `action` = `start` or `stop`. Already in that state: 303 to `/?msg=already-running` or `already-stopped`. Otherwise call EC2 and 303 to `/?msg=starting` or `stopping`. |
| `POST /schedule` | Requires cookie and same-origin. Fields `enabled` (checkbox), `stopAt`, `startAt` (HH:MM). Validate; on error 303 to `/?msg=bad-time`. Else `UpdateSchedule` on both schedules (state, cron, timezone unchanged, target and window copied from `GetSchedule`) and 303 to `/?msg=schedule-saved`. |
| `POST /logout` | Clear cookie, 303 to `/`. |
| anything else | 404 plain text. |

Same-origin check: `Origin` header (or `Referer` host) must equal the request `Host`.
Messages are rendered from a fixed map keyed by `msg`; unknown keys render nothing.

### Page content (panel)

- Header: server name.
- Status card: `Running since <local time>` with a green dot, or `Stopped` with a grey dot.
  When running: `Players: N / M` (M from A2S; `unknown` if the query timed out, which is
  normal for the first minute after boot).
- Connect card: Join IP string, Steam favorites string, each with a Copy button.
- Buttons: Start (disabled when running), Stop (disabled when stopped; when players > 0 a
  confirm dialog says how many are online).
- Schedule card: checkbox Enabled, two `<input type="time">` for stop and start, the
  timezone name, Save button. Note under it: `The server stops at the stop time and starts
  at the start time every day when enabled.`
- Footer: `Updated <time>`, Logout button.

## Error handling

- A2S timeout: show `Players: unknown`, never fail the page.
- EC2 or Scheduler API error: 303 to `/?msg=error` and log the error; the page shows
  `Something went wrong, try again`.
- Secret fetch failure: 500 plain text (nothing else works without it). Cache the password
  in module scope for 5 minutes to keep cold and warm paths fast.
- Missing environment variables: throw at cold start with the variable name.

## Testing

Unit (`test/panel/`):
- `auth.test.ts`: sign then verify passes; wrong password fails; expired fails; tampered fails.
- `a2s.test.ts`: `parseInfo` on a captured A2S_INFO response buffer returns the right
  players/maxPlayers/name; challenge packet is recognized.
- `schedule.test.ts`: `cronToTime('cron(0 3 * * ? *)')` is `03:00`; `timeToCron('16:05')` is
  `cron(5 16 * * ? *)`; `validateTime` rejects `9:00` and `24:00`.
- `html.test.ts`: `renderPanel` shows the state, player count, both connect strings, the
  schedule values, and the Stop button disabled when stopped; `renderLogin` shows the error.
- `index.test.ts`: handler with a fake `aws.ts` (dependency injected through a
  `createHandler(deps)` factory): unauthenticated GET returns login; wrong password waits
  and returns login with error; correct login sets cookie and redirects; `POST /action`
  without the same-origin header is rejected with 403; `start` when stopped calls
  `startInstance` once and redirects with `msg=starting`.

Stack (`test/stack.test.ts`, appended):
- `AWS::Lambda::Function` count 1 with `Runtime: nodejs22.x`, `Architectures: ['arm64']`.
- `AWS::Lambda::Url` count 1 with `AuthType: NONE`.
- Function role policy contains `ec2:StartInstances` and `ec2:StopInstances` scoped to the
  instance ARN, `scheduler:UpdateSchedule` scoped to the two schedule ARNs, and no
  `"Resource":"*"` except for `ec2:DescribeInstances`.
- Two `AWS::Scheduler::Schedule` always; `State: DISABLED` with the default config,
  `ENABLED` when `schedule.enabled` is overridden to true; names `valheim-stop` and
  `valheim-start`.
  The existing test `creates nothing when disabled` is replaced by this one.
- Compose parameter value contains `SERVER_PUBLIC: "true"`.
- `panel.enabled: false` produces zero Lambda resources.
- Snapshot updated.

Tests skip Lambda bundling: `test/helpers.ts` sets context
`aws:cdk:bundling-stacks` to `[]` so `Template.fromStack` does not run esbuild.

Post-deploy, by hand: open `PanelUrl`, log in, see `Running since`, join the game and see
`Players: 1 / 10` within 30 s, press Stop (confirm), watch the state flip, press Start,
change the schedule and confirm the two schedules in the EventBridge console show the new
times and state.

## Operator changes

- `npm run server -- panel` prints `PanelUrl`.
- README: a `Control panel` section (URL, password is the server password, what the
  buttons do, schedule edits are live and survive deploys unless `config.schedule` changes),
  and the Joining section notes the server now appears in the public browser under its name.
- New dev dependencies: `esbuild`, `@aws-sdk/client-ec2`, `@aws-sdk/client-scheduler`,
  `@aws-sdk/client-secrets-manager`, `@types/aws-lambda`.

## Out of scope

Per-user accounts, action history, Discord commands, custom domain, rate limiting beyond
the one-second wrong-password delay, showing player names.
