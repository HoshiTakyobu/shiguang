const { WorkClock } = require('./clock.cjs');

// Commit the clock-out before publishing it or releasing the application.
// A failed normal quit leaves both the timer and its event history intact.
function saveForExit(clock, store, { shutdown = false, at = Date.now() } = {}) {
  const next = new WorkClock(clock.state, clock.now);
  if (next.state.mode === 'working' || (shutdown && next.state.mode === 'paused')) next.setMode('idle', at, shutdown ? 'shutdown' : 'quit');
  store.save(next.checkpoint(at));
  return next;
}

module.exports = { saveForExit };
