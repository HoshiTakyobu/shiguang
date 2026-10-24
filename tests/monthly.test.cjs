const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_MONTHLY_GOALS, normalizeMonthlyGoals, monthSummary, MonthlyNoticeStore } = require('../src/monthly.cjs');
const { SettingsStore, patchSettings } = require('../src/settings.cjs');
const HOUR = 3600000;
const at = new Date(2026, 9, 24, 12).getTime();
function daysFor(hours) { const days = {}; for (let d = 1; hours > 0; d++) { days[`2026-10-${String(d).padStart(2, '0')}`] = Math.min(24, hours) * HOUR; hours -= 24; } return days; }
const bonuses = [
  { id: 'bonus-1', hours: 200, amount: 1600 },
  { id: 'bonus-2', hours: 240, amount: 2000 },
  { id: 'bonus-3', hours: 280, amount: 2600 }
];
function withDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-monthly-test-'));
  try { callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('month totals exclude adjacent weeks and respect leap-day month boundaries', () => {
  assert.equal(monthSummary({ ...daysFor(160), '2026-09-30': 24 * HOUR, '2026-11-01': 24 * HOUR }, at).totalHours, 160);
  assert.equal(monthSummary({ '2028-02-29': 5 * HOUR, '2028-03-01': 4 * HOUR }, new Date(2028, 1, 29)).totalHours, 5);
  assert.equal(monthSummary({ '2027-02-29': 5 * HOUR }, new Date(2027, 1, 28)).totalHours, 0);
});

test('base and default Bonus unlock at exact thresholds with total monthly income', () => {
  assert.equal(monthSummary(daysFor(159.99), at).tier, null);
  const base = monthSummary(daysFor(160), at);
  assert.equal(base.tier, 'base'); assert.equal(base.estimatedAmount, 800); assert.equal(base.remainingHours, 40);
  const bonus = monthSummary(daysFor(200), at);
  assert.equal(bonus.tier, 'bonus-1'); assert.equal(bonus.estimatedAmount, 1600); assert.equal(bonus.progress, 1);
  assert.equal(bonus.allReached, true); assert.equal(bonus.achievedMilestone.bonusIndex, 1);
  assert.equal(monthSummary(daysFor(240), at).totalHours, 240);
  assert.equal(monthSummary(daysFor(240), new Date(2026, 10, 1)).tier, null);
});

test('three Bonus levels advance the next target and estimated income independently', () => {
  const before = monthSummary(daysFor(199.99), at, { bonuses });
  assert.equal(before.tier, 'base'); assert.equal(before.targetMilestone.id, 'bonus-1'); assert.equal(before.targetAmount, 1600);
  for (const [index, bonus] of bonuses.entries()) {
    const reached = monthSummary(daysFor(bonus.hours), at, { bonuses });
    assert.equal(reached.tier, bonus.id); assert.equal(reached.estimatedAmount, bonus.amount);
    assert.deepEqual(reached.reachedMilestones, ['base', ...bonuses.slice(0, index + 1).map(item => item.id)]);
    assert.equal(reached.targetMilestone.id, bonuses[Math.min(index + 1, 2)].id);
    assert.equal(reached.allReached, index === 2);
  }
  const between = monthSummary(daysFor(220), at, { bonuses });
  assert.equal(between.targetHours, 240); assert.equal(between.remainingHours, 20); assert.equal(between.targetAmount, 2000);
  assert.equal(between.estimatedAmount, 1600); assert.equal(between.bonusReached, true);
  const final = monthSummary(daysFor(300), at, { bonuses });
  assert.equal(final.targetHours, 280); assert.equal(final.remainingHours, 0); assert.equal(final.progress, 1);
});

test('two decimal hour thresholds unlock on the exact millisecond', () => {
  const config = { baseHours: 1.11, baseAmount: 1, bonuses: [{ id: 'custom', hours: 2.22, amount: 2 }] };
  const baseMs = 3996000, bonusMs = 7992000;
  assert.equal(monthSummary({ '2026-10-24': baseMs - 1 }, at, config).tier, null);
  assert.equal(monthSummary({ '2026-10-24': baseMs }, at, config).tier, 'base');
  assert.equal(monthSummary({ '2026-10-24': bonusMs - 1 }, at, config).tier, 'base');
  assert.equal(monthSummary({ '2026-10-24': bonusMs }, at, config).tier, 'custom');
});

test('disabled Bonus retains configured tiers and an empty list uses only the base goal', () => {
  const config = normalizeMonthlyGoals({ baseHours: 12.5, baseAmount: 90.5, bonuses, bonusEnabled: false });
  const summary = monthSummary(daysFor(300), at, config);
  assert.equal(summary.tier, 'base'); assert.equal(summary.targetHours, 12.5); assert.equal(summary.estimatedAmount, 90.5);
  assert.deepEqual(summary.bonuses, bonuses); assert.equal(summary.milestones.length, 1); assert.equal(summary.allReached, true);
  const baseOnly = monthSummary(daysFor(160), at, { bonuses: [] });
  assert.equal(baseOnly.tier, 'base'); assert.equal(baseOnly.bonusReached, false); assert.equal(baseOnly.targetAmount, 800);
});

test('malformed, duplicate, unordered and decreasing-income goals cannot be persisted', () => {
  const invalid = [null, [], { baseHours: 0 }, { baseHours: Infinity }, { bonusHours: 160 }, { baseAmount: -1 },
    { bonusAmount: 700 }, { bonusHours: null }, { bonusAmount: undefined }, { baseHours: 1.001 }, { bonusEnabled: 'yes' },
    { currency: 'invalid' }, { celebrations: 1 }, { unknown: true }, { bonuses: null }, { bonuses: [null] },
    { bonuses: new Array(1) }, { bonuses: [{ ...bonuses[0], id: 'base' }] },
    { bonuses: [{ ...bonuses[0], id: 'bad id' }] }, { bonuses: [{ ...bonuses[0], id: 'x'.repeat(129) }] },
    { bonuses: [{ hours: 200, amount: 1600 }] }, { bonuses: [{ ...bonuses[0], hours: 744.01 }] },
    { bonuses: [{ ...bonuses[0], amount: 1600.001 }] }, { bonuses: [{ ...bonuses[0], other: true }] },
    { bonuses: [bonuses[0], { ...bonuses[1], id: 'bonus-1' }] }, { bonuses: [bonuses[1], bonuses[0]] },
    { bonuses: [bonuses[0], { ...bonuses[1], hours: 200 }] }, { bonuses: [bonuses[0], { ...bonuses[1], amount: 1599 }] },
    { bonuses, bonusHours: 200 }];
  for (const config of invalid) assert.throws(() => normalizeMonthlyGoals(config), JSON.stringify(config));
  const disabled = normalizeMonthlyGoals({ bonusEnabled: false, bonuses: [bonuses[1], bonuses[0]] });
  assert.throws(() => normalizeMonthlyGoals({ ...disabled, bonusEnabled: true }));
  assert.throws(() => normalizeMonthlyGoals({ bonusEnabled: false, bonuses: [{ ...bonuses[0], amount: -1 }] }));
});

test('defaults and incoming tiers are copied so edits cannot change another configuration', () => {
  const first = normalizeMonthlyGoals(), second = normalizeMonthlyGoals();
  first.bonuses[0].hours = 220; first.bonuses.push(bonuses[1]);
  assert.equal(second.bonuses[0].hours, 200); assert.equal(second.bonuses.length, 1);
  assert.equal(DEFAULT_MONTHLY_GOALS.bonuses[0].hours, 200);
  const source = { bonuses: bonuses.map(bonus => ({ ...bonus })) }, normalized = normalizeMonthlyGoals(source);
  source.bonuses[0].amount = 1;
  assert.equal(normalized.bonuses[0].amount, 1600);
});

test('legacy single-Bonus settings migrate while preserving custom values and preferences', () => withDirectory(directory => {
  const store = new SettingsStore(directory), original = store.load();
  original.theme = 'sand'; original.language = 'en'; original.launchAtLogin = false;
  original.monthlyGoals = { baseHours: 120.5, baseAmount: 900.25, bonusEnabled: false, bonusHours: 180.25,
    bonusAmount: 1700.5, currency: 'CNY', celebrations: false };
  fs.writeFileSync(store.file, JSON.stringify(original));
  const loaded = store.load();
  assert.equal(loaded.theme, 'sand'); assert.equal(loaded.language, 'en'); assert.equal(loaded.launchAtLogin, false);
  assert.deepEqual(loaded.monthlyGoals.bonuses, [{ id: 'bonus-1', hours: 180.25, amount: 1700.5 }]);
  assert.equal(loaded.monthlyGoals.baseHours, 120.5); assert.equal(loaded.monthlyGoals.baseAmount, 900.25);
  assert.equal(loaded.monthlyGoals.bonusEnabled, false); assert.equal(loaded.monthlyGoals.celebrations, false);
  assert.equal(loaded.monthlyGoals.bonusHours, undefined);
  const patched = patchSettings(loaded, { monthlyGoals: { ...loaded.monthlyGoals, bonusEnabled: true, bonuses } }); store.save(patched);
  assert.deepEqual(store.load().monthlyGoals.bonuses, bonuses);
  assert.equal(loaded.monthlyGoals.bonuses.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(store.file)).monthlyGoals.bonusHours, undefined);
  assert.throws(() => patchSettings(loaded, { monthlyGoals: { bonusHours: 100 } }));
  delete original.monthlyGoals; fs.writeFileSync(store.file, JSON.stringify(original));
  assert.equal(store.load().monthlyGoals.baseAmount, 800);
}));

test('milestone reminders persist across restarts, skip crossed tiers and reset each month', () => withDirectory(directory => {
  let store = new MonthlyNoticeStore(directory);
  const base = monthSummary(daysFor(160), at, { bonuses });
  const first = monthSummary(daysFor(200), at, { bonuses }), highest = monthSummary(daysFor(280), at, { bonuses });
  assert.equal(store.pending(base).tier, 'base'); store.mark(base);
  store = new MonthlyNoticeStore(directory); assert.equal(store.pending(base), null);
  assert.equal(store.pending(first).tier, 'bonus-1'); store.mark(first);
  assert.equal(store.pending(highest).tier, 'bonus-3'); store.mark(store.pending(highest));
  store = new MonthlyNoticeStore(directory); assert.equal(store.pending(highest), null);
  assert.equal(store.pending(first), null); assert.equal(store.pending(base), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file))['2026-10'], ['base', 'bonus-1', 'bonus-2', 'bonus-3']);
  assert.equal(store.pending({ ...base, month: '2026-11' }).tier, 'base');
  assert.equal(store.pending({ ...base, month: '2026-11', celebrations: false }), null);
  const directJump = { ...highest, month: '2026-12' };
  assert.equal(store.pending(directJump).tier, 'bonus-3'); store.mark(directJump);
  assert.equal(store.pending({ ...first, month: '2026-12' }), null);
}));

test('reminder IDs survive edits and deletion while newly added achieved tiers can celebrate', () => withDirectory(directory => {
  const store = new MonthlyNoticeStore(directory);
  store.mark(monthSummary(daysFor(280), at, { bonuses }));
  const edited = bonuses.map(bonus => ({ ...bonus, hours: bonus.hours - 10 }));
  assert.equal(store.pending(monthSummary(daysFor(280), at, { bonuses: edited })), null);
  const added = { id: 'new-middle', hours: 220, amount: 1800 };
  const expanded = monthSummary(daysFor(280), at, { bonuses: [bonuses[0], added, ...bonuses.slice(1)] });
  const pending = store.pending(expanded);
  assert.equal(pending.tier, 'new-middle'); assert.equal(pending.estimatedAmount, 1800); assert.equal(pending.achievedMilestone.id, 'new-middle');
  store.mark(pending); assert.equal(new MonthlyNoticeStore(directory).pending(expanded), null);
  assert.equal(store.pending(monthSummary(daysFor(280), at, { bonuses: bonuses.slice(1) })), null);
  assert.equal(store.pending(monthSummary(daysFor(280), at, { bonuses })), null);
}));

test('legacy reminder history preserves previously seen Bonus and allows new levels', () => withDirectory(directory => {
  const file = path.join(directory, 'monthly-notices.json');
  fs.writeFileSync(file, JSON.stringify({ '2026-10': 'bonus', '2026-09': 'base' }));
  const store = new MonthlyNoticeStore(directory);
  assert.deepEqual(store.seen['2026-10'], ['base', 'bonus-1']);
  assert.equal(store.pending(monthSummary(daysFor(200), at, { bonuses })), null);
  const second = monthSummary(daysFor(240), at, { bonuses });
  assert.equal(store.pending(second).tier, 'bonus-2'); store.mark(second);
  assert.equal(new MonthlyNoticeStore(directory).pending(second), null);
}));

test('damaged notice primary recovers from a valid backup and preserves it on the next write', () => withDirectory(directory => {
  const file = path.join(directory, 'monthly-notices.json');
  fs.writeFileSync(file, JSON.stringify({ '2026-10': ['base', null] }));
  fs.writeFileSync(`${file}.bak`, JSON.stringify({ '2026-10': 'base' }));
  const store = new MonthlyNoticeStore(directory), summary = monthSummary(daysFor(240), at, { bonuses });
  assert.equal(store.pending(monthSummary(daysFor(160), at, { bonuses })), null);
  store.mark(store.pending(summary));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`)), { '2026-10': ['base'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file))['2026-10'], ['base', 'bonus-1', 'bonus-2']);
}));
