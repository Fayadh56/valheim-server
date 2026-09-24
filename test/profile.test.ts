import { unzipSync, strFromU8 } from 'fflate';
import { parse } from 'yaml';
import { config } from '../lib/config';
import { buildExportYaml, buildProfileUpload, joinInstructions, modDisplayNames } from '../lib/profile';

test('export yaml lists every package with split versions, enabled', () => {
  const doc = parse(buildExportYaml(config.mods));
  expect(doc.profileName).toBe('OsrsNerds');
  expect(doc.mods).toHaveLength(config.mods.packages.filter((p) => !p.serverOnly).length);
  expect(doc.mods.map((m: { name: string }) => m.name)).not.toContain('Hex_Viking-NowYouSleep');
  const pack = config.mods.packages[0];
  const [major, minor, patch] = pack.version.split('.').map(Number);
  expect(doc.mods[0]).toEqual({ name: `${pack.namespace}-${pack.name}`, version: { major, minor, patch }, enabled: true });
  expect(doc.mods.map((m: { name: string }) => m.name)).toContain('sighsorry-InventorySlots');
});

test('upload body is the r2modman header plus a base64 zip holding only export.r2x', () => {
  const body = buildProfileUpload(config.mods);
  expect(body.startsWith('#r2modman\n')).toBe(true);
  const files = unzipSync(Buffer.from(body.slice('#r2modman\n'.length), 'base64'));
  expect(Object.keys(files)).toEqual(['export.r2x']);
  expect(strFromU8(files['export.r2x'])).toBe(buildExportYaml(config.mods));
});

test('display names and join instructions', () => {
  expect(modDisplayNames([{ name: 'Quick_Stack_Store_Sort_Trash_Restock' }, { name: 'Jotunn' }])).toEqual(['Quick Stack Store Sort Trash Restock', 'Jotunn']);
  const text = joinInstructions('abc-123', 'https://panel.example/', ['Jotunn', 'InventorySlots']);
  expect(text).toContain('abc-123');
  expect(text).toContain('https://panel.example/');
  expect(text).toContain('Jotunn, InventorySlots');
  expect(text).toContain('r2modman');
  expect(text).toContain('Start modded');
  expect(text).not.toContain('\u2014');
});
