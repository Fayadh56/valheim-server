# Control panel v3: player names and hall-style confirmations

Design spec, 2026-09-18. Builds on `2026-09-18-panel-v2-design.md`.

## Goal

Show who is online by character name, and replace the browser's confirm box with a dialog
that belongs to the page.

## Locked decisions

| Decision | Value |
|---|---|
| Source of names | The game container's log, followed on the instance by a small watcher service. Steam's query protocol carries only a count for Valheim. |
| Transport | The watcher writes `/valheim/panel/players` (SSM String parameter, JSON `{ "players": ["Fellesin", "Halo"], "updatedAt": "<ISO>" }`) on every change and as a heartbeat every 60 s. The panel Lambda reads it like the other parameters. No new ports, no tokens. |
| Staleness | If `updatedAt` is older than 3 minutes the panel treats names as unknown and shows the count only. |
| Watcher | `/usr/local/bin/valheim-players`, Python 3 standard library only, run by `valheim-players.service` (`Restart=always`, `RestartSec=5`). `docker logs -f valheim` gives history then live lines, so a restart rebuilds state from the log. |
| Log grammar | `Valheim version:` resets state. `Got connection SteamID <id>` queues the id. `Got character ZDOID from <Name> : ` names the oldest queued id (FIFO). `Closing socket <id>` removes the id. Respawns (a name for an id that already has one) change nothing. |
| Install | User data installs the watcher on new instances. The live instance gets it once through SSM Run Command via `scripts/install-watcher.ts`. Changing user data makes CloudFormation stop and start the instance once during the deploy (about 3 minutes of downtime); deploy when nobody is playing. |
| IAM | Instance role gains `ssm:PutParameter` on the players parameter. Panel Lambda gains read on it and env `PLAYERS_PARAMETER`. |
| Page | Under the status line, a names line: `Fellesin, Halo` (escaped, sorted case-insensitively). Hidden when names are unknown or nobody is on. Status payload gains `playerNames: string[] | null`. |
| Confirmations | Both Start and Stop open a `<dialog>` styled with the page tokens. Start: "Light the fires?" / "The hall takes about two minutes to warm up." / button "Light them" (moss). Stop: "Douse the fires?" / "2 vikings are online. The world saves first." (or "Nobody is online. The world saves first.") / button "Douse them" (ember). Second button "Not now". Escape and backdrop click close. Browsers without `dialog.showModal` fall back to `confirm()`. |
| Not in scope | Discord join/leave messages, Steam display names, player history, kick/ban. |

## Watcher behavior

`valheim-players <parameter-name> <region>`:

1. Start `docker logs -f valheim` (stdout and stderr merged). If it exits, exit too; systemd
   restarts the service and the full log replays into a fresh roster.
2. Feed every line to the roster. When the roster changes, publish.
3. A heartbeat thread publishes every 60 s regardless, refreshing `updatedAt`.
4. Publish runs `aws ssm put-parameter --name <p> --type String --overwrite --value <json>
   --region <r>`; failures are printed to stderr and ignored.
5. `--replay` mode reads log lines from stdin, applies them, prints the final JSON, and exits
   without calling AWS. Tests use it.

Parser pairing rule: connections queue in a FIFO; a character line names the head of the
queue. Two people joining within the same twenty seconds could swap names; acceptable.

## Panel changes

- `Env.playersParameter` from `PLAYERS_PARAMETER`.
- `view()` reads the parameter alongside the others, parses it, applies the 3 minute
  staleness rule against `nowIso`, and fills `playerNames`.
- `PanelView.playerNames?: string[]` (undefined means unknown). `buildStatus` maps it to
  `playerNames: string[] | null`.
- `renderPanel`: `<p id="names" class="names">` after `#sub`, hidden attribute when empty.
  Client `apply()` fills it from `playerNames` and toggles `hidden`.
- Dialog: `<dialog id="confirm">` with `#confirmTitle`, `#confirmBody`, `#confirmYes`,
  `#confirmNo`. Submitting `#actionForm` is intercepted; the dialog copy is chosen from the
  button's value and `data-players`; "Yes" submits the form for real.
- The old `confirm()` call is kept only as the no-`showModal` fallback.

## CDK changes

- `ServerInstance` creates `playersParameter` (`/valheim/panel/players`, initial
  `{"players":[],"updatedAt":"1970-01-01T00:00:00.000Z"}`) and grants the instance role write.
- `ControlPanel` gets `playersParameter` in props, grants the panel function read, sets
  `PLAYERS_PARAMETER`.
- `buildUserData` gains a step that writes the watcher script and unit and enables the
  service. The script and unit text live in `lib/players-watcher.ts` (script read from
  `server/valheim-players.py` at synth time).
- `scripts/install-watcher.ts` sends the same script and unit to the running instance with SSM
  `SendCommand` and waits for success.

## Testing

- `test/panel/players-watcher.test.ts`: runs `python3 server/valheim-players.py --replay` on
  captured log lines: join then leave, two joins pairing FIFO, respawn no change, version line
  reset, unknown lines ignored.
- `test/panel/html.test.ts`: names line present and hidden states, dialog markup and copy
  constants, fallback `confirm(` still present.
- `test/panel/index.test.ts`: `playerNames` from a fresh parameter, `null` when stale or
  malformed, `PLAYERS_PARAMETER` required.
- `test/panel/status.test.ts`: `playerNames` mapping.
- Stack: players parameter exists with the initial value, instance role has `ssm:PutParameter`
  on it, panel env has `PLAYERS_PARAMETER`, user data contains `valheim-players.service`.
- Post-deploy: run the installer, join the game, see your name on the page within a minute,
  leave, see it disappear; open both dialogs and cancel one.
