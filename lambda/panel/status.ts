import { InstanceState, PanelView, ScheduleView, SleepView } from './html';

export interface StatusPayload {
  state: InstanceState;
  since: string | null;
  players: number | null;
  maxPlayers: number | null;
  schedule: ScheduleView;
  sleepWhenEmpty: SleepView;
  playerNames: string[] | null;
  updatedAt: string;
  worlds: Array<{ name: string; players: number | null; maxPlayers: number | null; playerNames: string[] | null; connectString: string; steamString: string }>;
}

export function buildStatus(view: PanelView): StatusPayload {
  return {
    state: view.state,
    since: view.sinceIso ?? null,
    players: view.players ?? null,
    maxPlayers: view.maxPlayers ?? null,
    schedule: view.schedule,
    sleepWhenEmpty: view.sleepWhenEmpty,
    playerNames: view.playerNames ?? null,
    updatedAt: view.nowIso,
    worlds: view.worlds.map((w) => ({
      name: w.name,
      players: w.players ?? null,
      maxPlayers: w.maxPlayers ?? null,
      playerNames: w.playerNames ?? null,
      connectString: w.connectString,
      steamString: w.steamString,
    })),
  };
}
