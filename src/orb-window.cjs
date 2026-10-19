const SIZE = 208, MINI_SIZE = { width: 32, height: 100 }, EDGE_DISTANCE = 20;
const clamp = (value, min, max) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

function dockBounds(side, area, y) {
  return { x: side === 'left' ? area.x : area.x + area.width - MINI_SIZE.width, y: clamp(y, area.y, area.y + area.height - MINI_SIZE.height), ...MINI_SIZE };
}
function edgeAt(bounds, area) {
  if (bounds.x <= area.x + EDGE_DISTANCE) return 'left';
  if (bounds.x + bounds.width >= area.x + area.width - EDGE_DISTANCE) return 'right';
  return null;
}
function normalBounds(area, x, y) {
  return { x: clamp(x, area.x, area.x + area.width - SIZE), y: clamp(y, area.y, area.y + area.height - SIZE), width: SIZE, height: SIZE };
}

class OrbWindow {
  constructor(win, screen, saved = {}) {
    this.win = win; this.screen = screen; this.side = null; this.drag = null;
    if (['left', 'right'].includes(saved.side)) this.dock(saved.side, screen.getDisplayMatching(win.getBounds()).workArea, saved.y);
  }
  sendLayout() {
    if (!this.win.isDestroyed()) this.win.webContents.send('orb:layout', { side: this.side });
  }
  dock(side, area = this.screen.getDisplayMatching(this.win.getBounds()).workArea, y = this.win.getBounds().y) {
    this.side = side;
    this.win.setBounds(dockBounds(side, area, y));
    this.sendLayout();
  }
  restore() {
    if (!this.side) return;
    const bounds = this.win.getBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
    const x = this.side === 'left' ? area.x + 24 : area.x + area.width - SIZE - 24;
    this.side = null;
    this.win.setBounds(normalBounds(area, x, bounds.y - (SIZE - MINI_SIZE.height) / 2));
    this.sendLayout();
  }
  startDrag() { this.drag = { cursor: this.screen.getCursorScreenPoint(), bounds: this.win.getBounds(), moved: false }; }
  moveDrag() {
    if (!this.drag) return;
    const point = this.screen.getCursorScreenPoint();
    if (Math.hypot(point.x - this.drag.cursor.x, point.y - this.drag.cursor.y) <= 5 && !this.drag.moved) return;
    this.drag.moved = true;
    const area = this.screen.getDisplayNearestPoint(point).workArea;
    if (this.side) {
      this.side = null;
      this.drag.bounds = { x: this.drag.cursor.x - SIZE / 2, y: this.drag.cursor.y - SIZE / 2 };
      this.sendLayout();
    }
    this.win.setBounds(normalBounds(area, this.drag.bounds.x + point.x - this.drag.cursor.x, this.drag.bounds.y + point.y - this.drag.cursor.y));
  }
  endDrag() {
    if (!this.drag) return;
    if (this.drag.moved) {
      const bounds = this.win.getBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
      const edge = edgeAt(bounds, area);
      if (edge) this.dock(edge, area, bounds.y + (SIZE - MINI_SIZE.height) / 2);
    }
    this.drag = null;
  }
  ensureVisible() {
    const bounds = this.win.getBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
    if (this.side) this.dock(this.side, area, bounds.y);
    else this.win.setBounds(normalBounds(area, bounds.x, bounds.y));
  }
  hitTest(point) {
    const b = this.win.getBounds();
    const cx = this.side === 'left' ? -20 : this.side === 'right' ? 52 : SIZE / 2;
    const cy = this.side ? 50 : SIZE / 2;
    return Math.hypot(point.x - b.x - cx, point.y - b.y - cy) <= (this.side ? 41 : 91);
  }
  lookAt(point) {
    const b = this.win.getBounds();
    const dx = point.x - (b.x + b.width / 2), dy = point.y - (b.y + b.height / 2);
    const length = Math.max(1, Math.hypot(dx, dy));
    this.win.webContents.send('orb:look', { x: dx / length * Math.min(1.8, length / 120), y: dy / length * Math.min(2.5, length / 100) });
  }
  preferences() { const { x, y } = this.win.getBounds(); return { x, y, side: this.side }; }
}
module.exports = { OrbWindow, dockBounds, normalBounds, edgeAt };
