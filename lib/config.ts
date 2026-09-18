export interface ScheduleConfig {
  enabled: boolean;
  stopAt: string;
  startAt: string;
}

export interface ServerConfig {
  account: string;
  region: string;
  az: string;
  instanceType: string;
  serverName: string;
  worldName: string;
  adminSteamIds: string[];
  alertEmail: string;
  budgetUsd: number;
  imageTag: string;
  saveIntervalSeconds: number;
  timezone: string;
  schedule: ScheduleConfig;
  discordNotifications: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateConfig(c: ServerConfig): ServerConfig {
  const errors: string[] = [];
  if (!/^\d{12}$/.test(c.account)) errors.push('account must be 12 digits');
  if (!c.az.startsWith(c.region)) errors.push(`az ${c.az} is not in region ${c.region}`);
  if (!/^[A-Za-z0-9 _-]{1,64}$/.test(c.serverName)) errors.push('serverName: letters, digits, space, _ or -, max 64');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(c.worldName)) errors.push('worldName: letters, digits, _ or -, max 32');
  if (c.adminSteamIds.some((id) => !/^\d{17}$/.test(id))) errors.push('adminSteamIds must be 17-digit SteamID64 values');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.alertEmail)) errors.push('alertEmail is not an email address');
  if (!Number.isInteger(c.budgetUsd) || c.budgetUsd <= 0) errors.push('budgetUsd must be a positive integer');
  if (!/^\d+\.\d+\.\d+$/.test(c.imageTag)) errors.push('imageTag must be a pinned x.y.z tag, not latest');
  if (!Number.isInteger(c.saveIntervalSeconds) || c.saveIntervalSeconds < 60) errors.push('saveIntervalSeconds must be an integer of at least 60');
  if (!HHMM.test(c.schedule.stopAt) || !HHMM.test(c.schedule.startAt)) errors.push('schedule times must be HH:MM (24h)');
  if (errors.length > 0) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  return c;
}

export const config: ServerConfig = validateConfig({
  account: '623096509435',
  region: 'us-east-1',
  az: 'us-east-1a',
  instanceType: 'm7a.large',
  serverName: 'valheim-osrs-nerds',
  worldName: 'OsrsNerds',
  adminSteamIds: ['76561198097010635'],
  alertEmail: 'fayadh56@gmail.com',
  budgetUsd: 115,
  imageTag: '1.3.0',
  saveIntervalSeconds: 900,
  timezone: 'America/Toronto',
  schedule: { enabled: false, stopAt: '03:00', startAt: '16:00' },
  discordNotifications: false,
});
