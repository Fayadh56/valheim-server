import { strToU8, zipSync } from 'fflate';
import { stringify } from 'yaml';
import { ModsConfig } from './config';

export const PROFILE_UPLOAD_URL = 'https://thunderstore.io/api/experimental/legacyprofile/create/';
export const R2MODMAN_URL = 'https://thunderstore.io/package/ebkr/r2modman/';
const HEADER = '#r2modman\n';

// r2modman's export.r2x: every package by full name with the version split into numbers
export function buildExportYaml(mods: ModsConfig): string {
  return stringify({
    profileName: mods.profileName,
    mods: mods.packages.map((p) => {
      const [major, minor, patch] = p.version.split('.').map(Number);
      return { name: `${p.namespace}-${p.name}`, version: { major, minor, patch }, enabled: true };
    }),
  });
}

export function buildProfileUpload(mods: ModsConfig): string {
  const zip = zipSync({ 'export.r2x': strToU8(buildExportYaml(mods)) }, { level: 6 });
  return HEADER + Buffer.from(zip).toString('base64');
}

export function modDisplayNames(packages: Array<{ name: string }>): string[] {
  return packages.map((p) => p.name.replace(/_/g, ' '));
}

export function joinInstructions(code: string, panelUrl: string, names: string[]): string {
  return [
    'Mods are on. To join you now need the same ones, and it takes two minutes:',
    `1. Install r2modman (${R2MODMAN_URL}) and pick Valheim.`,
    '2. Profiles, then Import / Update, then From code.',
    `3. Paste this code: ${code}`,
    '4. Start modded.',
    `Mods: ${names.join(', ')}.`,
    `The code is always on the panel too: ${panelUrl}`,
  ].join('\n');
}
