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
  };
}
