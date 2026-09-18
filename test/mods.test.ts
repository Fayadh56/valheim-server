import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../lib/config';
import { packagesJson, readConfigOverrides, serverPackages } from '../lib/mods';

test('server packages leave out client-only ones and carry no extra fields', () => {
  const list = serverPackages(config.mods);
  expect(list.map((p) => p.name)).not.toContain('BepInExPack_Valheim');
  expect(list).toHaveLength(config.mods.packages.filter((p) => !p.clientOnly).length);
  expect(list.map((p) => p.name)).not.toContain('Official_BepInEx_ConfigurationManager');
  expect(Object.keys(list[0]).sort()).toEqual(['name', 'namespace', 'version']);
  expect(JSON.parse(packagesJson(config.mods))).toEqual(list);
});

test('config overrides are read by filename, dotfiles skipped, big files rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mods-config-'));
  writeFileSync(join(dir, '.gitkeep'), '');
  writeFileSync(join(dir, 'xtavim.BetterConsumables.cfg'), '[General]\nLock Configuration = true\n');
  expect(readConfigOverrides(dir)).toEqual({ 'xtavim.BetterConsumables.cfg': '[General]\nLock Configuration = true\n' });
  writeFileSync(join(dir, 'big.cfg'), 'x'.repeat(4097));
  expect(() => readConfigOverrides(dir)).toThrow(/big\.cfg.*4096/);
});
