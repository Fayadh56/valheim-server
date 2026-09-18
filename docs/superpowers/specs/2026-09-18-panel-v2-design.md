# Control panel v2: redesign, live status, sleep when empty, home screen

Design spec, 2026-09-18. Builds on `2026-09-18-control-panel-design.md`.

## Goal

Make the page feel like the mead hall it controls, answer "is it up, who's on, how do I get
in" before the reader finishes a sentence, keep it fresh without reloading, install on a
phone like an app, and stop paying for an empty server.

## Locked decisions

| Decision | Value |
|---|---|
| Theme | Dark only (pine night), `color-scheme: dark`. No light variant, no toggle. |
| Palette | Pine night `#14201B`, Birch `#E9DFC7`, Bronze `#B8863B`, Mist `#8FA39A`, Moss `#6A9C65`, Ember `#A63A26`. Moss and Ember are the filled-button colors and were tuned so their button text clears 4.5:1. |
| Type | One family, system Palatino lineage: `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`. No web fonts, no external requests. |
| Hero | Inline SVG longhouse. Windows and door glow Bronze when running, dark when stopped; a soft radial glow behind the roof when running. Transition 600 ms on state change, none under `prefers-reduced-motion`. |
| Status copy | running "The hall is open"; stopped "The hall is dark"; pending "Lighting the fires"; stopping "Dousing the fires"; unknown "Checking the hall". Sub-line: `N vikings online, since <time>` (1 viking, 0 "Nobody online yet", unknown count "Counting heads"). |
| Live refresh | `GET /status.json` every 15 s from the page; DOM updated in place; form inputs never touched. No page reload, no meta refresh. |
| Sleep when empty | Every 10 minutes a second Lambda checks the server. If it has had zero players for 60 minutes and the feature is on, it stops the instance and posts one Discord line. Setting and idle timer live in two SSM parameters. Off by default; friends turn it on from the page. |
| Home screen | `GET /manifest.webmanifest`, `GET /icon.svg`, `GET /icon-180.png` (pre-rendered, base64 constant), plus the head tags Safari and Chrome need. Public routes. |
| Not in scope | World map link, Discord commands, player names, backups UI, per-user accounts. |

## Page

One column, left aligned, max width 30rem, 1.25rem side padding. Sections separated by
space; one Bronze hairline under the hero only. No cards, no dividers elsewhere, no
numbered markers, no tracked labels.

```
valheim-osrs-nerds                                  Log out

              [ longhouse SVG ]

The hall is open                          (2.25rem, Bronze)
3 vikings online, since 8:02 pm           (Mist)

[ Stop the server ]                       (Ember when running; "Start the server" in Moss when stopped;
                                           disabled "Hold on" while pending or stopping)

Getting in                                (1.25rem, Birch)
Join IP           100.29.76.244:2456   Copy
Steam browser     100.29.76.244:2457   Copy
Password is the one you were given.

Night watch
( ) Always on
(•) Sleeps at [03:00] and wakes at [16:00]
[x] Sleep when nobody's online for an hour
    Nobody online for 23 minutes, sleeps in 37.   (only when running, empty, and the box is checked)
[ Save ]

Updated 8:05 pm
```

Details:
- Copy buttons write to the clipboard and read "Copied" for 1.5 s, then revert.
- Stop asks for confirmation only when players > 0: "3 vikings are online. Stop anyway?"
- After a POST, the page redirects to `/` with a message rendered in a Mist line under the
  hero, from the fixed `MESSAGES` map (the same seven keys as v1; the schedule save covers the sleep setting).
- Focus rings are Bronze, 2 px, offset 2 px. Buttons are 44 px tall on touch.
- Errors and empty states are sentences that say what to do. When a status poll fails the page
  shows "Couldn't reach the server status. It usually comes back on its own; try again in a
  minute." under the status line, and hides it again on the next success.

## Routes (Lambda `panel`)

| Route | Auth | Behavior |
|---|---|---|
| `GET /` | cookie | Login or panel page, as before. |
| `GET /status.json` | cookie (401 JSON otherwise) | `{ state, since, players, maxPlayers, schedule: { enabled, stopAt, startAt }, sleepWhenEmpty: { enabled, emptySince, idleMinutes }, updatedAt }`. `emptySince` is an ISO string or null; other times are ISO strings; the page formats them in the server timezone passed in the initial HTML. `cache-control: no-store`. |
| `POST /login`, `/action`, `/logout` | as before | unchanged |
| `POST /schedule` | cookie + same origin | Fields `mode` (`always` or `nightly`), `stopAt`, `startAt`, `sleepWhenEmpty` (checkbox). Updates both EventBridge schedules (state from `mode`) and writes the sleep parameter. Redirect `/?msg=schedule-saved`. |
| `GET /manifest.webmanifest` | none | JSON manifest: name "Valheim server", short_name "Valheim", start_url "/", display "standalone", background_color `#14201B`, theme_color `#14201B`, icons `/icon.svg` (any, maskable) and `/icon-180.png`. `content-type: application/manifest+json`. |
| `GET /icon.svg` | none | The longhouse mark, 512 viewBox, Bronze on Pine night. `cache-control: public, max-age=86400`. |
| `GET /icon-180.png` | none | Base64 constant from `lambda/panel/icon.ts`, rendered once from the SVG by `scripts/render-icon.sh` (macOS `qlmanage`). Same caching. |

Head tags on every HTML page: `<meta name="theme-color" content="#14201B">`,
`<link rel="manifest" href="/manifest.webmanifest">`, `<link rel="apple-touch-icon" href="/icon-180.png">`,
`<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="mobile-web-app-capable" content="yes">`,
`<link rel="icon" href="/icon.svg" type="image/svg+xml">`.

## Sleep when empty (Lambda `sleeper`)

- Entry `lambda/panel/sleeper.ts`, handler `handler`, same bundle settings as the panel Lambda,
  timeout 30 s, memory 256 MB. Triggered by an EventBridge Scheduler rate schedule named
  `valheim-sleep-check`, `rate(10 minutes)`, always enabled.
- Pure decision function in `lambda/panel/sleep.ts`:
  ```ts
  export interface SleepInput { enabled: boolean; state: string; players: number | null; emptySince: string | null; now: Date; idleMinutes: number }
  export type SleepDecision = { action: 'clear' } | { action: 'mark', emptySince: string } | { action: 'stop' } | { action: 'none' }
  export function decide(input: SleepInput): SleepDecision
  ```
  Rules, checked in this order (`emptySince` is the stored timer, `none` when unset):
  1. State is not `running`: `clear` if a timer is set, else `none`. A stopped or booting box never accumulates idle time.
  2. Running and `players` is null (query failed or the game is still loading): `none`. Keep whatever timer exists; never stop on a failed query.
  3. Running and `players > 0`: `clear` if a timer is set, else `none`.
  4. Running and `players === 0` with no timer: `mark` with `now`.
  5. Running and `players === 0` with a timer: `stop` if `enabled` and `now - emptySince >= idleMinutes`, else `none`.
- Handler: read the two parameters, describe the instance, query A2S when running, `decide`,
  apply: `mark` writes the ISO timestamp; `clear` writes `none`; `stop` calls
  `StopInstances`, writes `none`, and posts to Discord:
  "Nobody was online for an hour, so the hall is going dark. Start it from the panel when
  you want to play." Logs the decision as one JSON line.
- Parameters (CDK `ssm.StringParameter`): `/valheim/panel/sleep-when-empty` initial `false` (from `config.panel.sleepWhenEmpty.enabledByDefault`),
  `/valheim/panel/empty-since` initial `none` (SSM rejects empty values). Runtime writes survive
  deploys unless the initial values in config change. No retain policy; they are cheap to recreate.
- IAM (sleeper role): `ec2:DescribeInstances` on `*`, `ec2:StopInstances` on the instance ARN,
  `ssm:GetParameter`/`PutParameter` on the two parameter ARNs, secret read.
- IAM (panel role adds): `ssm:GetParameter`/`PutParameter` on the two parameter ARNs.
- Config: `panel: { enabled: true, sleepWhenEmpty: { enabledByDefault: false, idleMinutes: 60, checkEveryMinutes: 10 } }`.

## Modules

| File | Change |
|---|---|
| `lambda/panel/html.ts` | Rewrite: tokens, longhouse SVG, new copy, status JSON hydration script, manifest tags, Night watch form with `mode` radios and sleep checkbox. Exports `renderLogin`, `renderPanel`, `renderIconSvg`, `MESSAGES`, `PanelView` (fields: as before plus `sleepWhenEmpty: { enabled, emptySince: string | null, idleMinutes }`, `sinceIso`, `nowIso`). |
| `lambda/panel/icon.ts` | `export const ICON_180_PNG_BASE64: string`. Generated file, committed. |
| `lambda/panel/status.ts` | Pure: `buildStatus(view)` shape for `/status.json`, shared by the initial render and the JSON route so they can never drift. |
| `lambda/panel/sleep.ts` | Pure `decide`. |
| `lambda/panel/sleeper.ts` | Sleeper handler with `createSleeper(deps)` factory; `deps` adds `getParameter`, `putParameter`, `postDiscord`. |
| `lambda/panel/aws.ts` | Add `getParameter(name)`, `putParameter(name, value)`, `postDiscord(webhook, content)` (uses `fetch`, Node 22 built in). Secret read gains `getWebhook`. |
| `lambda/panel/index.ts` | New routes, `mode` radio handling, sleep setting read/write, status JSON. |
| `lib/control-panel.ts` | Second `NodejsFunction` (sleeper), rate schedule via `scheduler.Schedule` + `targets.LambdaInvoke`, two parameters, IAM additions. |
| `lib/config.ts` | `panel.sleepWhenEmpty`. |
| `scripts/render-icon.sh` | Renders `lambda/panel/icon.svg` (written by a small tsx script from `renderIconSvg`) to a 180 px PNG with `qlmanage` and writes `lambda/panel/icon.ts`. Run manually when the icon changes. |
| `README.md` | Night watch and sleep-when-empty paragraph, home screen line. |

## Testing

- `html.test.ts`: state copy for all five states, windows `lit` class only when running,
  manifest tags present, no meta refresh, no light-mode styles or toggle, copy buttons,
  `mode` radios reflect enabled, sleep checkbox reflects setting, countdown line only when
  running and empty and enabled, escaping.
- `status.test.ts`: `buildStatus` shape and null handling.
- `sleep.test.ts`: every numbered rule of `decide`, including "null players keeps the timer"
  and the boundary at exactly `idleMinutes`.
- `sleeper.test.ts`: fake deps; verifies parameter writes, `StopInstances` once, Discord post
  content, and no stop when the setting is off.
- `index.test.ts`: `/status.json` 401 without cookie and JSON with; `/manifest.webmanifest`
  and icons public with correct content types; `/schedule` with `mode=always` disables both
  schedules; `sleepWhenEmpty` absent writes `"false"`.
- Stack: two Lambdas, sleeper has 30 s timeout, `valheim-sleep-check` schedule with
  `rate(10 minutes)` and a Lambda target, two `AWS::SSM::Parameter` with the initial values,
  sleeper policy scoped as listed, panel policy gains the parameter statements, still exactly
  two `"Resource":"*"` statements (both `ec2:DescribeInstances`). Snapshot refreshed.
- Post-deploy: open the page on a phone and a laptop, install to home screen,
  see the longhouse light up after a Start, watch the countdown appear with nobody online,
  set idle to a small value in config only if a fast live test is wanted (not by default).

## Visual quality floor

Responsive to 320 px, visible focus, reduced motion honored, contrast at least 4.5:1 for
body text (Birch on Pine night is 12:1; Mist on Pine night is 6.2:1; Bronze on Pine night is
6.8:1; Birch on Ember is 4.9:1; Pine on Moss is 5.2:1), no horizontal scroll, every button at
least 44 px tall including Copy and Log out, time inputs carry aria-labels, the status heading
is aria-live.
