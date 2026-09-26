import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const script = join(__dirname, '..', '..', 'server', 'valheim-mods.py');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'mods-sync-'));
  const dirs = { config: join(root, 'config'), install: join(root, 'install'), cache: join(root, 'cache'), zips: join(root, 'zips') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  mkdirSync(join(dirs.install, 'plugins'), { recursive: true });
  return { root, ...dirs };
}

function zip(dir: string, file: string, entries: Record<string, string>) {
  writeFileSync(join(dir, file), zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))));
}

function sync(d: ReturnType<typeof setup>, manifest: object[], overrides: [string, string][] = []) {
  writeFileSync(join(d.root, 'mods.json'), JSON.stringify(manifest));
  writeFileSync(join(d.root, 'mods-config.json'), JSON.stringify(overrides));
  return execFileSync('python3', [script, 'sync', join(d.root, 'mods.json'), join(d.root, 'mods-config.json'), '--config-root', d.config, '--install-root', d.install, '--cache', d.cache, '--zips', d.zips, '--owner', 'none'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const jotunn = { namespace: 'ValheimModding', name: 'Jotunn', version: '2.30.0' };
const quick = { namespace: 'Goldenrevolver', name: 'Quick_Stack_Store_Sort_Trash_Restock', version: '1.4.15' };

test('installs plugins-shaped and root-shaped zips, keeping extras and skipping metadata', () => {
  const d = setup();
  zip(d.zips, 'ValheimModding-Jotunn-2.30.0.zip', { 'plugins/Jotunn.dll': 'j', 'plugins/Jotunn.xml': 'x', 'manifest.json': '{}', 'README.md': 'r', 'icon.png': 'i', 'CHANGELOG.md': 'c' });
  zip(d.zips, 'Goldenrevolver-Quick_Stack_Store_Sort_Trash_Restock-1.4.15.zip', { 'QuickStackStore.dll': 'q', 'Translations/QuickStackStore.English.json': '{}', 'LICENSE': 'l', 'manifest.json': '{}' });
  sync(d, [jotunn, quick]);
  const j = join(d.config, 'plugins', 'ValheimModding-Jotunn');
  expect(readdirSync(j).sort()).toEqual(['.version', 'Jotunn.dll', 'Jotunn.xml']);
  expect(readFileSync(join(j, '.version'), 'utf8')).toBe('2.30.0');
  const q = join(d.config, 'plugins', 'Goldenrevolver-Quick_Stack_Store_Sort_Trash_Restock');
  expect(readdirSync(q).sort()).toEqual(['.version', 'QuickStackStore.dll', 'Translations']);
  expect(existsSync(join(q, 'Translations', 'QuickStackStore.English.json'))).toBe(true);
  expect(readdirSync(d.cache).sort()).toEqual(['Goldenrevolver-Quick_Stack_Store_Sort_Trash_Restock-1.4.15.zip', 'ValheimModding-Jotunn-2.30.0.zip']);
});

test('upgrades on a version change and skips when already installed', () => {
  const d = setup();
  zip(d.zips, 'ValheimModding-Jotunn-2.30.0.zip', { 'plugins/Jotunn.dll': 'old', 'plugins/Gone.dll': 'g' });
  zip(d.zips, 'ValheimModding-Jotunn-2.31.0.zip', { 'plugins/Jotunn.dll': 'new' });
  sync(d, [jotunn]);
  const out = sync(d, [jotunn]);
  expect(out).toContain('ValheimModding-Jotunn 2.30.0 already installed');
  sync(d, [{ ...jotunn, version: '2.31.0' }]);
  const j = join(d.config, 'plugins', 'ValheimModding-Jotunn');
  expect(readdirSync(j).sort()).toEqual(['.version', 'Jotunn.dll']);
  expect(readFileSync(join(j, 'Jotunn.dll'), 'utf8')).toBe('new');
});

test('prunes unlisted managed folders from both roots and leaves unmanaged ones alone', () => {
  const d = setup();
  zip(d.zips, 'ValheimModding-Jotunn-2.30.0.zip', { 'plugins/Jotunn.dll': 'j' });
  sync(d, [jotunn]);
  mkdirSync(join(d.install, 'plugins', 'ValheimModding-Jotunn'));
  writeFileSync(join(d.install, 'plugins', 'ValheimModding-Jotunn', 'Jotunn.dll'), 'j');
  mkdirSync(join(d.config, 'plugins', 'HandInstalled'));
  writeFileSync(join(d.config, 'plugins', 'HandInstalled', 'x.dll'), 'x');
  sync(d, []);
  expect(existsSync(join(d.config, 'plugins', 'ValheimModding-Jotunn'))).toBe(false);
  expect(existsSync(join(d.install, 'plugins', 'ValheimModding-Jotunn'))).toBe(false);
  expect(existsSync(join(d.config, 'plugins', 'HandInstalled', 'x.dll'))).toBe(true);
});

test('writes config overrides by basename', () => {
  const d = setup();
  sync(d, [], [['/valheim/mods/config/xtavim.BetterConsumables.cfg', '[General]\nLock Configuration = true\n']]);
  expect(readFileSync(join(d.config, 'xtavim.BetterConsumables.cfg'), 'utf8')).toBe('[General]\nLock Configuration = true\n');
});

test('overrides merge into an existing config, keeping other keys and comments, and stay idempotent', () => {
  const d = setup();
  const existing = '## Settings file\n[General]\n## Desc\n# Setting type: Boolean\nLock Configuration = false\n\n[Food]\n# Default value: 1\nFood Duration Multiplier = 1\nFood Health Multiplier = 1\n\n[Potions]\nRemove Potions Cooldown = true\n';
  writeFileSync(join(d.config, 'x.cfg'), existing);
  const override = '# pinned\n[Food]\nFood Duration Multiplier = 3\nFood Eitr Multiplier = 2\n[New]\nKey=1\n';
  const out1 = sync(d, [], [['/valheim/mods/config/x.cfg', override]]);
  expect(out1).toContain('merged x.cfg');
  sync(d, [], [['/valheim/mods/config/x.cfg', override]]);
  const out = readFileSync(join(d.config, 'x.cfg'), 'utf8');
  expect(out).toContain('## Settings file\n[General]\n## Desc\n# Setting type: Boolean\nLock Configuration = false\n');
  expect(out).toContain('# Default value: 1\nFood Duration Multiplier = 3\nFood Health Multiplier = 1\nFood Eitr Multiplier = 2\n\n[Potions]\nRemove Potions Cooldown = true\n');
  expect(out.endsWith('[New]\nKey=1\n')).toBe(true);
  expect(out.match(/Food Duration Multiplier/g)).toHaveLength(1);
  expect(out.match(/\[New\]/g)).toHaveLength(1);
  expect(out).not.toContain('# pinned');
});

test('a missing zip keeps going and a zip-slip entry is rejected', () => {
  const d = setup();
  zip(d.zips, 'Evil-Mod-1.0.0.zip', { '../escape.dll': 'e', 'ok.dll': 'o' });
  const out = sync(d, [jotunn, { namespace: 'Evil', name: 'Mod', version: '1.0.0' }]);
  expect(out).toMatch(/could not fetch ValheimModding-Jotunn 2\.30\.0/);
  expect(out).toMatch(/unsafe path/);
  expect(existsSync(join(d.root, 'escape.dll'))).toBe(false);
  expect(existsSync(join(d.config, 'plugins', 'Evil-Mod'))).toBe(false);
  expect(existsSync(join(d.cache, 'Evil-Mod-1.0.0.zip'))).toBe(false);
});

test('a corrupt archive is dropped from the cache so the next run fetches again', () => {
  const d = setup();
  writeFileSync(join(d.zips, 'ValheimModding-Jotunn-2.30.0.zip'), 'not a zip');
  const out = sync(d, [jotunn]);
  expect(out).toMatch(/skipping ValheimModding-Jotunn 2\.30\.0/);
  expect(existsSync(join(d.cache, 'ValheimModding-Jotunn-2.30.0.zip'))).toBe(false);
  zip(d.zips, 'ValheimModding-Jotunn-2.30.0.zip', { 'plugins/Jotunn.dll': 'j' });
  expect(sync(d, [jotunn])).toContain('installed ValheimModding-Jotunn 2.30.0');
});
