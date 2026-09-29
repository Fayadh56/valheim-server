import { WorldConfig } from './config';

export const MOUNT_POINT = '/opt/valheim';
export const PRIMARY_PLAYERS_PARAMETER = '/valheim/panel/players';

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The first world keeps the names and folders the single-world setup used, so nothing on disk moves
export function containerName(index: number, world: WorldConfig): string {
  return index === 0 ? 'valheim' : `valheim-${slugify(world.name)}`;
}

export function worldPaths(index: number, world: WorldConfig): { config: string; data: string } {
  const root = index === 0 ? MOUNT_POINT : `${MOUNT_POINT}/worlds/${slugify(world.name)}`;
  return { config: `${root}/config`, data: `${root}/data` };
}

export function playersParameterName(index: number, world: WorldConfig): string {
  return index === 0 ? PRIMARY_PLAYERS_PARAMETER : `${PRIMARY_PLAYERS_PARAMETER}-${slugify(world.name)}`;
}

export function worldsEnv(worlds: WorldConfig[]): string {
  return JSON.stringify(worlds.map((w, i) => ({ name: w.name, port: w.port, queryPort: w.port + 1, playersParameter: playersParameterName(i, w) })));
}
