import assert from "node:assert/strict";
import { createTransferUpdateScheduler, QUEUE_PERSIST_DELAY_MS } from "../js/transfer/updates.js";

function fixture() {
  const frames = new Map(), timers = new Map();
  let id = 0, owner = 1, paints = 0, writes = 0;
  const scheduler = createTransferUpdateScheduler({
    updateProgress: () => paints++, persist: () => writes++, generation: () => owner,
    requestFrame: (fn) => { frames.set(++id, fn); return id; }, cancelFrame: (key) => frames.delete(key),
    setTimer: (fn, delay) => { assert.equal(delay, QUEUE_PERSIST_DELAY_MS); timers.set(++id, fn); return id; },
    clearTimer: (key) => timers.delete(key),
  });
  const run = (map) => { const pending = [...map.values()]; map.clear(); pending.forEach((fn) => fn()); };
  return { scheduler, frames, timers, frame: () => run(frames), timer: () => run(timers),
    switchOwner: () => owner++, counts: () => ({ paints, writes }) };
}

{
  const f = fixture();
  for (let i = 0; i < 100; i++) { f.scheduler.progress(); f.scheduler.persistLater(); }
  assert.equal(f.frames.size, 1); assert.equal(f.timers.size, 1);
  f.frame(); f.timer();
  assert.deepEqual(f.counts(), { paints: 1, writes: 1 });
  f.scheduler.progress(); f.frame();
  assert.equal(f.counts().paints, 2, "a new frame renders the latest numeric progress");
}
{
  const f = fixture();
  f.scheduler.persistLater(); f.scheduler.persistNow(); f.timer();
  assert.equal(f.counts().writes, 1, "pause/completion persistence cancels its pending checkpoint");
  f.scheduler.persistLater(); f.scheduler.flushPending(); f.timer();
  assert.equal(f.counts().writes, 2, "hiding flushes outstanding acknowledgements once");
  f.scheduler.flushPending();
  assert.equal(f.counts().writes, 2, "startup hide must not overwrite a queue before restoration");
}
{
  const f = fixture();
  f.scheduler.progress(); f.scheduler.persistLater(); f.switchOwner(); f.frame(); f.timer();
  assert.deepEqual(f.counts(), { paints: 0, writes: 0 }, "stale owner callbacks cannot render or persist another account");
  f.scheduler.persistLater(); f.switchOwner(); f.scheduler.flushPending();
  assert.equal(f.counts().writes, 0);
}
{
  const f = fixture();
  f.scheduler.progress(); f.scheduler.persistLater(); f.scheduler.cancelProgress(); f.frame(); f.timer();
  assert.deepEqual(f.counts(), { paints: 0, writes: 1 }, "hidden rendering stops without losing durability");
  f.scheduler.progress(); f.scheduler.persistLater(); f.scheduler.cancel(); f.frame(); f.timer();
  assert.deepEqual(f.counts(), { paints: 0, writes: 1 });
}
console.log("transfer update coalescing, durability boundaries and owner cancellation passed");
