import type { Aws } from './aws';
import { decide, NO_TIMER, SleepDecision } from './sleep';
import { parseWorlds } from './worlds';

export const SLEEP_MESSAGE =
  'Nobody was online for an hour, so the hall is going dark. Start it from the panel when you want to play.';

export interface SleeperEnv {
  instanceId: string;
  serverHost: string;
  worlds: Array<{ name: string; queryPort: number }>;
  secretArn: string;
  sleepEnabledParameter: string;
  emptySinceParameter: string;
  idleMinutes: number;
}

export interface SleeperDeps {
  aws: Aws;
  env: SleeperEnv;
  queryPlayers(host: string, port: number): Promise<{ players: number } | null>;
  now(): number;
}

export function readSleeperEnv(source: NodeJS.ProcessEnv = process.env): SleeperEnv {
  const need = (name: string): string => {
    const value = source[name];
    if (!value) throw new Error(`missing environment variable ${name}`);
    return value;
  };
  return {
    instanceId: need('INSTANCE_ID'),
    serverHost: need('SERVER_HOST'),
    worlds: parseWorlds(need('WORLDS')).map((w) => ({ name: w.name, queryPort: w.queryPort })),
    secretArn: need('SECRET_ARN'),
    sleepEnabledParameter: need('SLEEP_ENABLED_PARAMETER'),
    emptySinceParameter: need('EMPTY_SINCE_PARAMETER'),
    idleMinutes: Number(need('SLEEP_IDLE_MINUTES')),
  };
}

export function createSleeper(deps: SleeperDeps): () => Promise<SleepDecision> {
  const { aws, env } = deps;
  return async () => {
    const [enabledValue, emptySince, instance] = await Promise.all([
      aws.getParameter(env.sleepEnabledParameter),
      aws.getParameter(env.emptySinceParameter),
      aws.describeInstance(env.instanceId),
    ]);
    const infos = instance.state === 'running' ? await Promise.all(env.worlds.map((w) => deps.queryPlayers(env.serverHost, w.queryPort))) : [];
    const players = instance.state !== 'running' ? null : infos.some((i) => i === null) ? null : infos.reduce((n, i) => n + (i?.players ?? 0), 0);
    const decision = decide({
      enabled: enabledValue === 'true',
      state: instance.state,
      players,
      emptySince,
      now: new Date(deps.now()),
      idleMinutes: env.idleMinutes,
    });

    if (decision.action === 'mark') await aws.putParameter(env.emptySinceParameter, decision.emptySince);
    if (decision.action === 'clear') await aws.putParameter(env.emptySinceParameter, NO_TIMER);
    if (decision.action === 'stop') {
      await aws.stopInstance(env.instanceId);
      await aws.putParameter(env.emptySinceParameter, NO_TIMER);
      const webhook = await aws.getWebhook(env.secretArn);
      if (webhook) {
        try {
          await aws.postDiscord(webhook, SLEEP_MESSAGE);
        } catch (error) {
          console.error('discord post failed', error);
        }
      }
    }
    console.log(JSON.stringify({ state: instance.state, players, enabled: enabledValue === 'true', emptySince, decision }));
    return decision;
  };
}
