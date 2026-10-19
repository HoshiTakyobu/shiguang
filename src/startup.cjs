const path = require('node:path');

const APP_ID = 'com.shiguang.workorb';
const STARTUP_ARGS = ['--autostart'];
const LEGACY_NAMES = ['拾光工作球'];

class StartupController {
  constructor(app, executable, { appId = APP_ID, legacyNames = LEGACY_NAMES } = {}) {
    this.app = app;
    this.executable = executable;
    this.appId = appId;
    this.legacyNames = legacyNames;
  }

  status() {
    // Electron parses the lookup path as a command line. Quote it so installation
    // directories containing spaces also appear in launchItems.
    const actual = this.app.getLoginItemSettings({ path: `"${this.executable}"`, args: STARTUP_ARGS });
    const item = (actual.launchItems || []).find(item => item.name === this.appId && item.scope === 'user'
      && path.win32.normalize(item.path).toLowerCase() === path.win32.normalize(this.executable).toLowerCase());
    // launchItems.args omits Chromium-style switches such as --autostart.
    // openAtLogin verifies the full command including switches for our default key.
    return { registered: actual.openAtLogin && !!item, enabled: actual.openAtLogin && !!item?.enabled };
  }

  configure(enabled, { preserveDisabled = false } = {}) {
    const previous = this.status();
    const shouldEnable = enabled && !(preserveDisabled && previous.registered && !previous.enabled);
    // Omit `name`: Electron writes and reads the same AppUserModelID registry
    // value. A custom name makes openAtLogin query a different key.
    this.app.setLoginItemSettings({ openAtLogin: enabled, enabled: shouldEnable, path: this.executable, args: STARTUP_ARGS });
    const current = this.status();
    if (current.registered !== enabled || (enabled && current.enabled !== shouldEnable)) {
      throw new Error('无法更新开机启动项，请检查当前账户的写入权限。');
    }
    for (const name of this.legacyNames) {
      if (name !== this.appId) this.app.setLoginItemSettings({ openAtLogin: false, name });
    }
    return current;
  }
}

module.exports = { StartupController, APP_ID, STARTUP_ARGS };
