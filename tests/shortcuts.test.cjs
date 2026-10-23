const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, DEFAULT_SHORTCUTS, normalizeShortcuts, ShortcutManager } = require('../src/shortcuts.cjs');

function fixture() {
  const callbacks = new Map(), blocked = new Set(), throws = new Set(), calls = [], actions = [];
  const globalShortcut = {
    register(accelerator, callback) {
      calls.push(['register', accelerator]);
      if (throws.has(accelerator)) throw new Error('OS rejected registration');
      if (blocked.has(accelerator) || callbacks.has(accelerator)) return false;
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) { calls.push(['unregister', accelerator]); callbacks.delete(accelerator); },
    unregisterAll() { throw new Error('Must never remove shortcuts owned by other code'); }
  };
  const manager = new ShortcutManager(globalShortcut, action => actions.push(action));
  return { manager, callbacks, blocked, throws, calls, actions, fire: key => callbacks.get(key)?.() };
}

test('normalization fills disabled actions, canonicalizes aliases and does not share defaults', () => {
  assert.deepEqual(ACTIONS, ['clockIn', 'pause', 'resume', 'clockOut', 'toggleOrb']);
  assert.deepEqual(normalizeShortcuts(), DEFAULT_SHORTCUTS);
  assert.deepEqual(normalizeShortcuts({ clockIn: ' shift + CONTROL + alt + a ', pause: 'alt+return', resume: 'control+ArrowUp', clockOut: 'F24', toggleOrb: 'ctrl+1' }), {
    clockIn: 'Ctrl+Alt+Shift+A', pause: 'Alt+Enter', resume: 'Ctrl+Up', clockOut: 'F24', toggleOrb: 'Ctrl+1'
  });
  const blank = normalizeShortcuts({ clockIn: '  ' });
  blank.pause = 'F1';
  assert.equal(DEFAULT_SHORTCUTS.pause, '');
  for (const key of ['Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Space', 'Tab', 'Enter', 'Backspace']) {
    assert.equal(normalizeShortcuts({ pause: `Ctrl+${key}` }).pause, `Ctrl+${key}`);
  }
  assert.equal(normalizeShortcuts({ pause: 'Shift+F1' }).pause, 'Shift+F1');
});

test('invalid and reserved accelerators fail before they reach the OS', () => {
  for (const key of ['A', '1', 'Shift+A', 'Shift+Tab', 'Ctrl', 'Ctrl+Shift', 'Win+A', 'Meta+A', 'Super+A', 'Ctrl+Ctrl+A', 'Ctrl+A+B', 'Ctrl++', 'Ctrl+F25', 'Ctrl+F0', 'Ctrl+F01', 'Ctrl+;', 10, null]) {
    assert.throws(() => normalizeShortcuts({ clockIn: key }), error => error.code === 'invalid' && error.status.clockIn.error === 'invalid', String(key));
  }
  for (const key of ['Alt+Tab', 'Alt+Shift+Tab', 'Alt+Esc', 'Alt+Space', 'Alt+F4', 'Ctrl+Escape', 'Ctrl+Shift+Esc', 'Ctrl+Alt+Delete']) {
    assert.throws(() => normalizeShortcuts({ clockIn: key }), error => error.code === 'reserved', key);
  }
  for (const value of [null, [], 'Ctrl+A', { unknown: 'Ctrl+A' }]) assert.throws(() => normalizeShortcuts(value));
});

test('canonical duplicate detection marks every duplicate row while check still validates other rows', () => {
  const { manager, callbacks } = fixture();
  const bindings = { clockIn: 'ctrl+a', pause: 'Control+A', resume: 'CTRL+a', clockOut: 'F2', toggleOrb: 'Shift+A' };
  assert.throws(() => normalizeShortcuts(bindings), error => {
    for (const action of ['clockIn', 'pause', 'resume']) assert.equal(error.status[action].error, 'duplicate');
    return true;
  });
  const status = manager.check(bindings);
  for (const action of ['clockIn', 'pause', 'resume']) assert.deepEqual(status[action], { accelerator: 'Ctrl+A', error: 'duplicate', registered: false });
  assert.equal(status.clockOut.registered, true);
  assert.equal(status.toggleOrb.error, 'invalid');
  assert.equal(callbacks.size, 0);
});

test('startup keeps available actions when other actions are invalid, reserved or OS-unavailable', () => {
  const { manager, blocked, throws, fire, actions } = fixture();
  blocked.add('Ctrl+P'); throws.add('Ctrl+R');
  const status = manager.start({ clockIn: 'Ctrl+I', pause: 'Ctrl+P', resume: 'Ctrl+R', clockOut: 'Alt+F4', toggleOrb: 'Shift+O' });
  assert.equal(status.clockIn.registered, true);
  assert.equal(status.pause.error, 'unavailable');
  assert.equal(status.resume.error, 'unavailable');
  assert.equal(status.clockOut.error, 'reserved');
  assert.equal(status.toggleOrb.error, 'invalid');
  fire('Ctrl+I');
  assert.deepEqual(actions, ['clockIn']);
  const duplicateStatus = manager.start({ clockIn: 'Ctrl+I', pause: 'Control+I', toggleOrb: 'F2' });
  assert.equal(duplicateStatus.clockIn.error, 'duplicate');
  assert.equal(duplicateStatus.pause.error, 'duplicate');
  fire('Ctrl+I'); fire('F2');
  assert.deepEqual(actions, ['clockIn', 'toggleOrb']);
});

test('availability checks preserve existing handlers and unrelated registrations while cleaning probes', () => {
  const { manager, callbacks, blocked, throws, calls, fire, actions } = fixture();
  callbacks.set('Ctrl+X', () => actions.push('foreign'));
  manager.start({ clockIn: 'Ctrl+A', pause: 'Ctrl+B' });
  const held = callbacks.get('Ctrl+A'), before = manager.getStatus();
  blocked.add('Ctrl+P'); throws.add('Ctrl+R'); calls.length = 0;
  const status = manager.check({ clockIn: 'Ctrl+B', pause: 'Ctrl+A', resume: 'Ctrl+C', clockOut: 'Ctrl+P', toggleOrb: 'Ctrl+R' });
  assert.equal(status.clockIn.registered, true);
  assert.equal(status.pause.registered, true);
  assert.equal(status.resume.registered, true);
  assert.equal(status.clockOut.error, 'unavailable');
  assert.equal(status.toggleOrb.error, 'unavailable');
  assert.equal(callbacks.get('Ctrl+A'), held);
  assert.equal(callbacks.has('Ctrl+C'), false);
  assert.equal(callbacks.has('Ctrl+X'), true);
  assert.equal(calls.some(([verb, key]) => verb === 'unregister' && ['Ctrl+A', 'Ctrl+B', 'Ctrl+X'].includes(key)), false);
  assert.deepEqual(manager.getStatus(), before);
  assert.equal(manager.check({ toggleOrb: 'Ctrl+X' }).toggleOrb.error, 'unavailable');
  fire('Ctrl+A'); fire('Ctrl+X');
  assert.deepEqual(actions, ['clockIn', 'foreign']);
});

test('replacement persists canonical settings before changing handlers and supports swapping keys', () => {
  const { manager, callbacks, calls, fire, actions } = fixture();
  manager.start({ clockIn: 'Ctrl+A', pause: 'Ctrl+B', resume: 'Ctrl+C' });
  const originalA = callbacks.get('Ctrl+A'), originalB = callbacks.get('Ctrl+B');
  calls.length = 0;
  let persisted;
  manager.replace({ clockIn: 'control+b', pause: 'ctrl+a', clockOut: 'Ctrl+D' }, bindings => {
    persisted = { ...bindings };
    fire('Ctrl+A'); fire('Ctrl+B'); fire('Ctrl+D');
    bindings.clockIn = 'F24';
  });
  assert.deepEqual(actions, ['clockIn', 'pause']);
  assert.deepEqual(persisted, { clockIn: 'Ctrl+B', pause: 'Ctrl+A', resume: '', clockOut: 'Ctrl+D', toggleOrb: '' });
  assert.equal(callbacks.get('Ctrl+A'), originalA);
  assert.equal(callbacks.get('Ctrl+B'), originalB);
  assert.equal(callbacks.has('Ctrl+C'), false);
  assert.equal(calls.some(([verb, key]) => verb === 'unregister' && ['Ctrl+A', 'Ctrl+B'].includes(key)), false);
  fire('Ctrl+A'); fire('Ctrl+B'); fire('Ctrl+D');
  assert.deepEqual(actions, ['clockIn', 'pause', 'pause', 'clockIn', 'clockOut']);
  assert.equal(manager.getStatus().clockIn.accelerator, 'Ctrl+B');
});

test('rejected registrations roll back newly acquired keys and preserve old settings and callbacks', () => {
  for (const failure of ['blocked', 'throws']) {
    const context = fixture(), { manager, callbacks, fire, actions } = context;
    let persisted = normalizeShortcuts({ clockIn: 'Ctrl+A' }), saves = 0;
    manager.start(persisted);
    const original = callbacks.get('Ctrl+A'), before = manager.getStatus();
    context[failure].add('Ctrl+D');
    assert.throws(() => manager.replace({ clockIn: 'Ctrl+C', clockOut: 'Ctrl+D' }, bindings => { persisted = bindings; saves++; }), error => error.code === 'unavailable' && error.status.clockOut.error === 'unavailable');
    assert.equal(saves, 0);
    assert.equal(persisted.clockIn, 'Ctrl+A');
    assert.equal(callbacks.get('Ctrl+A'), original);
    assert.equal(callbacks.has('Ctrl+C'), false);
    assert.deepEqual(manager.getStatus(), before);
    fire('Ctrl+A');
    assert.deepEqual(actions, ['clockIn']);
  }
});

test('a failed disk save rolls back candidate keys without unregistering the previous binding', () => {
  const { manager, callbacks, calls, fire, actions } = fixture();
  manager.start({ clockIn: 'Ctrl+A', pause: 'Ctrl+B' });
  const previous = manager.getStatus(), diskFailure = new Error('Disk is full');
  calls.length = 0;
  assert.throws(() => manager.replace({ clockIn: 'Ctrl+C' }, () => { throw diskFailure; }), error => error === diskFailure);
  assert.deepEqual(manager.getStatus(), previous);
  assert.equal(callbacks.has('Ctrl+C'), false);
  assert.equal(calls.some(([verb, key]) => verb === 'unregister' && ['Ctrl+A', 'Ctrl+B'].includes(key)), false);
  fire('Ctrl+A'); fire('Ctrl+B');
  assert.deepEqual(actions, ['clockIn', 'pause']);
  assert.throws(() => manager.replace({ clockIn: 'Ctrl+C', pause: 'Control+C' }, () => assert.fail('duplicate settings must never be saved')), error => error.code === 'duplicate');
  assert.deepEqual(manager.getStatus(), previous);
});

test('capture suspension releases only owned keys, suppresses callbacks, and resumes idempotently', () => {
  const { manager, callbacks, calls, blocked, fire, actions } = fixture();
  callbacks.set('Ctrl+X', () => actions.push('foreign'));
  manager.start({ clockIn: 'Ctrl+A', toggleOrb: 'Ctrl+O' });
  const queued = callbacks.get('Ctrl+A');
  manager.suspend();
  const count = calls.length;
  manager.suspend();
  assert.equal(calls.length, count);
  assert.deepEqual([...callbacks.keys()], ['Ctrl+X']);
  assert.equal(manager.getStatus().clockIn.error, 'suspended');
  queued();
  assert.deepEqual(actions, []);
  assert.equal(manager.check({ clockIn: 'Ctrl+A' }).clockIn.registered, true);
  assert.equal(callbacks.has('Ctrl+A'), false);
  blocked.add('Ctrl+O');
  const status = manager.resume();
  assert.equal(status.clockIn.registered, true);
  assert.equal(status.toggleOrb.error, 'unavailable');
  const resumedCount = calls.length;
  manager.resume();
  assert.equal(calls.length, resumedCount);
  fire('Ctrl+A');
  assert.deepEqual(actions, ['clockIn']);
  blocked.clear();
  manager.suspend(); manager.resume();
  assert.equal(manager.getStatus().toggleOrb.registered, true);
});

test('replacement during capture validates and saves but leaves all keys released until capture ends', () => {
  const { manager, callbacks, fire, actions } = fixture();
  manager.start({ clockIn: 'Ctrl+A' }); manager.suspend();
  let persisted;
  manager.replace({ toggleOrb: 'Ctrl+O' }, bindings => { persisted = bindings; });
  assert.equal(persisted.toggleOrb, 'Ctrl+O');
  assert.equal(callbacks.size, 0);
  assert.equal(manager.getStatus().toggleOrb.error, 'suspended');
  manager.resume(); fire('Ctrl+O');
  assert.equal(callbacks.has('Ctrl+A'), false);
  assert.deepEqual(actions, ['toggleOrb']);
});

test('status is detached and disposal removes only owned keys and prevents queued actions', () => {
  const { manager, callbacks, calls, actions } = fixture();
  callbacks.set('Ctrl+X', () => {});
  manager.start({ clockIn: 'Ctrl+A' });
  const queued = callbacks.get('Ctrl+A'), status = manager.getStatus();
  status.clockIn.error = 'changed';
  assert.equal(manager.getStatus().clockIn.error, null);
  manager.dispose();
  const count = calls.length;
  manager.dispose(); manager.suspend(); manager.resume();
  assert.equal(calls.length, count);
  queued();
  assert.deepEqual(actions, []);
  assert.deepEqual([...callbacks.keys()], ['Ctrl+X']);
  assert.equal(manager.getStatus().clockIn.registered, false);
  assert.throws(() => manager.start({}));
});
