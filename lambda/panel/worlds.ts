export interface WorldEnv { name: string; port: number; queryPort: number; playersParameter: string }

export function parseWorlds(raw: string): WorldEnv[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('WORLDS is not valid JSON'); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('WORLDS must list at least one world');
  return parsed.map((w) => {
    const v = w as Partial<WorldEnv>;
    if (typeof v.name !== 'string' || typeof v.port !== 'number' || typeof v.queryPort !== 'number' || typeof v.playersParameter !== 'string') throw new Error('WORLDS entries need name, port, queryPort and playersParameter');
    return { name: v.name, port: v.port, queryPort: v.queryPort, playersParameter: v.playersParameter };
  });
}
