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
npm run server -- panel    # web page for friends
```
Commit `cdk.context.json` after the first deploy. It pins the Ubuntu AMI.

## Day to day

| Task | Command |
|---|---|
| Is it up | `npm run server -- status` and `npm run server -- logs 50` |
| Panel URL | `npm run server -- panel` |
| Start / stop | `npm run server -- start` / `npm run server -- stop` (stop saves the world first) |
| Shell on the box | `npm run server -- shell` |
| Change a setting | edit `lib/config.ts`, `npm run deploy`, `npm run server -- restart` |
| Bump the image | change `imageTag` in `lib/config.ts`, same as above |
| Resize | change `instanceType`, `npm run deploy` (about 10 min downtime) |
| Nightly schedule | set `schedule.enabled: true`, `npm run deploy` |
| Discord alerts | `npm run server -- set-webhook <url>` then `npm run server -- restart` |

## Joining

In game: Start Game, Join Game, Join IP, paste the Join IP string, enter the password.
Steam server browser: View, Game Servers, Favorites, add the Steam favorites string.
The server is listed in the in-game server browser under its name, so friends can also
find it there.

## Control panel

`npm run server -- panel` prints the URL. Friends log in with the server password (cookie
lasts 30 days). The page shows running or stopped, players online, the connect strings,
and the nightly schedule. Start and Stop act immediately; Stop asks for confirmation when
players are on. Schedule edits are live and survive deploys unless `schedule` in
`lib/config.ts` changes, in which case the next deploy resets them to those values.

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
