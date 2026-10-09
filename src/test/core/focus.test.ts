import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FocusTracker } from '../../core/focus/tracker';

test('focus counts only active intervals, pauses at idle and on window loss', () => {
  const tracker = new FocusTracker(0, true);
  assert.equal(tracker.state(1000, 30_000, true).milliseconds, 0);
  tracker.heartbeat(1000);
  assert.equal(tracker.state(31_000, 30_000, true).inFlow, true);
  tracker.windowFocus(false, 32_000);
  tracker.heartbeat(60_000);
  assert.equal(tracker.state(70_000, 30_000, true).milliseconds, 31_000);
  tracker.windowFocus(true, 70_000); tracker.heartbeat(70_000);
  const idle = tracker.state(300_000, 30_000, true);
  assert.equal(idle.milliseconds, 151_000); assert.equal(idle.active, false); assert.equal(idle.inFlow, false);
  tracker.heartbeat(300_000);
  assert.equal(tracker.state(300_000, 30_000, true).continuous, 0);
});

test('daily totals split across local midnight and restore without restoring Flow', () => {
  const start = new Date(2026, 9, 9, 23, 59, 30).getTime();
  const tracker = new FocusTracker(start, true);
  tracker.heartbeat(start); tracker.switchContext(start);
  tracker.tick(start + 60_000);
  const saved = tracker.snapshot();
  assert.equal(saved['2026-10-09'].milliseconds, 30_000);
  assert.equal(saved['2026-10-10'].milliseconds, 30_000);
  const restored = new FocusTracker(start + 60_000, true, saved);
  assert.equal(restored.state(start + 60_000, 1000, false).milliseconds, 30_000);
  assert.equal(restored.state(start + 60_000, 1000, false).inFlow, false);
  assert.equal(new FocusTracker(start, true, { invalid: { milliseconds: Infinity } }).state(start, 1000, false).milliseconds, 0);
});
