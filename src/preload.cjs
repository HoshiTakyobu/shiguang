const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shiguang', {
  getState: () => ipcRenderer.invoke('clock:get'),
  getDayDetails: date => ipcRenderer.invoke('clock:day-details', date),
  checkShortcuts: bindings => ipcRenderer.invoke('shortcuts:check', bindings),
  captureShortcuts: capture => ipcRenderer.invoke('shortcuts:capture', capture),
  getTranslations: () => ipcRenderer.invoke('translations:get'),
  toggle: () => ipcRenderer.invoke('clock:toggle'),
  setMode: mode => ipcRenderer.invoke('clock:set-mode', mode),
  activateOrb: () => ipcRenderer.invoke('orb:activate'),
  closeActions: () => ipcRenderer.send('actions:close'),
  onOrbLayout: callback => { const listener = (_event, layout) => callback(layout); ipcRenderer.on('orb:layout', listener); return () => ipcRenderer.removeListener('orb:layout', listener); },
  onOrbLook: callback => { const listener = (_event, look) => callback(look); ipcRenderer.on('orb:look', listener); return () => ipcRenderer.removeListener('orb:look', listener); },
  adjustDay: (value) => ipcRenderer.invoke('clock:adjust', value),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  openSettings: (tab) => ipcRenderer.invoke('settings:open', tab),
  closeSettings: () => ipcRenderer.send('settings:close'),
  chooseDataDirectory: () => ipcRenderer.invoke('settings:choose-directory'),
  openDataDirectory: () => ipcRenderer.invoke('settings:show-directory'),
  showApplication: () => ipcRenderer.invoke('settings:show-application'),
  exportData: () => ipcRenderer.invoke('settings:export'),
  openCalendar: () => ipcRenderer.invoke('calendar:open'),
  closeCalendar: () => ipcRenderer.send('calendar:close'),
  minimizeCalendar: () => ipcRenderer.send('calendar:minimize'),
  showMenu: () => ipcRenderer.send('menu:show'),
  dragStart: () => ipcRenderer.send('orb:drag-start'),
  dragMove: () => ipcRenderer.send('orb:drag-move'),
  dragEnd: () => ipcRenderer.send('orb:drag-end'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('clock:state', listener);
    return () => ipcRenderer.removeListener('clock:state', listener);
  },
  onCalendarOpened: (callback) => {
    ipcRenderer.on('calendar:reset', callback);
    return () => ipcRenderer.removeListener('calendar:reset', callback);
  },
  onSettingsOpened: (callback) => {
    const listener = (_event, tab) => callback(tab);
    ipcRenderer.on('settings:tab', listener);
    return () => ipcRenderer.removeListener('settings:tab', listener);
  }
});
