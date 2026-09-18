export const PLAYERS_STALE_MS = 3 * 60_000;

export function parsePlayers(raw: string, now: Date): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const { players, updatedAt } = parsed as { players?: unknown; updatedAt?: unknown };
  if (!Array.isArray(players) || !players.every((p) => typeof p === 'string')) return undefined;
  const written = typeof updatedAt === 'string' ? new Date(updatedAt).getTime() : NaN;
  if (Number.isNaN(written) || now.getTime() - written >= PLAYERS_STALE_MS) return undefined;
  return players;
}
