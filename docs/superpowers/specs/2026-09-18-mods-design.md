# Mods: pinned manifest, server sync, one profile code for friends

Design spec, 2026-09-18. Builds on `2026-09-18-panel-v3-design.md`.

## Goal

Run a fixed set of BepInEx mods on the server, keep every player on exactly the same versions
with one r2modman profile code, and make updating a one-line change plus three commands.

## Locked decisions

| Decision | Value |
|---|---|
| Mod loader | BepInEx through the image's `BEPINEX=true`. The image installs the latest `denikson-BepInExPack_Valheim` itself and re-merges it on game updates. |
| Source of truth | `config.mods` in `lib/config.ts`: `enabled`, `profileName: 'OsrsNerds'`, `packages: [{ namespace, name, version, clientOnly? }]`. Versions are exact `x.y.z`. Nothing on the server or in the profile comes from anywhere else. |
| Initial packages | denikson/BepInExPack_Valheim 5.4.2350 (clientOnly), ValheimModding/Jotunn 2.30.0, MidnightMods/NetworkPerformanceSystem 1.6.0, MidnightMods/ValheimCommunityPatch 0.28.0, momos3939/ForsakenPowerOverhaul 2.2.0, xtavim/BetterConsumables 1.1.0, Goldenrevolver/Quick_Stack_Store_Sort_Trash_Restock 1.4.15, sighsorry/InventorySlots 1.5.4. |
| Server transport | SSM String parameter `/valheim/mods/packages`: JSON array of the non-clientOnly packages. One SSM String parameter per file in `server/mods/config/` at `/valheim/mods/config/<filename>` (4096 byte limit each, checked at synth). |
| Server sync | `/usr/local/bin/valheim-mods` (Python 3 stdlib) runs from `valheim-fetch-config` on every `valheim.service` start. It installs each package into `/opt/valheim/config/bepinex/plugins/<Namespace-Name>/`, writes config overrides into `/opt/valheim/config/bepinex/`, and removes managed package folders that are no longer listed from both the config plugins folder and `/opt/valheim/data/bepinex/BepInEx/plugins/`. |
| Package layout rule | Thunderstore zips come in two shapes: files under `plugins/` (Jotunn, NPS, CommunityPatch) or at the zip root (the other four). Strip a leading `plugins/` or `BepInEx/plugins/`; skip `manifest.json`, `icon.png`, `README.md`, `CHANGELOG.md`, `LICENSE*`; keep everything else with its relative path (translations, `.yml`, `.pdb`, `.xml`). Reject entries with `..` or absolute paths. |
| Cache | Zips are kept at `/opt/valheim/mods-cache/<Namespace-Name>-<version>.zip` so restarts do not re-download. `.version` marker in each managed plugin folder records what is installed; only folders with a marker are ever removed. |
| Config overrides | Files in `server/mods/config/` are written verbatim over `/opt/valheim/config/bepinex/<filename>` at each start (that folder is what BepInEx sees as `BepInEx/config`, the image symlinks it). BepInEx fills in missing keys, so an override file can hold only the keys that differ. Ships empty; BetterConsumables values come later. |
| Friends | `npm run share-profile` builds an r2modman `.r2z` (zip with `export.r2x` YAML: `profileName`, `mods[] { name: 'Namespace-Name', version: { major, minor, patch }, enabled: true }`, all packages including clientOnly), uploads it as `#r2modman\n<base64>` to `https://thunderstore.io/api/experimental/legacyprofile/create/`, prints the returned key, writes it to SSM `/valheim/panel/profile-code`, and posts join instructions to Discord unless `--no-discord`. |
| Panel | New "Mods" section under Getting in: which mods everyone runs, the current profile code with a Copy button, and the four r2modman steps. Hidden when the packages parameter lists nothing. Shows "Profile code coming soon" while the code parameter is `none`. |
| Live instance | New instances get the scripts from user data. The live one gets them with `npm run install-scripts`, which pushes the watcher, `valheim-fetch-config` and `valheim-mods` over SSM Run Command (replaces `install-watcher`). Changing user data stops and starts the instance once during the deploy; deploy when nobody is playing. |
| Release flow | Bump `config.mods`, `npm run deploy`, `npm run server -- restart`, `npm run share-profile`. |
| Rollback | `mods.enabled: false`, deploy, restart: the image runs vanilla and the sync removes managed plugins. |
| Not in scope | Mod config editing from the panel, Valheim+, automatic version bumps, client-side config in the profile, kick or ban tools. |

## Behavior

### Server start

`valheim.service` `ExecStartPre=/usr/local/bin/valheim-fetch-config` now:

1. Fetches the compose file and secret (unchanged).
2. Fetches `/valheim/mods/packages` to `/opt/valheim/mods.json` and the config parameters under
   `/valheim/mods/config/` to `/opt/valheim/mods-config.json` (`aws ssm get-parameters-by-path`).
3. Runs `valheim-mods sync /opt/valheim/mods.json /opt/valheim/mods-config.json`.
4. `docker compose up -d` starts the container; the image rsyncs `/config/bepinex/plugins/` into the
   BepInEx install and loads the plugins.

`valheim-mods` exits non-zero only on a malformed manifest. A failed download logs a warning and
keeps whatever version is already installed, so a Thunderstore outage never blocks a server start.
Files are chowned to 1000:1000, the container user.

### Sharing

`npm run share-profile [--no-discord]`:

1. Builds the `.r2z` from `config.mods` (pure function, tested).
2. Uploads it, gets the key.
3. `aws ssm put-parameter --name /valheim/panel/profile-code --value <key> --overwrite`.
4. Posts to the Discord webhook (read from the secret with the CLI): what changed is not tracked;
   the post always carries the current code, the panel URL and the four steps.
5. Prints the code.

Thunderstore rate-limits the endpoint (429); the script reports that plainly and exits 1.

### Panel

`PanelView.mods?: { names: string[]; profileCode: string | null }`, undefined when the packages
parameter lists nothing. `index.ts` reads `MODS_PARAMETER` (`/valheim/mods/packages`; `lambda/panel/mods.ts`
turns it into display names: the package name with underscores as spaces; clientOnly packages are
not in this parameter so BepInExPack never shows) and `PROFILE_CODE_PARAMETER`
(`/valheim/panel/profile-code`, `none` means null). Both are read in the same `Promise.all` as the
other parameters. Status JSON is unchanged; the section is static per load.

## CDK changes

- `lib/config.ts`: `ModsConfig`, `ModPackage`; `validateConfig` checks `version` is `x.y.z`, namespace
  and name are `[A-Za-z0-9_]+`, `Namespace-Name` is unique, and `profileName` is non-empty when enabled.
- `lib/mods.ts`: `serverPackages(mods)`, `packagesJson(mods)`, `readConfigOverrides(dir)` (throws
  when a file exceeds 4096 bytes), `MODS_PARAMETER_NAME`, `MODS_CONFIG_PATH`,
  `PROFILE_CODE_PARAMETER_NAME`, `MODS_CONFIG_DIR`.
- `lib/profile.ts`: `buildExportYaml(mods)`, `buildProfileUpload(mods)` (fflate zip, returns the
  `#r2modman` body), `modDisplayNames(packages)`, `joinInstructions(code, panelUrl, names)`,
  `PROFILE_UPLOAD_URL`.
- `lib/server-settings.ts`: `modsParameter`, `modConfigParameters[]`, `profileCodeParameter`
  (initial `none`).
- `lib/compose.ts`: `BEPINEX: 'true'` when `mods.enabled`.
- `lib/instance-scripts.ts`: `fetchConfigScript(o)` (moved out of `user-data.ts`, extended with the
  mods steps), `modsSyncScript` (read from `server/valheim-mods.py`), `installScripts(o)` shell that
  writes all instance scripts and the watcher unit; `user-data.ts` and `scripts/install-scripts.ts`
  both use it. `lib/players-watcher.ts` keeps the watcher pieces and `installScripts` calls into it.
- `lib/server-instance.ts`: instance role gets read on the mods, config and (existing) compose
  parameters, plus `ssm:GetParametersByPath` on the config path.
- `lib/control-panel.ts`: panel reads `modsParameter` and `profileCodeParameter`; env
  `MODS_PARAMETER`, `PROFILE_CODE_PARAMETER`.
- `package.json`: `share-profile`, `install-scripts` (replaces `install-watcher`); dev dependency
  `fflate`.

## Testing

- `test/config.test.ts`: every new validator branch.
- `test/mods.test.ts`: JSON shape, display names, override size check.
- `test/profile.test.ts`: YAML has every package with split version numbers and `enabled: true`;
  the zip contains exactly `export.r2x`; the upload body starts with `#r2modman\n`.
- `test/panel/mods-sync.test.ts`: runs `python3 server/valheim-mods.py sync` against temp dirs with
  `--zips <dir>` (offline mode reads `<Namespace-Name>-<version>.zip` from that dir instead of
  downloading): installs a `plugins/`-shaped and a root-shaped zip, keeps translations, skips the
  metadata files, writes `.version`, upgrades on version change, prunes an unlisted managed folder from
  both plugin roots, leaves an unmanaged folder alone, writes overrides, rejects a zip-slip entry.
- `test/user-data.test.ts`, `test/stack.test.ts`: fetch-config contains the mods steps,
  `valheim-mods` is installed, compose has `BEPINEX: "true"`, the three parameter kinds exist with the
  right values, instance role reads them, panel env and grants, still exactly two `"Resource":"*"`.
  Snapshot refreshed in the main tree.
- `test/panel/html.test.ts`, `index.test.ts`: Mods section present with names, code and Copy button;
  "coming soon" state; hidden when disabled; parameter reads.
- Post-deploy: restart, `docker logs valheim` shows BepInEx loading the six plugins, Fayadh joins
  with the profile, `nps_stats` works in console, panel shows the code, Discord post is readable.
