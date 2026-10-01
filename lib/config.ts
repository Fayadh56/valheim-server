export interface ScheduleConfig {
  enabled: boolean;
  stopAt: string;
  startAt: string;
}

export interface SleepWhenEmptyConfig {
  enabledByDefault: boolean;
  idleMinutes: number;
  checkEveryMinutes: number;
}

export interface PanelConfig {
  enabled: boolean;
  sleepWhenEmpty: SleepWhenEmptyConfig;
}

export interface ModPackage {
  namespace: string;
  name: string;
  version: string;
  // The image installs BepInEx itself, so the pack only goes into the players' profile
  clientOnly?: boolean;
  // Runs on the server alone and stays out of the players' profile
  serverOnly?: boolean;
}

export interface ModsConfig {
  enabled: boolean;
  profileName: string;
  packages: ModPackage[];
}

export interface WorldConfig {
  name: string;
  port: number;
  // false keeps the save, folders and port reservation but runs nothing for the world
  enabled?: boolean;
}

export const WORLD_PORT_MIN = 2456;
export const WORLD_PORT_MAX = 2470;

export const DEATH_PENALTIES = ['casual', 'veryeasy', 'easy', 'hard', 'hardcore'] as const;

// Vanilla world modifiers passed at every launch; the game also stores them in the world file
export interface WorldModifiers {
  deathPenalty?: (typeof DEATH_PENALTIES)[number];
}

export interface ServerConfig {
  account: string;
  region: string;
  az: string;
  instanceType: string;
  serverName: string;
  worlds: WorldConfig[];
  adminSteamIds: string[];
  alertEmail: string;
  budgetUsd: number;
  imageTag: string;
  saveIntervalSeconds: number;
  worldModifiers: WorldModifiers;
  timezone: string;
  schedule: ScheduleConfig;
  discordNotifications: boolean;
  panel: PanelConfig;
  mods: ModsConfig;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateConfig(c: ServerConfig): ServerConfig {
  const errors: string[] = [];
  if (!/^\d{12}$/.test(c.account)) errors.push('account must be 12 digits');
  if (!c.az.startsWith(c.region)) errors.push(`az ${c.az} is not in region ${c.region}`);
  if (!/^[A-Za-z0-9 _-]{1,64}$/.test(c.serverName)) errors.push('serverName: letters, digits, space, _ or -, max 64');
  if (c.worlds.length === 0) errors.push('worlds must list at least one world');
  if (c.worlds[0]?.enabled === false) errors.push('the first world cannot be disabled');
  const names = new Set<string>(); const slugs = new Set<string>(); const ports = new Set<number>();
  for (const w of c.worlds) {
    if (!/^[A-Za-z0-9 _-]{1,32}$/.test(w.name)) errors.push(`world name ${JSON.stringify(w.name)}: letters, digits, space, _ or -, max 32`);
    if (names.has(w.name)) errors.push(`world ${w.name} is listed more than once`);
    const slug = w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) errors.push(`world ${JSON.stringify(w.name)} has an empty slug`);
    if (slugs.has(slug)) errors.push(`worlds ${w.name} and another share the slug ${slug}`);
    if (w.port % 2 !== 0) errors.push(`world ${w.name}: port must be even, the query port is the next one up`);
    if (w.port < WORLD_PORT_MIN || w.port > WORLD_PORT_MAX) errors.push(`world ${w.name}: port must be between ${WORLD_PORT_MIN} and ${WORLD_PORT_MAX}`);
    if (ports.has(w.port)) errors.push(`worlds use port ${w.port} twice`);
    names.add(w.name); slugs.add(slug); ports.add(w.port);
  }
  if (c.adminSteamIds.some((id) => !/^\d{17}$/.test(id))) errors.push('adminSteamIds must be 17-digit SteamID64 values');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.alertEmail)) errors.push('alertEmail is not an email address');
  if (!Number.isInteger(c.budgetUsd) || c.budgetUsd <= 0) errors.push('budgetUsd must be a positive integer');
  if (!/^\d+\.\d+\.\d+$/.test(c.imageTag)) errors.push('imageTag must be a pinned x.y.z tag, not latest');
  if (!Number.isInteger(c.saveIntervalSeconds) || c.saveIntervalSeconds < 60) errors.push('saveIntervalSeconds must be an integer of at least 60');
  const penalty = c.worldModifiers.deathPenalty;
  if (penalty !== undefined && !DEATH_PENALTIES.includes(penalty)) errors.push(`worldModifiers.deathPenalty must be one of ${DEATH_PENALTIES.join(', ')}`);
  if (!HHMM.test(c.schedule.stopAt) || !HHMM.test(c.schedule.startAt)) errors.push('schedule times must be HH:MM (24h)');
  const sleep = c.panel.sleepWhenEmpty;
  if (!Number.isInteger(sleep.idleMinutes) || sleep.idleMinutes < 10) errors.push('panel.sleepWhenEmpty.idleMinutes must be an integer of at least 10');
  if (!Number.isInteger(sleep.checkEveryMinutes) || sleep.checkEveryMinutes < 1 || sleep.checkEveryMinutes > sleep.idleMinutes) errors.push('panel.sleepWhenEmpty.checkEveryMinutes must be an integer between 1 and idleMinutes');
  const pkg = /^[A-Za-z0-9_]+$/;
  const seen = new Set<string>();
  for (const p of c.mods.packages) {
    const full = `${p.namespace}-${p.name}`;
    if (!pkg.test(p.namespace)) errors.push(`mods: namespace ${JSON.stringify(p.namespace)} may only contain letters, digits and _`);
    if (!pkg.test(p.name)) errors.push(`mods: name ${JSON.stringify(p.name)} may only contain letters, digits and _`);
    if (!/^\d+\.\d+\.\d+$/.test(p.version)) errors.push(`mods: ${full} version must be x.y.z`);
    if (seen.has(full)) errors.push(`mods: ${full} is listed more than once`);
    if (p.clientOnly && p.serverOnly) errors.push(`mods: ${full} cannot be both clientOnly and serverOnly`);
    seen.add(full);
  }
  if (c.mods.enabled && !c.mods.profileName.trim()) errors.push('mods.profileName is required when mods are enabled');
  if (errors.length > 0) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  return c;
}

export const config: ServerConfig = validateConfig({
  account: '623096509435',
  region: 'us-east-1',
  az: 'us-east-1a',
  instanceType: 'm7a.large',
  serverName: 'valheim-osrs-nerds',
  worlds: [{ name: 'OsrsNerds', port: 2456 }, { name: 'Iron Arbiters World', port: 2458, enabled: false }],
  adminSteamIds: ['76561198097010635'],
  alertEmail: 'fayadh56@gmail.com',
  budgetUsd: 115,
  imageTag: '1.3.0',
  saveIntervalSeconds: 900,
  worldModifiers: { deathPenalty: 'veryeasy' },
  timezone: 'America/Toronto',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  discordNotifications: true,
  panel: { enabled: true, sleepWhenEmpty: { enabledByDefault: false, idleMinutes: 60, checkEveryMinutes: 10 } },
  mods: {
    enabled: true,
    profileName: 'OsrsNerds',
    packages: [
      { namespace: 'denikson', name: 'BepInExPack_Valheim', version: '5.4.2351', clientOnly: true },
      { namespace: 'Azumatt', name: 'Official_BepInEx_ConfigurationManager', version: '18.4.1', clientOnly: true },
      { namespace: 'ValheimModding', name: 'Jotunn', version: '2.30.2' },
      { namespace: 'MidnightMods', name: 'NetworkPerformanceSystem', version: '1.11.1' },
      { namespace: 'MidnightMods', name: 'ValheimCommunityPatch', version: '0.30.0' },
      { namespace: 'momos3939', name: 'ForsakenPowerOverhaul', version: '2.2.0' },
      { namespace: 'xtavim', name: 'BetterConsumables', version: '1.1.0' },
      { namespace: 'sighsorry', name: 'InventorySlots', version: '1.5.16' },
      { namespace: 'ASharpPen', name: 'Drop_That', version: '3.1.6' },
      { namespace: 'Hex_Viking', name: 'NowYouSleep', version: '1.0.3', serverOnly: true },
      { namespace: 'JereKuusela', name: 'Server_devcommands', version: '1.115.0', serverOnly: true },
      { namespace: 'Advize', name: 'PlantEasily', version: '2.2.2', clientOnly: true },
    ],
  },
});
