import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { ModsConfig } from './config';

export const MODS_PARAMETER_NAME = '/valheim/mods/packages';
export const MODS_CONFIG_PATH = '/valheim/mods/config';
export const PROFILE_CODE_PARAMETER_NAME = '/valheim/panel/profile-code';
export const MODS_CONFIG_DIR = path.join(__dirname, '..', 'server', 'mods', 'config');
const PARAMETER_LIMIT = 4096;

export interface ServerPackage {
  namespace: string;
  name: string;
  version: string;
  serverOnly?: true;
}

export function serverPackages(mods: ModsConfig): ServerPackage[] {
  return mods.packages.filter((p) => !p.clientOnly).map(({ namespace, name, version, serverOnly }) => ({ namespace, name, version, ...(serverOnly ? { serverOnly: true as const } : {}) }));
}

export function packagesJson(mods: ModsConfig): string {
  return JSON.stringify(serverPackages(mods));
}

export function readConfigOverrides(dir: string): Record<string, string> {
  const files = readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(path.join(dir, f)).isFile()).sort();
  return Object.fromEntries(files.map((f) => {
    const body = readFileSync(path.join(dir, f), 'utf8');
    if (Buffer.byteLength(body) > PARAMETER_LIMIT) throw new Error(`mod config ${f} is ${Buffer.byteLength(body)} bytes; SSM standard parameters hold ${PARAMETER_LIMIT}`);
    return [f, body];
  }));
}
