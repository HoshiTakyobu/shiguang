const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { dayKey, HOUR } = require('../src/clock.cjs');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-ui-test-'));
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const now = new Date();
const year = now.getFullYear(), month = now.getMonth();
const today = dayKey(now);
const days = {};
for (let day = 1; day < now.getDate(); day++) {
  const date = new Date(year, month, day, 12);
  if (![0, 6].includes(date.getDay())) days[dayKey(date)] = [8.25, 7.4, 8, 3.2, 6.75][day % 5] * HOUR;
}
days[today] = 2.5 * HOUR;
const priorMonth = dayKey(new Date(year, month, 0));
days[priorMonth] = 3 * HOUR;
fs.writeFileSync(path.join(dataDir, 'worklog.json'), JSON.stringify({ version: 1, days, activeSince: null }));
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ x: 250, y: 200 }));
const errors = [];
let app;

async function launch(expectedStatus = '下班啦') {
  const env = { ...process.env, SHIGUANG_TEST: '1', SHIGUANG_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.SHIGUANG_EXECUTABLE ? { executablePath: process.env.SHIGUANG_EXECUTABLE } : { args: [root] };
  app = await electron.launch({ ...options, env });
  app.on('window', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  });
  const orb = await app.firstWindow();
  await orb.waitForLoadState('domcontentloaded');
  await expect(orb.locator('#status')).toHaveText(expectedStatus);
  return orb;
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(() => {
    const content = document.querySelector('.content');
    const bad = [...document.querySelectorAll('.stat, .calendar-card, .week-row')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className);
    return { horizontal: document.documentElement.scrollWidth > window.innerWidth, bad, footerVisible: document.querySelector('footer').getBoundingClientRect().bottom <= window.innerHeight };
  });
  assert.equal(overflow.horizontal, false);
  assert.deepEqual(overflow.bad, []);
  return overflow;
}

async function chooseOrb(orb, choice, screenshot) {
  const opened = app.waitForEvent('window');
  await orb.locator('#orb').click({ force: true });
  const bubble = await opened;
  await bubble.waitForLoadState('domcontentloaded');
  await expect(bubble.locator(choice)).toBeVisible();
  if (screenshot) await bubble.screenshot({ path: path.join(output, screenshot), omitBackground: true });
  await bubble.locator(choice).click();
  await expect.poll(() => bubble.isClosed()).toBe(true);
}

(async () => {
  try {
    const orb = await launch();
    const clickDelay = await orb.evaluate(async () => (await window.shiguang.getState()).doubleClickMs);
    await expect(orb.locator('#time')).toHaveText('02:30:00');
    await expect(orb.locator('#action')).toHaveText('签到');
    const orbBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('工作球')).getBounds());
    assert.equal(orbBounds.width, 208);
    await orb.screenshot({ path: path.join(output, 'orb-blue.png'), omitBackground: true });

    // The entire ball responds, including a point outside the text.
    await orb.locator('#orb').click({ position: { x: 16, y: 88 }, force: true });
    await expect(orb.locator('#status')).toHaveText('上班中', { timeout: clickDelay + 2500 });
    await expect(orb.locator('#orb')).toHaveClass(/working/);
    const signedIn = await orb.evaluate(() => window.shiguang.getState());
    await expect.poll(async () => (await orb.evaluate(() => window.shiguang.getState())).days[today], { timeout: 5000 }).toBeGreaterThan(signedIn.days[today] + 1000);
    await orb.screenshot({ path: path.join(output, 'orb-green.png'), omitBackground: true });
    await chooseOrb(orb, '#pause-resume', 'action-bubble.png');
    await expect(orb.locator('#status')).toHaveText('已暂停');
    const paused = await orb.evaluate(() => window.shiguang.getState());
    await orb.waitForTimeout(1100);
    assert.equal((await orb.evaluate(() => window.shiguang.getState())).days[today], paused.days[today]);
    await orb.screenshot({ path: path.join(output, 'orb-paused.png'), omitBackground: true });
    await chooseOrb(orb, '#pause-resume');
    await expect(orb.locator('#status')).toHaveText('上班中');

    // Double click opens the calendar without firing a pending single click.
    const calendarPromise = app.waitForEvent('window');
    await orb.locator('#orb').dblclick({ force: true });
    const calendar = await calendarPromise;
    await calendar.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('日历')).setSize(1000, 850));
    await calendar.evaluate(() => document.fonts.ready);
    await expect(calendar.locator('#month-title')).toHaveText(`${year} 年 ${String(month + 1).padStart(2, '0')} 月`);
    await orb.waitForTimeout(clickDelay + 150);
    await expect(orb.locator('#status')).toHaveText('上班中');
    await calendar.screenshot({ path: path.join(output, 'calendar-initial.png'), omitBackground: true });
    const overflow = await assertNoOverflow(calendar);
    if (!overflow.footerVisible) console.log(await calendar.evaluate(() => ({ innerHeight, contentHeight: document.querySelector('.content').clientHeight, scrollHeight: document.querySelector('.content').scrollHeight, footer: document.querySelector('footer').getBoundingClientRect().toJSON() })));
    assert.equal(overflow.footerVisible, true);
    const firstDate = await calendar.locator('.day').first().getAttribute('data-date');
    assert.equal(new Date(`${firstDate}T12:00:00`).getDay(), 1);
    const weekKeys = await calendar.locator('.dates-row').first().locator('.day').evaluateAll(els => els.map(el => el.dataset.date));
    const weeklyExpected = weekKeys.reduce((sum, key) => sum + (days[key] || 0), 0) / HOUR;
    await expect(calendar.locator('.week-total strong').first()).toHaveText(weeklyExpected.toFixed(1).replace(/\.0$/, ''));
    const complete = calendar.locator('.day.complete').first();
    if (await complete.count()) {
      await expect(complete.locator('.ring-progress')).toHaveAttribute('stroke', 'rgb(117, 212, 151)');
      const dash = await complete.locator('.ring-progress').getAttribute('stroke-dasharray');
      const [filled, full] = dash.split(' ').map(Number);
      assert.equal(filled, full);
    }
    assert.equal(await calendar.locator('#detail-text').count(), 0);
    assert.equal(await calendar.locator('.ring-track').count(), 0);
    const smallText = await calendar.locator('.brand-caption, .week-heading, .weekday, .legend, footer').evaluateAll(elements => elements.map(el => ({ size: parseFloat(getComputedStyle(el).fontSize), family: getComputedStyle(el).fontFamily })));
    assert.ok(smallText.every(text => text.size >= 13 && text.family.includes('Noto Sans SC')));
    const emptyDate = await calendar.locator('.day:not(.has-work):not(.is-future)').first().getAttribute('data-date');
    await expect(calendar.locator(`[data-date="${emptyDate}"] svg`)).toHaveCSS('visibility', 'hidden');
    await calendar.screenshot({ path: path.join(output, 'calendar-preview.png'), omitBackground: true });

    // Supplement and correct historical records using the date entry point.
    await calendar.locator(`[data-date="${emptyDate}"]`).click();
    await expect(calendar.locator('#edit-dialog')).toBeVisible();
    await calendar.locator('#edit-hours').fill('2');
    await calendar.locator('#edit-minutes').fill('30');
    await calendar.screenshot({ path: path.join(output, 'edit-preview.png'), omitBackground: true });
    await calendar.locator('#save-edit').click();
    await expect(calendar.locator('#edit-dialog')).not.toBeVisible();
    await expect(calendar.locator(`[data-date="${emptyDate}"]`)).toHaveClass(/has-work/);
    assert.equal((await calendar.evaluate(() => window.shiguang.getState())).days[emptyDate], 2.5 * HOUR);
    await calendar.locator(`[data-date="${emptyDate}"]`).click();
    await calendar.locator('input[value="replace"]').check();
    await calendar.locator('#edit-hours').fill('1');
    await calendar.locator('#edit-minutes').fill('45');
    await calendar.locator('#save-edit').click();
    await expect(calendar.locator('#edit-dialog')).not.toBeVisible();
    assert.equal((await calendar.evaluate(() => window.shiguang.getState())).days[emptyDate], 1.75 * HOUR);

    // Adding work to today preserves the live timer.
    const beforeAddition = await calendar.evaluate(() => window.shiguang.getState());
    await calendar.locator('#add-time').click();
    await calendar.locator('#edit-minutes').fill('30');
    await calendar.locator('#save-edit').click();
    await expect(calendar.locator('#edit-dialog')).not.toBeVisible();
    const afterAddition = await calendar.evaluate(() => window.shiguang.getState());
    assert.ok(afterAddition.days[today] >= beforeAddition.days[today] + .5 * HOUR);
    assert.equal(afterAddition.active, true);

    const settingsPromise = app.waitForEvent('window');
    await calendar.locator('#open-settings').click();
    const settingsPage = await settingsPromise;
    await settingsPage.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('设置')).setSize(850, 720));
    await expect(settingsPage.locator('#author')).toHaveText('Hoshi Takyobu');
    await expect(settingsPage.locator('#launch-at-login')).toBeChecked();
    await settingsPage.locator('#launch-at-login').uncheck();
    await expect.poll(async () => (await settingsPage.evaluate(() => window.shiguang.getSettings())).launchAtLogin).toBe(false);
    for (const theme of ['slate', 'sand', 'spring', 'slate']) {
      await settingsPage.locator(`[data-theme-choice="${theme}"]`).click();
      await expect(orb.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(calendar.locator('html')).toHaveAttribute('data-theme', theme);
    }
    await settingsPage.screenshot({ path: path.join(output, 'settings-general.png'), omitBackground: true });
    await settingsPage.locator('#language').selectOption('en');
    await expect(calendar.locator('html')).toHaveAttribute('lang', 'en');
    await expect(calendar.locator('h1')).toContainText('Let your days glow');
    await expect(orb.locator('#status')).toHaveText('Working');
    await settingsPage.locator('#week-start').selectOption('0');
    await expect(calendar.locator('.weekday').first()).toHaveText('Sun');
    const sundayKeys = await calendar.locator('.dates-row').first().locator('.day').evaluateAll(els => els.map(el => el.dataset.date));
    assert.equal(new Date(`${sundayKeys[0]}T12:00:00`).getDay(), 0);
    const sundayState = await calendar.evaluate(() => window.shiguang.getState());
    const sundayTotal = sundayKeys.reduce((sum, key) => sum + (sundayState.days[key] || 0), 0) / HOUR;
    await expect(calendar.locator('.week-total strong').first()).toHaveText(sundayTotal.toFixed(1).replace(/\.0$/, ''));
    await assertNoOverflow(calendar);
    await calendar.screenshot({ path: path.join(output, 'calendar-english.png'), omitBackground: true });
    await settingsPage.screenshot({ path: path.join(output, 'settings-english.png'), omitBackground: true });
    for (const start of ['2', '3', '4', '5', '6', '1']) {
      await settingsPage.locator('#week-start').selectOption(start);
      await expect.poll(async () => new Date(`${await calendar.locator('.day').first().getAttribute('data-date')}T12:00:00`).getDay()).toBe(Number(start));
    }
    await settingsPage.locator('#language').selectOption('zh-CN');
    await expect(orb.locator('#status')).toHaveText('上班中');
    await settingsPage.locator('[data-tab="work"]').click();
    await settingsPage.locator('#target-hours').fill('0');
    await settingsPage.locator('#target-minutes').fill('0');
    await settingsPage.locator('#save-target').click();
    await expect(settingsPage.locator('#settings-error')).toBeVisible();
    assert.equal((await calendar.evaluate(() => window.shiguang.getState())).target, 8 * HOUR);
    await settingsPage.locator('#target-hours').fill('6');
    await settingsPage.locator('#target-minutes').fill('30');
    await settingsPage.locator('#save-target').click();
    await expect(settingsPage.locator('#settings-error')).not.toBeVisible();
    await expect(calendar.locator('#legend-target')).toHaveText('390min');
    const changedTarget = await calendar.evaluate(() => window.shiguang.getState());
    assert.equal(changedTarget.target, 6.5 * HOUR);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    await expect(calendar.locator('#completed-days')).toHaveText(String(Object.entries(changedTarget.days).filter(([key, ms]) => key.startsWith(monthPrefix) && ms >= 6.5 * HOUR).length));
    await settingsPage.screenshot({ path: path.join(output, 'settings-work.png'), omitBackground: true });

    // The native picker result is supplied by the test; no user folder is touched.
    const movedDirectory = path.join(dataDir, 'moved-records');
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, movedDirectory);
    await settingsPage.locator('[data-tab="advanced"]').click();
    await settingsPage.locator('#change-directory').click();
    await expect(settingsPage.locator('#data-directory')).toHaveText(movedDirectory);
    assert.ok(fs.existsSync(path.join(dataDir, 'worklog.json')));
    assert.ok(fs.existsSync(path.join(movedDirectory, 'worklog.json')));
    const exportPath = path.join(dataDir, 'export.json');
    await app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }); }, exportPath);
    await settingsPage.locator('#export-data').click();
    await expect(settingsPage.locator('#settings-feedback')).toHaveText('工时备份已导出');
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.equal(exported.days[emptyDate], 1.75 * HOUR);
    assert.equal(exported.activeSince, null);
    await settingsPage.screenshot({ path: path.join(output, 'settings-advanced.png'), omitBackground: true });
    await settingsPage.locator('#close-settings').click();

    await calendar.locator('#previous-month').click();
    const previous = new Date(year, month - 1, 1);
    await expect(calendar.locator('#month-title')).toHaveText(`${previous.getFullYear()} 年 ${String(previous.getMonth() + 1).padStart(2, '0')} 月`);
    await calendar.locator('#go-today').click();
    await expect(calendar.locator('#month-title')).toHaveText(`${year} 年 ${String(month + 1).padStart(2, '0')} 月`);

    // A six-row month remains usable at the default and minimum sizes.
    const deltaToMarch = (month - 2 + 12) % 12;
    for (let i = 0; i < deltaToMarch; i++) await calendar.locator('#previous-month').click();
    const sixRowLayout = await assertNoOverflow(calendar);
    assert.equal(sixRowLayout.footerVisible, true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('日历')).setSize(800, 700));
    await assertNoOverflow(calendar);
    await calendar.screenshot({ path: path.join(output, 'calendar-compact.png'), omitBackground: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('日历')).setSize(1000, 850));

    // Reopening an existing calendar always resets to the actual current month.
    await orb.evaluate(() => window.shiguang.openCalendar());
    await expect(calendar.locator('#month-title')).toHaveText(`${year} 年 ${String(month + 1).padStart(2, '0')} 月`);
    await calendar.locator('#close').click();
    await expect.poll(async () => app.windows().length).toBe(1);
    await expect(orb.locator('#status')).toHaveText('上班中');

    // Browser pointer events verify the drag/click guard without clicking another desktop app.
    await orb.mouse.move(104, 104);
    await orb.mouse.down();
    await orb.mouse.move(139, 139, { steps: 5 });
    await orb.mouse.up();
    await orb.waitForTimeout(clickDelay + 150);
    await expect(orb.locator('#status')).toHaveText('上班中');
    const draggedPosition = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('工作球')).getPosition());

    await chooseOrb(orb, '#clock-out');
    await expect(orb.locator('#status')).toHaveText('下班啦');
    const stopped = await orb.evaluate(() => window.shiguang.getState());
    await orb.waitForTimeout(1100);
    assert.equal((await orb.evaluate(() => window.shiguang.getState())).days[today], stopped.days[today]);
    await app.close();
    app = null;
    const reopened = await launch();
    const restored = await reopened.evaluate(() => window.shiguang.getState());
    assert.equal(restored.days[today], stopped.days[today]);
    assert.equal(restored.active, false);
    assert.equal(restored.settings.theme, 'slate');
    assert.equal(restored.target, 6.5 * HOUR);
    const restoredSettings = await reopened.evaluate(() => window.shiguang.getSettings());
    assert.equal(restoredSettings.dataDirectory, movedDirectory);
    assert.equal(restoredSettings.launchAtLogin, false);
    const restoredPosition = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('工作球')).getPosition());
    assert.deepEqual(restoredPosition, draggedPosition);
    // Exercise the actual BrowserWindow resizing and IPC while supplying cursor
    // positions in-process, so the test never moves or clicks the user's mouse.
    await reopened.evaluate(() => window.shiguang.setMode('working'));
    await chooseOrb(reopened, '#pause-resume');
    await expect(reopened.locator('#status')).toHaveText('已暂停');
    const beforeDock = await reopened.evaluate(() => window.shiguang.getState());
    async function dockOrb(side) {
      await app.evaluate(({ BrowserWindow, ipcMain, screen }, side) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/orb.html'));
        const b = win.getBounds(), area = screen.getDisplayMatching(b).workArea;
        let cursor = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        screen.getCursorScreenPoint = () => cursor;
        ipcMain.emit('orb:drag-start', { sender: win.webContents });
        cursor = { x: side === 'left' ? area.x + 1 : area.x + area.width - 1, y: area.y + 300 };
        ipcMain.emit('orb:drag-move', { sender: win.webContents });
        ipcMain.emit('orb:drag-end', { sender: win.webContents });
      }, side);
      await expect(reopened.locator('html')).toHaveAttribute('data-dock', side);
      const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      assert.equal(bounds.width, 32); assert.equal(bounds.height, 100);
      await expect(reopened.locator('#orb')).toHaveCSS('width', '80px');
    }
    await dockOrb('left');
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: 10000, y: -10000 }); });
    await expect.poll(() => reopened.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--look-x')))).toBeGreaterThan(0);
    await expect.poll(() => reopened.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--look-y')))).toBeLessThan(0);
    await reopened.screenshot({ path: path.join(output, 'peek-left.png'), omitBackground: true });
    await reopened.mouse.click(10, 50);
    await expect(reopened.locator('html')).toHaveAttribute('data-dock', '');
    assert.equal((await reopened.evaluate(() => window.shiguang.getState())).mode, 'paused');
    await dockOrb('right');
    await reopened.screenshot({ path: path.join(output, 'peek-right.png'), omitBackground: true });
    await app.close(); app = null;
    const pausedAgain = await launch('已暂停');
    await expect(pausedAgain.locator('html')).toHaveAttribute('data-dock', 'right');
    const afterDock = await pausedAgain.evaluate(() => window.shiguang.getState());
    assert.equal(afterDock.mode, 'paused');
    assert.equal(afterDock.days[today], beforeDock.days[today]);
    assert.deepEqual(errors, []);
    console.log('PASS: pause/resume bubbles, break persistence, both screen edges, mini orb and gaze, restore without clocking in, bilingual UI, all week starts, edits, data migration, and existing orb/calendar behavior; no renderer errors.');
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(path.join(os.tmpdir(), 'shiguang-ui-test-'))) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
