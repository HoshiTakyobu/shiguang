const SIZE = 208, MINI_SIZE = { width: 52, height: 100 }, EDGE_DISTANCE = 20;
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
    if (!this.win.isDestroyed() && !this.win.webContents.isDestroyed()) this.win.webContents.send('orb:layout', { side: this.side });
  }
  dock(side, area, y) {
    if (this.win.isDestroyed()) return;
    const bounds = this.win.getBounds();
    area ??= this.screen.getDisplayMatching(bounds).workArea;
    y ??= bounds.y;
    this.side = side;
    this.win.setBounds(dockBounds(side, area, y));
    this.sendLayout();
  }
  restore() {
    if (this.win.isDestroyed() || !this.side) return;
    const bounds = this.win.getBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
    const x = this.side === 'left' ? area.x + 24 : area.x + area.width - SIZE - 24;
    this.side = null;
    this.win.setBounds(normalBounds(area, x, bounds.y - (SIZE - MINI_SIZE.height) / 2));
    this.sendLayout();
  }
  startDrag() {
    if (this.win.isDestroyed()) return;
    this.drag = { cursor: this.screen.getCursorScreenPoint(), bounds: this.win.getBounds(), moved: false };
  }
  moveDrag() {
    if (this.win.isDestroyed()) { this.drag = null; return; }
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
    if (this.win.isDestroyed()) { this.drag = null; return; }
    if (!this.drag) return;
    if (this.drag.moved) {
      const bounds = this.win.getBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
      const edge = edgeAt(bounds, area);
      if (edge) this.dock(edge, area, bounds.y + (SIZE - MINI_SIZE.height) / 2);
    }
    this.drag = null;
  }
  ensureVisible() {
    if (this.win.isDestroyed()) return;
    const bounds = this.win.getBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
    if (this.side) this.dock(this.side, area, bounds.y);
    else this.win.setBounds(normalBounds(area, bounds.x, bounds.y));
  }
  hitTest(point, split = false) {
    if (this.win.isDestroyed()) return false;
    const b = this.win.getBounds();
    // Match the 104 x 80 CSS ellipse, with 40px exposed at either edge.
    if (this.side) {
      const cx = this.side === 'left' ? -12 : 64;
      return ((point.x - b.x - cx) / 53) ** 2 + ((point.y - b.y - 50) / 41) ** 2 <= 1;
    }
    // Split halves move outward, including on hover; their outer rims remain clickable.
    return Math.hypot(point.x - b.x - SIZE / 2, point.y - b.y - SIZE / 2) <= (split ? 98 : 91);
  }
  lookAt(point) {
    if (this.win.isDestroyed() || this.win.webContents.isDestroyed()) return;
    const b = this.win.getBounds();
    const dx = point.x - (b.x + b.width / 2), dy = point.y - (b.y + b.height / 2);
    const length = Math.max(1, Math.hypot(dx, dy));
    this.win.webContents.send('orb:look', { x: dx / length * Math.min(1.8, length / 120), y: dy / length * Math.min(2.5, length / 100) });
  }
  preferences() {
    if (this.win.isDestroyed()) return null;
    const { x, y } = this.win.getBounds(); return { x, y, side: this.side };
  }
}
module.exports = { OrbWindow, MINI_SIZE, dockBounds, normalBounds, edgeAt };
