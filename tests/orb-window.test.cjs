const test = require('node:test');
const assert = require('node:assert/strict');
const { OrbWindow, dockBounds } = require('../src/orb-window.cjs');

test('left/right docking exposes a wider ellipse without growing taller, and restores on drag', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 };
  assert.deepEqual(dockBounds('left', area, -100), { x: -1920, y: -100, width: 52, height: 100 });
  assert.deepEqual(dockBounds('right', area, 1000), { x: -52, y: 780, width: 52, height: 100 });
  let bounds = { x: -300, y: 200, width: 208, height: 208 }, cursor = { x: -200, y: 300 };
  const sent = [];
  const win = { getBounds: () => bounds, setBounds: value => { bounds = value; }, isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } };
  const screen = { getDisplayMatching: () => ({ workArea: area }), getDisplayNearestPoint: () => ({ workArea: area }), getCursorScreenPoint: () => cursor };
  const orb = new OrbWindow(win, screen);
  orb.startDrag(); cursor = { x: -1915, y: 300 }; orb.moveDrag(); orb.endDrag();
  assert.equal(orb.side, 'left'); assert.equal(bounds.width, 52);
  assert.equal(orb.hitTest({ x: bounds.x + 38, y: bounds.y + 50 }), true, 'The wider outer rim receives clicks');
  assert.equal(orb.hitTest({ x: bounds.x + 38, y: bounds.y + 15 }), false, 'Transparent ellipse corners pass through');
  assert.equal(orb.hitTest({ x: -1910, y: bounds.y + 50 }), true);
  assert.equal(orb.hitTest({ x: -1910, y: bounds.y }), false);
  orb.lookAt({ x: 500, y: 900 }); const look = sent.at(-1)[1]; assert.ok(look.x > 0 && look.y > 0);
  orb.startDrag(); cursor = { x: -1000, y: 400 }; orb.moveDrag(); orb.endDrag();
  assert.equal(orb.side, null); assert.equal(bounds.width, 208);
  orb.dock('right', area);
  assert.equal(orb.hitTest({ x: bounds.x + 14, y: bounds.y + 50 }), true);
  assert.equal(orb.hitTest({ x: bounds.x + 14, y: bounds.y + 15 }), false);
  orb.restore();
  assert.equal(orb.side, null); assert.ok(bounds.x + bounds.width < area.x + area.width);
  assert.equal(orb.hitTest({ x: bounds.x + 198, y: bounds.y + 104 }), false);
  assert.equal(orb.hitTest({ x: bounds.x + 198, y: bounds.y + 104 }, true), true, 'Expanded half-orb rims receive mouse input');
  assert.equal(orb.hitTest({ x: bounds.x + 4, y: bounds.y + 4 }, true), false, 'Transparent corners still pass through');
});

test('late display, drag and renderer updates never access a destroyed native window', () => {
  const destroyedAccess = () => { throw new TypeError('Object has been destroyed'); };
  const win = { isDestroyed: () => true, getBounds: destroyedAccess, setBounds: destroyedAccess, get webContents() { return destroyedAccess(); } };
  const screen = { getDisplayMatching: destroyedAccess, getCursorScreenPoint: destroyedAccess };
  const orb = new OrbWindow(win, screen);
  orb.side = 'left';
  orb.drag = { moved: true };
  assert.doesNotThrow(() => {
    orb.ensureVisible(); orb.dock('left'); orb.restore(); orb.sendLayout();
    orb.startDrag(); orb.moveDrag(); orb.endDrag(); orb.lookAt({ x: 0, y: 0 });
  });
  assert.equal(orb.drag, null);
  assert.equal(orb.hitTest({ x: 0, y: 0 }), false);
  assert.equal(orb.preferences(), null);
});

test('renderer teardown can precede native window destruction', () => {
  const win = { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 208, height: 208 }),
    webContents: { isDestroyed: () => true, send() { throw new TypeError('Object has been destroyed'); } } };
  const orb = new OrbWindow(win, {});
  assert.doesNotThrow(() => { orb.sendLayout(); orb.lookAt({ x: 0, y: 0 }); });
});
