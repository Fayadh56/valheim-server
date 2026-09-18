import { modsView } from '../../lambda/panel/mods';

const raw = JSON.stringify([{ namespace: 'ValheimModding', name: 'Jotunn', version: '2.30.0' }, { namespace: 'Goldenrevolver', name: 'Quick_Stack_Store_Sort_Trash_Restock', version: '1.4.15' }]);

test('names come from the package name with spaces for underscores', () => {
  expect(modsView(raw, 'abc')).toEqual({ names: ['Jotunn', 'Quick Stack Store Sort Trash Restock'], profileCode: 'abc' });
});

test('none or empty code is null; empty or broken list is undefined', () => {
  expect(modsView(raw, 'none')?.profileCode).toBeNull();
  expect(modsView(raw, '')?.profileCode).toBeNull();
  expect(modsView('[]', 'abc')).toBeUndefined();
  expect(modsView('garbage', 'abc')).toBeUndefined();
  expect(modsView(JSON.stringify([{ nope: 1 }]), 'abc')).toBeUndefined();
});
