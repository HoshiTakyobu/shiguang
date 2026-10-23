const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, shell, powerMonitor, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { WorkClock } = require('./clock.cjs');
const { FileStore } = require('./store.cjs');
const { saveForExit } = require('./lifecycle.cjs');
const { ShortcutManager } = require('./shortcuts.cjs');
const { SettingsStore, patchSettings, moveDataDirectory } = require('./settings.cjs');
const { StartupController, APP_ID } = require('./startup.cjs');
const { OrbWindow } = require('./orb-window.cjs');
const { acquireInstanceLock } = require('./instance-lock.cjs');
const { translate, translateError } = require('./i18n.cjs');

const testMode = process.env.SHIGUANG_TEST === '1';
app.setName('拾光');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.setPath('userData', process.env.SHIGUANG_DATA_DIR || path.join(app.getPath('appData'), '拾光'));
const hasLock = testMode || app.requestSingleInstanceLock();
let orbWindow, calendarWindow, settingsWindow, tray, clock, store, settingsStore, settings, ticker, lastSave = 0, lastBroadcast = 0, quitting = false;
let startupError = null;
let startup;
let orbLayout, actionsOpen = false, instanceLease;
let shutdownRequested = false;
let shortcuts;
const tr = (text, values) => translate(text, settings?.language, values);
const errorText = text => translateError(text, settings?.language);
let doubleClickMs = 550;
const ORB_SIZE = 208;
const preferencesFile = () => path.join(app.getPath('userData'), 'preferences.json');

function getDoubleClickTime() {
  if (process.platform !== 'win32') return 550;
  try {
    const value = execFileSync('reg.exe', ['query', 'HKCU\\Control Panel\\Mouse', '/v', 'DoubleClickSpeed'], { encoding: 'utf8', windowsHide: true, timeout: 1500 });
    const speed = Number(value.match(/DoubleClickSpeed\s+REG_SZ\s+(\d+)/)?.[1]);
    return Number.isFinite(speed) && speed > 0 ? Math.min(5000, Math.max(200, speed)) + 50 : 550;
  } catch { return 550; }
}

function snapshot() {
  return { ...clock.snapshot(), actionsOpen, target: settings.targetMinutes * 60000, settings: { theme: settings.theme, targetMinutes: settings.targetMinutes, launchAtLogin: settings.launchAtLogin, language: settings.language, weekStart: settings.weekStart }, docked: orbLayout?.side || null, doubleClickMs, storageError: storageError ? errorText(storageError) : null };
}

function startupExecutable() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function configureStartup(enabled, options) {
  if (testMode || !app.isPackaged) return;
  return startup.configure(enabled, options);
}

function settingsSnapshot() {
  const actual = !testMode && app.isPackaged ? startup.status() : null;
  return { ...settings, shortcutStatus: shortcutStatus(), appVersion: app.getVersion(), author: 'Hoshi Takyobu', applicationPath: startupExecutable(), startupError: startupError ? errorText(startupError) : null, startupEnabled: actual?.enabled ?? settings.launchAtLogin };
}

function shortcutStatus(status = shortcuts?.getStatus() || {}) {
  const messages = {
    invalid: '组合键无效，请使用 Ctrl 或 Alt 搭配按键，或使用功能键。',
    duplicate: '此快捷键与其他操作重复。',
    reserved: '此组合键由系统保留，请选择其他快捷键。',
    unavailable: '快捷键被其他程序占用或系统不允许注册，请更换组合键。',
    suspended: '录入期间快捷键已暂停。'
  };
  return Object.fromEntries(Object.entries(status).map(([action, value]) => [action, {
    ...value, error: value.error ? tr(messages[value.error] || value.error) : null
  }]));
}

function saveSettings(patch) {
  const previous = settings;
  const next = patchSettings(settings, patch);
  try {
    if ('launchAtLogin' in patch) configureStartup(next.launchAtLogin);
    if ('shortcuts' in patch) {
      shortcuts.replace(next.shortcuts, bindings => settingsStore.save({ ...next, shortcuts: bindings }));
    } else settingsStore.save(next);
    settings = next;
    if ('launchAtLogin' in patch) startupError = null;
  } catch (error) {
    if ('launchAtLogin' in patch) { try { configureStartup(previous.launchAtLogin); } catch { /* Keep the original failure. */ } }
    throw error;
  }
  broadcast();
  updateTray();
  if (orbWindow) orbWindow.setTitle(tr('拾光 · 桌面工作球'));
  if (calendarWindow) calendarWindow.setTitle(tr('拾光 · 工时日历'));
  if (settingsWindow) settingsWindow.setTitle(tr('拾光 · 设置'));
  return settingsSnapshot();
}

let storageError = null;
function persist() {
  lastSave = performance.now();
  try {
    store.save(clock.checkpoint());
    storageError = null;
    return true;
  } catch (error) {
    storageError = '工时暂未保存，请检查磁盘空间或写入权限。';
    console.error('Save failed:', error);
    return false;
  }
}

function broadcast() {
  const value = snapshot();
  for (const win of [orbWindow, calendarWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('clock:state', value);
  }
}

function toggle() {
  if (clock.snapshot().mode === 'idle') return guardedTransition('working');
  openActions();
  return snapshot();
}

function guardedTransition(mode, reason = 'manual') {
  try { return transition(mode, reason); }
  catch (error) {
    // Tray and single-click entry points have no action dialog; broadcast()
    // already exposes the save warning while the original state remains intact.
    console.error('Could not save work status:', error);
    return snapshot();
  }
}

function transition(mode, reason = 'manual') {
  if (shutdownRequested || quitting) return snapshot();
  const at = Date.now();
  const next = new WorkClock(clock.state, clock.now);
  next.setMode(mode, at, reason);
  try { store.save(next.checkpoint(at)); }
  catch (error) { storageError = '工时暂未保存，请检查磁盘空间或写入权限。'; broadcast(); throw error; }
  clock = next;
  storageError = null;
  lastSave = performance.now();
  actionsOpen = false;
  updateTray();
  broadcast();
  return snapshot();
}

function runShortcut(action) {
  if (!clock || shutdownRequested || quitting) return;
  const mode = clock.state.mode;
  if (action === 'toggleOrb') {
    actionsOpen = false;
    if (orbWindow.isVisible()) { orbWindow.hide(); updateTray(); }
    else showOrb();
    broadcast();
  } else if (action === 'clockIn' && mode === 'idle') guardedTransition('working', 'shortcut');
  else if (action === 'pause' && mode === 'working') guardedTransition('paused', 'shortcut');
  else if (action === 'resume' && mode === 'paused') guardedTransition('working', 'shortcut');
  else if (action === 'clockOut' && mode !== 'idle') guardedTransition('idle', 'shortcut');
}

function openActions() {
  actionsOpen = !actionsOpen;
  broadcast();
}

function closeActions() {
  if (!actionsOpen) return;
  actionsOpen = false;
  broadcast();
}

function safePosition(x, y) {
  const fallback = screen.getPrimaryDisplay().workArea;
  const area = Number.isFinite(x) && Number.isFinite(y)
    ? screen.getDisplayNearestPoint({ x: Math.round(x + ORB_SIZE / 2), y: Math.round(y + ORB_SIZE / 2) }).workArea
    : fallback;
  return {
    x: Math.round(Math.min(Math.max(Number.isFinite(x) ? x : area.x + area.width - ORB_SIZE - 32, area.x), area.x + area.width - ORB_SIZE)),
    y: Math.round(Math.min(Math.max(Number.isFinite(y) ? y : area.y + area.height - ORB_SIZE - 64, area.y), area.y + area.height - ORB_SIZE))
  };
}

function savePosition() {
  if (!orbWindow || orbWindow.isDestroyed()) return;
  try { fs.writeFileSync(preferencesFile(), JSON.stringify(orbLayout?.preferences() || {})); } catch (error) { console.error('Position save failed:', error); }
}

function secureWindow(options) {
  const win = new BrowserWindow({
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    ...options,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.platform === 'win32') {
    win.on('query-session-end', () => finishSystemSession());
    win.on('session-end', () => finishSystemSession());
  }
  return win;
}

function finishSystemSession() {
  if (quitting) return;
  shutdownRequested = true;
  actionsOpen = false;
  try {
    if (clock) clock = saveForExit(clock, store, { shutdown: true });
    storageError = null;
  } catch (error) {
    // Windows may force termination. The next launch closes the last saved
    // active checkpoint, so the offline gap can never become work time.
    console.error('Shutdown save failed:', error);
  }
  quitting = true;
  clearInterval(ticker);
  shortcuts?.dispose();
  savePosition();
  tray?.destroy();
  instanceLease?.release();
  app.quit();
}

function createOrb() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(preferencesFile(), 'utf8')); } catch { /* First launch. */ }
  let position = safePosition(saved.x, saved.y);
  if (['left', 'right'].includes(saved.side) && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: 32, height: 100 }).workArea;
    position = { x: saved.side === 'left' ? area.x : area.x + area.width - ORB_SIZE, y: Math.max(area.y, Math.min(saved.y, area.y + area.height - ORB_SIZE)) };
  }
  orbWindow = secureWindow({
    ...position,
    width: ORB_SIZE, height: ORB_SIZE,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, minimizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    title: tr('拾光 · 桌面工作球')
  });
  orbWindow.setAlwaysOnTop(true, 'floating');
  orbWindow.setVisibleOnAllWorkspaces(true);
  orbLayout = new OrbWindow(orbWindow, screen, saved);
  orbWindow.loadFile(path.join(__dirname, 'renderer/orb.html'));
  orbWindow.once('ready-to-show', () => orbWindow.showInactive());
  orbWindow.on('blur', closeActions);
  orbWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); orbWindow.hide(); updateTray(); }
  });
}

function openCalendar() {
  closeActions();
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    calendarWindow.webContents.send('calendar:reset');
    if (calendarWindow.isMinimized()) calendarWindow.restore();
    calendarWindow.show();
    calendarWindow.focus();
    return;
  }
  const area = screen.getDisplayMatching(orbWindow.getBounds()).workArea;
  calendarWindow = secureWindow({
    width: Math.min(1000, area.width), height: Math.min(850, area.height),
    minWidth: Math.min(800, area.width), minHeight: Math.min(700, area.height),
    x: Math.round(area.x + Math.max(0, (area.width - 1000) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - 850) / 2)),
    frame: false, transparent: true, backgroundColor: '#00000000',
    title: tr('拾光 · 工时日历'), hasShadow: true
  });
  calendarWindow.loadFile(path.join(__dirname, 'renderer/calendar.html'));
  calendarWindow.once('ready-to-show', () => calendarWindow.show());
  calendarWindow.on('closed', () => { calendarWindow = null; });
}

function openSettings(tab = 'general') {
  closeActions();
  const selected = ['general', 'work', 'shortcuts', 'advanced'].includes(tab) ? tab : 'general';
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:tab', selected);
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show(); settingsWindow.focus();
    return;
  }
  const area = screen.getDisplayMatching(orbWindow.getBounds()).workArea;
  settingsWindow = secureWindow({
    width: Math.min(850, area.width), height: Math.min(720, area.height),
    minWidth: Math.min(760, area.width), minHeight: Math.min(620, area.height),
    frame: false, transparent: true, backgroundColor: '#00000000',
    title: tr('拾光 · 设置'), hasShadow: true
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer/settings.html'), { query: { tab: selected } });
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('blur', () => shortcuts?.resume());
  settingsWindow.on('closed', () => { shortcuts?.resume(); settingsWindow = null; });
}

function showOrb() {
  orbLayout.restore();
  orbLayout.ensureVisible();
  orbWindow.showInactive();
  updateTray();
}

function menuTemplate() {
  const mode = clock.snapshot().mode;
  return [
    ...(mode === 'working' ? [{ label: tr('临时离开'), click: () => guardedTransition('paused') }] : [{ label: tr(mode === 'paused' ? '继续工作' : '签到'), click: () => guardedTransition('working') }]),
    ...(mode !== 'idle' ? [{ label: tr('签退'), click: () => guardedTransition('idle') }] : []),
    { label: tr('打开工时日历'), click: openCalendar },
    { label: tr('设置'), click: () => openSettings() },
    { type: 'separator' },
    { label: tr(orbWindow.isVisible() ? '隐藏工作球' : '显示工作球'), click: () => { if (orbWindow.isVisible()) orbWindow.hide(); else showOrb(); updateTray(); } },
    { label: tr('让工作球回到主屏幕'), click: () => { orbLayout.restore(); const position = safePosition(); orbWindow.setPosition(position.x, position.y); showOrb(); savePosition(); } },
    { label: tr('打开数据文件夹'), click: () => shell.openPath(settings.dataDirectory) },
    { type: 'separator' },
    { label: tr(clock.snapshot().active ? '签退并退出' : '退出拾光'), click: () => app.quit() }
  ];
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`${tr('拾光')} · ${tr({ working: '上班中', paused: '已暂停', idle: '下班啦' }[clock.snapshot().mode])}`);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function attachIPC() {
  const fromOrb = (event) => event.sender === orbWindow?.webContents;
  const fromCalendar = (event) => event.sender === calendarWindow?.webContents;
  const fromSettings = (event) => event.sender === settingsWindow?.webContents;
  const fromApp = (event) => fromOrb(event) || fromCalendar(event) || fromSettings(event);
  ipcMain.handle('clock:get', (event) => fromApp(event) ? snapshot() : null);
  ipcMain.handle('translations:get', event => fromApp(event) ? require('./locales/en.json') : {});
  ipcMain.handle('clock:toggle', (event) => fromApp(event) ? toggle() : null);
  const handleAction = (channel, allowed, action) => ipcMain.handle(channel, async (event, value) => {
    if (!allowed(event)) return { ok: false, error: tr('无效的窗口来源') };
    try { return { ok: true, value: await action(event, value) }; }
    catch (error) { return { ok: false, error: error.status ? tr('快捷键未保存，请处理冲突后重试。') : errorText(error.message || '操作未完成，请重试。'), ...(error.status ? { shortcutStatus: shortcutStatus(error.status) } : {}) }; }
  });
  handleAction('clock:set-mode', fromApp, (_event, mode) => transition(mode));
  handleAction('clock:day-details', fromCalendar, (_event, date) => clock.getDayDetails(date));
  ipcMain.on('actions:close', event => { if (fromOrb(event)) closeActions(); });
  ipcMain.handle('orb:activate', event => {
    if (!fromOrb(event)) return null;
    if (orbLayout.side) { orbLayout.restore(); savePosition(); return snapshot(); }
    return toggle();
  });
  handleAction('clock:adjust', fromCalendar, (_event, correction) => {
    const at = Date.now();
    const edited = new WorkClock(clock.state);
    edited.adjustDay(correction, at);
    store.save(edited.checkpoint(at));
    clock = edited;
    storageError = null;
    lastSave = performance.now();
    broadcast();
    return snapshot();
  });
  ipcMain.handle('settings:get', (event) => fromApp(event) ? settingsSnapshot() : null);
  handleAction('settings:save', fromSettings, (_event, patch) => saveSettings(patch));
  handleAction('shortcuts:check', fromSettings, (_event, bindings) => shortcutStatus(shortcuts.check(bindings)));
  handleAction('shortcuts:capture', fromSettings, (_event, capture) => {
    if (typeof capture !== 'boolean') throw new Error('无效的快捷键录入状态');
    if (capture && settingsWindow.isFocused()) shortcuts.suspend();
    else shortcuts.resume();
    return shortcutStatus();
  });
  ipcMain.handle('settings:open', (event, tab) => { if (fromApp(event)) openSettings(tab); });
  ipcMain.on('settings:close', (event) => { if (fromSettings(event)) settingsWindow.close(); });
  handleAction('settings:choose-directory', fromSettings, async () => {
    const result = await dialog.showOpenDialog(settingsWindow, { title: tr('选择工时数据存储文件夹'), defaultPath: settings.dataDirectory, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const moved = moveDataDirectory(clock, store, settingsStore, settings, result.filePaths[0]);
    store = moved.store;
    settings = moved.settings;
    storageError = null;
    broadcast();
    return settingsSnapshot();
  });
  handleAction('settings:show-directory', fromApp, async () => {
    const error = await shell.openPath(settings.dataDirectory);
    if (error) throw new Error(error);
  });
  handleAction('settings:show-application', fromApp, () => shell.showItemInFolder(startupExecutable()));
  handleAction('settings:export', fromSettings, async () => {
    const result = await dialog.showSaveDialog(settingsWindow, { title: tr('导出工时备份'), defaultPath: `${tr('拾光工时备份')}-${clock.snapshot().today}.json`, filters: [{ name: tr('工时记录'), extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    const protectedFiles = [store.file, `${store.file}.bak`, settingsStore.file, `${settingsStore.file}.bak`, preferencesFile()].map(file => path.resolve(file).toLowerCase());
    if (protectedFiles.includes(path.resolve(result.filePath).toLowerCase())) throw new Error('请为导出备份选择其他文件名，避免覆盖正在使用的工时或设置文件。');
    const at = Date.now();
    const exported = new WorkClock(clock.state, clock.now);
    exported.setMode('idle', at, 'export');
    const exportState = exported.checkpoint(at);
    fs.writeFileSync(result.filePath, JSON.stringify(exportState, null, 2), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('calendar:open', (event) => { if (fromApp(event)) openCalendar(); });
  ipcMain.on('calendar:close', (event) => { if (fromCalendar(event)) calendarWindow.close(); });
  ipcMain.on('calendar:minimize', (event) => { if (fromCalendar(event)) calendarWindow.minimize(); });
  ipcMain.on('menu:show', (event) => { if (fromApp(event)) Menu.buildFromTemplate(menuTemplate()).popup({ window: BrowserWindow.fromWebContents(event.sender) }); });
  ipcMain.on('orb:drag-start', (event) => {
    if (fromOrb(event)) orbLayout.startDrag();
  });
  ipcMain.on('orb:drag-move', (event) => {
    if (fromOrb(event)) orbLayout.moveDrag();
  });
  ipcMain.on('orb:drag-end', (event) => {
    if (fromOrb(event)) { orbLayout.endDrag(); savePosition(); }
  });
}

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (orbWindow) { showOrb(); openCalendar(); } });
  app.whenReady().then(async () => {
    if (!testMode) {
      instanceLease = await acquireInstanceLock();
      if (!instanceLease) { app.quit(); return; }
    }
    startup = new StartupController(app, startupExecutable());
    doubleClickMs = getDoubleClickTime();
    try {
      settingsStore = new SettingsStore(app.getPath('userData'));
      settings = settingsStore.load();
      settingsStore.save(settings);
      store = new FileStore(path.join(settings.dataDirectory, 'worklog.json'));
      clock = new WorkClock(store.load(path.resolve(settings.dataDirectory).toLowerCase() !== path.resolve(app.getPath('userData')).toLowerCase()));
      clock.recoverInterrupted();
      try { configureStartup(settings.launchAtLogin, { preserveDisabled: true }); } catch (error) { startupError = error.message; }
    } catch (error) {
      dialog.showErrorBox(tr('拾光 · 数据读取失败'), errorText(error.message));
      app.exit(1);
      return;
    }
    persist();
    attachIPC();
    createOrb();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png')));
    tray.on('click', showOrb);
    tray.on('double-click', openCalendar);
    updateTray();
    shortcuts = new ShortcutManager(globalShortcut, runShortcut);
    shortcuts.start(settings.shortcuts);
    ticker = setInterval(() => {
      const elapsed = performance.now();
      if (elapsed - lastSave >= 15000) persist();
      if (elapsed - lastBroadcast >= 1000) { broadcast(); lastBroadcast = elapsed; }
      // Transparent corners pass clicks through to the desktop.
      if (orbWindow && !orbWindow.isDestroyed() && orbWindow.isVisible()) {
        const cursor = screen.getCursorScreenPoint();
        orbWindow.setIgnoreMouseEvents(!orbLayout.drag && !orbLayout.hitTest(cursor, actionsOpen), { forward: true });
        if (orbLayout.side) orbLayout.lookAt(cursor);
      }
    }, 50);
    powerMonitor.on('suspend', persist);
    powerMonitor.on('shutdown', finishSystemSession);
    powerMonitor.on('resume', () => { persist(); broadcast(); });
    screen.on('display-removed', () => orbLayout.ensureVisible());
    screen.on('display-metrics-changed', () => { if (!orbLayout.drag) orbLayout.ensureVisible(); });
    if (testMode && process.env.SHIGUANG_OPEN_CALENDAR === '1') openCalendar();
  }).catch(error => { dialog.showErrorBox('Shiguang', error.message); app.exit(1); });
  app.on('window-all-closed', () => { /* The tray owns the application lifetime. */ });
  app.on('before-quit', (event) => {
    if (quitting) return;
    try { if (clock) clock = saveForExit(clock, store); }
    catch (error) {
      storageError = '工时暂未保存，请检查磁盘空间或写入权限。';
      event.preventDefault();
      dialog.showErrorBox(tr('拾光 · 尚未保存'), `${errorText(storageError)}\n${tr('修复后可再次退出。记录位置：')}${store.file}`);
      return;
    }
    quitting = true;
    clearInterval(ticker);
    shortcuts?.dispose();
    savePosition();
    tray?.destroy();
    instanceLease?.release();
  });
}
