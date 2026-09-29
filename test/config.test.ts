import { config, validateConfig, ServerConfig } from '../lib/config';

const valid: ServerConfig = { ...config };

test('real config is valid', () => {
  expect(() => validateConfig(config)).not.toThrow();
});

test('rejects a non 12 digit account', () => {
  expect(() => validateConfig({ ...valid, account: '123' })).toThrow(/account/);
});

test('rejects an az outside the region', () => {
  expect(() => validateConfig({ ...valid, az: 'us-west-2a' })).toThrow(/az/);
});

test('rejects latest as image tag', () => {
  expect(() => validateConfig({ ...valid, imageTag: 'latest' })).toThrow(/imageTag/);
});

test('rejects malformed steam ids', () => {
  expect(() => validateConfig({ ...valid, adminSteamIds: ['abc'] })).toThrow(/adminSteamIds/);
});

test('rejects bad schedule times', () => {
  expect(() => validateConfig({ ...valid, schedule: { ...valid.schedule, stopAt: '25:00' } })).toThrow(/HH:MM/);
});

test('reports every problem at once', () => {
  expect(() => validateConfig({ ...valid, account: 'x', imageTag: 'latest' })).toThrow(/account[\s\S]*imageTag/);
});

test('rejects a server name with an illegal character', () => {
  expect(() => validateConfig({ ...valid, serverName: 'bad!name' })).toThrow(/serverName/);
});

test('validates the world list', () => {
  const ok = (worlds: ServerConfig['worlds']) => validateConfig({ ...valid, worlds });
  expect(() => ok([{ name: 'Osrs Nerds', port: 2456 }])).not.toThrow();
  expect(() => ok([])).toThrow(/worlds/);
  expect(() => ok([{ name: 'Bad!', port: 2456 }])).toThrow(/name/);
  expect(() => ok([{ name: 'A', port: 2456 }, { name: 'A', port: 2458 }])).toThrow(/once/);
  expect(() => ok([{ name: 'A', port: 2457 }])).toThrow(/even/);
  expect(() => ok([{ name: 'A', port: 2472 }])).toThrow(/2456 and 2470/);
  expect(() => ok([{ name: 'A', port: 2456 }, { name: 'B', port: 2456 }])).toThrow(/port 2456 twice/);
  expect(() => ok([{ name: '---', port: 2456 }])).toThrow(/slug/);
  expect(() => ok([{ name: 'A', port: 2456 }, { name: 'B', port: 2458, enabled: false }])).not.toThrow();
  expect(() => ok([{ name: 'A', port: 2456, enabled: false }, { name: 'B', port: 2458 }])).toThrow(/first world/);
  expect(() => ok([{ name: 'A', port: 2456 }, { name: 'B', port: 2456, enabled: false }])).toThrow(/port 2456 twice/);
});

test('rejects a malformed alert email', () => {
  expect(() => validateConfig({ ...valid, alertEmail: 'not-an-email' })).toThrow(/alertEmail/);
});

test('rejects a non positive budget', () => {
  expect(() => validateConfig({ ...valid, budgetUsd: 0 })).toThrow(/budgetUsd/);
});

test('rejects a save interval under a minute', () => {
  expect(() => validateConfig({ ...valid, saveIntervalSeconds: 30 })).toThrow(/saveIntervalSeconds/);
});

test('rejects a single digit hour in startAt', () => {
  expect(() => validateConfig({ ...valid, schedule: { ...valid.schedule, startAt: '9:00' } })).toThrow(/HH:MM/);
});

test('rejects bad sleep settings', () => {
  expect(() => validateConfig({ ...valid, panel: { ...valid.panel, sleepWhenEmpty: { enabledByDefault: false, idleMinutes: 5, checkEveryMinutes: 1 } } })).toThrow(/idleMinutes/);
  expect(() => validateConfig({ ...valid, panel: { ...valid.panel, sleepWhenEmpty: { enabledByDefault: false, idleMinutes: 60, checkEveryMinutes: 90 } } })).toThrow(/checkEveryMinutes/);
});

test('rejects an unknown death penalty', () => {
  expect(() => validateConfig({ ...valid, worldModifiers: { deathPenalty: 'brutal' as 'hard' } })).toThrow(/deathPenalty/);
  expect(() => validateConfig({ ...valid, worldModifiers: {} })).not.toThrow();
});

test('rejects bad mod packages', () => {
  const mods = valid.mods;
  expect(() => validateConfig({ ...valid, mods: { ...mods, packages: [{ namespace: 'a', name: 'b', version: '1.2' }] } })).toThrow(/version/);
  expect(() => validateConfig({ ...valid, mods: { ...mods, packages: [{ namespace: 'bad name', name: 'b', version: '1.2.3' }] } })).toThrow(/namespace/);
  expect(() => validateConfig({ ...valid, mods: { ...mods, packages: [{ namespace: 'a', name: 'b-c', version: '1.2.3' }] } })).toThrow(/name/);
  expect(() => validateConfig({ ...valid, mods: { ...mods, packages: [{ namespace: 'a', name: 'b', version: '1.2.3' }, { namespace: 'a', name: 'b', version: '1.2.4' }] } })).toThrow(/once/);
  expect(() => validateConfig({ ...valid, mods: { ...mods, profileName: '' } })).toThrow(/profileName/);
  expect(() => validateConfig({ ...valid, mods: { ...mods, packages: [{ namespace: 'a', name: 'b', version: '1.2.3', clientOnly: true, serverOnly: true }] } })).toThrow(/both/);
  expect(() => validateConfig({ ...valid, mods: { enabled: false, profileName: '', packages: [] } })).not.toThrow();
});
