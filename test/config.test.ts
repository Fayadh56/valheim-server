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

test('rejects a world name with a space', () => {
  expect(() => validateConfig({ ...valid, worldName: 'Osrs Nerds' })).toThrow(/worldName/);
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
