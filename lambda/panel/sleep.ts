export const NO_TIMER = 'none';

export interface SleepInput {
  enabled: boolean;
  state: string;
  players: number | null;
  emptySince: string | null;
  now: Date;
  idleMinutes: number;
}

export type SleepDecision =
  | { action: 'none' }
  | { action: 'clear' }
  | { action: 'mark'; emptySince: string }
  | { action: 'stop' };

export function decide(input: SleepInput): SleepDecision {
  const timer = parseTimer(input.emptySince);
  if (input.state !== 'running') return timer ? { action: 'clear' } : { action: 'none' };
  if (input.players === null) return { action: 'none' };
  if (input.players > 0) return timer ? { action: 'clear' } : { action: 'none' };
  if (!timer) return { action: 'mark', emptySince: input.now.toISOString() };
  const idleMs = input.now.getTime() - timer.getTime();
  return input.enabled && idleMs >= input.idleMinutes * 60_000 ? { action: 'stop' } : { action: 'none' };
}

export function minutesIdle(emptySince: string | null, now: Date): number | null {
  const timer = parseTimer(emptySince);
  return timer ? Math.max(0, Math.floor((now.getTime() - timer.getTime()) / 60_000)) : null;
}

function parseTimer(value: string | null): Date | null {
  if (!value || value === NO_TIMER) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
