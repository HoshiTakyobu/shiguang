const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WorkClock, dayKey } = require('../src/clock.cjs');
const { SettingsStore, patchSettings } = require('../src/settings.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-monthly-native-'));
const today = dayKey(Date.now()), state = new WorkClock(); state.adjustDay({ date: today, mode: 'replace', milliseconds: 3.9 * 3600000 });
fs.writeFileSync(path.join(data, 'worklog.json'), JSON.stringify(state.checkpoint()));
const store = new SettingsStore(data); store.save(patchSettings(store.load(), { monthlyGoals: { baseHours: 4,
  bonuses: [{ id: 'bonus-1', hours: 6, amount: 1600 }, { id: 'bonus-2', hours: 8, amount: 2200 }, { id: 'bonus-3', hours: 10, amount: 3000 }] } }));
let app;
async function windowFor(file) { await expect.poll(() => app.windows().some(page => page.url().includes(file))).toBe(true); return app.windows().find(page => page.url().includes(file)); }
async function launch() {
  const env = { ...process.env, SHIGUANG_TEST: '1', SHIGUANG_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.SHIGUANG_EXECUTABLE ? { executablePath: process.env.SHIGUANG_EXECUTABLE } : { args: [root] }), env });
  const orb = await app.firstWindow(); await expect(orb.locator('#status')).toHaveText('下班啦');
  return orb;
}
async function closeCelebration(page) { await page.evaluate(() => window.shiguang.closeCelebration()); await expect.poll(() => page.isClosed()).toBe(true); }
(async () => {
  try {
    const orb = await launch();
    await orb.evaluate(() => window.shiguang.openCalendar()); const calendar = await windowFor('calendar.html');
    await expect(calendar.locator('#month-total')).toHaveText('3.9');
    await expect(calendar.locator('#monthly-milestones > span')).toHaveCount(4);
    await expect(calendar.locator('#monthly-remaining')).toContainText('0.10');
    assert.equal((await calendar.evaluate(today => window.shiguang.adjustDay({ date: today, mode: 'replace', milliseconds: 4 * 3600000 }), today)).ok, true);
    let celebration = await windowFor('celebration.html');
    await expect(celebration.locator('#celebration-title')).toContainText('4 小时');
    await expect(celebration.locator('#reward-amount')).toHaveText('800.0');
    await closeCelebration(celebration);
    await calendar.waitForTimeout(1300); assert.equal(app.windows().some(page => page.url().includes('celebration.html')), false);
    await calendar.evaluate(today => window.shiguang.adjustDay({ date: today, mode: 'replace', milliseconds: 6 * 3600000 }), today);
    celebration = await windowFor('celebration.html'); await expect(celebration.locator('#reward-amount')).toHaveText('1600.0');
    await expect(celebration.locator('#reward-tier')).toHaveText('Bonus 1 奖励档');
    await expect(calendar.locator('#monthly-remaining')).toContainText('Bonus 2');
    await expect(calendar.locator('#monthly-income')).toContainText('2200.0');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'monthly-notices.json')))[today.slice(0, 7)], ['base', 'bonus-1']);
    await closeCelebration(celebration);
    await calendar.evaluate(today => window.shiguang.adjustDay({ date: today, mode: 'replace', milliseconds: 10 * 3600000 }), today);
    celebration = await windowFor('celebration.html');
    await expect(celebration.locator('#celebration-title')).toHaveText('10 小时，真的做到了！');
    await expect(celebration.locator('#reward-tier')).toHaveText('Bonus 3 奖励档');
    await expect(celebration.locator('#reward-amount')).toHaveText('3000.0');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'monthly-notices.json')))[today.slice(0, 7)], ['base', 'bonus-1', 'bonus-2', 'bonus-3']);
    await closeCelebration(celebration);
    for (const milliseconds of [8 * 3600000, 10 * 3600000]) {
      await calendar.evaluate(({ today, milliseconds }) => window.shiguang.adjustDay({ date: today, mode: 'replace', milliseconds }), { today, milliseconds });
      await calendar.waitForTimeout(1300); assert.equal(app.windows().some(page => page.url().includes('celebration.html')), false);
    }
    await app.close(); app = null;
    const restartedOrb = await launch(); await restartedOrb.waitForTimeout(1300);
    assert.equal(app.windows().length, 1, 'No repeated milestone after restart');
    await restartedOrb.evaluate(() => window.shiguang.openCalendar());
    const latestCalendar = await windowFor('calendar.html');
    await expect(latestCalendar.locator('#monthly-milestones > span')).toHaveCount(4);
    await restartedOrb.evaluate(() => window.shiguang.openSettings('monthly')); const settings = await windowFor('settings.html');
    await expect(settings.locator('#panel-monthly')).toBeVisible();
    const rows = settings.locator('.monthly-bonus-row');
    await expect(rows).toHaveCount(3);
    await settings.locator('#monthly-base-hours').fill('160');
    for (const [index, hours] of [200, 240, 280].entries()) await rows.nth(index).locator('[data-bonus-field="hours"]').fill(String(hours));
    await rows.nth(2).locator('.monthly-remove-bonus').click(); await expect(rows).toHaveCount(2);
    await settings.locator('#add-monthly-bonus').click(); await expect(rows).toHaveCount(3);
    await rows.nth(2).locator('[data-bonus-field="amount"]').fill('3000');
    await rows.nth(1).locator('[data-bonus-field="hours"]').fill('200');
    await settings.locator('#save-monthly').click(); await expect(settings.locator('#settings-error')).toBeVisible();
    assert.equal(store.load().monthlyGoals.baseHours, 4, 'Invalid duplicate threshold leaves saved goals intact');
    await rows.nth(1).locator('[data-bonus-field="hours"]').fill('240');
    await settings.locator('#save-monthly').click(); await expect(settings.locator('#settings-feedback')).toHaveText('月度目标已保存');
    const savedGoals = store.load().monthlyGoals;
    assert.deepEqual(savedGoals.bonuses.map(bonus => bonus.hours), [200, 240, 280]);
    assert.equal(savedGoals.bonuses[0].id, 'bonus-1'); assert.equal(savedGoals.bonuses[1].id, 'bonus-2');
    assert.notEqual(savedGoals.bonuses[2].id, 'bonus-3');
    await settings.locator('#monthly-bonus-enabled').uncheck(); await settings.locator('#save-monthly').click();
    await expect(settings.locator('#settings-feedback')).toHaveText('月度目标已保存');
    await expect(latestCalendar.locator('#monthly-milestones > span')).toHaveCount(1);
    assert.deepEqual(store.load().monthlyGoals.bonuses, savedGoals.bonuses);
    await settings.locator('#monthly-bonus-enabled').check(); await settings.locator('#save-monthly').click();
    await expect(latestCalendar.locator('#monthly-milestones > span')).toHaveCount(4);
    await settings.screenshot({ path: path.join(output, 'settings-monthly.png') });
    await settings.locator('#preview-celebration').click(); celebration = await windowFor('celebration.html');
    await expect(celebration.locator('#celebration-title')).toHaveText('280 小时，真的做到了！');
    await expect(celebration.locator('#reward-tier')).toHaveText('Bonus 3 奖励档');
    await celebration.evaluate(() => document.fonts.ready);
    assert.equal(await celebration.evaluate(() => document.fonts.check('36px FangzhengCuYuan', '小时真的做到了')), true);
    const cdp = await celebration.context().newCDPSession(celebration); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const doc = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#celebration-title' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(font => font.isCustomFont && /FZ|方正/.test(font.familyName)), JSON.stringify(fonts));
    await celebration.locator('#replay-confetti').click();
    await expect.poll(() => celebration.evaluate(() => {
      const canvas = document.querySelector('#confetti');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
    await celebration.waitForTimeout(1600);
    await celebration.screenshot({ path: path.join(output, 'monthly-celebration.png'), omitBackground: true });
    assert.equal(await celebration.evaluate(() => document.querySelector('.celebration-content').scrollHeight <= document.querySelector('.celebration-content').clientHeight + 1), true);
    await closeCelebration(celebration);
    await settings.locator('[data-tab="general"]').click();
    await settings.locator('#language').selectOption('en'); // Switch through the actual settings control.
    await settings.locator('[data-tab="monthly"]').click();
    await expect(settings.locator('#add-monthly-bonus')).toHaveText('Add Bonus');
    await expect(rows.nth(2).locator('.monthly-remove-bonus')).toHaveText('Remove');
    await settings.screenshot({ path: path.join(output, 'settings-monthly-english.png') });
    await settings.locator('#preview-celebration').click(); celebration = await windowFor('celebration.html');
    await expect(celebration.locator('#celebration-title')).toHaveText('280 hours. You did it!');
    await expect(celebration.locator('#reward-tier')).toHaveText('Bonus 3 milestone');
    await celebration.screenshot({ path: path.join(output, 'monthly-celebration-english.png'), omitBackground: true });
    await closeCelebration(celebration);
    await settings.locator('[data-tab="general"]').click(); await settings.locator('#language').selectOption('zh-CN');
    await latestCalendar.screenshot({ path: path.join(output, 'calendar-monthly.png') });
    await app.close(); app = null;
    await launch(); await app.firstWindow().then(page => page.waitForTimeout(1300));
    assert.equal(app.windows().length, 1, 'No repeated milestone after restart');
    assert.deepEqual(store.load().monthlyGoals.bonuses, savedGoals.bonuses);
    console.log('PASS: multiple Bonus tiers, add/remove/save/restart, duplicate rejection, next-tier progress/income, jump celebration, reminder persistence, disable/re-enable, preview, confetti, embedded font and bilingual native windows.');
  } finally {
    if (app) await app.close();
    if (path.dirname(data) !== path.resolve(os.tmpdir()) || !path.basename(data).startsWith('shiguang-monthly-native-')) throw new Error('Unexpected test path');
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
