const { WorkClock } = require('./clock.cjs');

// Commit the clock-out before publishing it or releasing the application.
// A failed normal quit leaves both the timer and its event history intact.
function saveForExit(clock, store, { shutdown = false, continueTiming = false, at = Date.now() } = {}) {
  const next = new WorkClock(clock.state, clock.now);
  delete next.state.continueAfterExit;
  if (!shutdown && continueTiming && next.state.mode !== 'idle') {
    next.setMode('working', at, 'quit-continue');
    next.state.continueAfterExit = true;
  } else if (next.state.mode === 'working' || (shutdown && next.state.mode === 'paused')) next.setMode('idle', at, shutdown ? 'shutdown' : 'quit');
  store.save(next.checkpoint(at));
  return next;
}

function restoreAfterExit(clock, store, { at = Date.now() } = {}) {
  const next = new WorkClock(clock.state, clock.now);
  // A backup may contain an already consumed exit choice. Only the primary
  // record can authorize counting time while the application was closed.
  if (store.recovered) delete next.state.continueAfterExit;
  next.recoverInterrupted(at);
  store.save(next.checkpoint(at));
  return next;
}

module.exports = { saveForExit, restoreAfterExit };
