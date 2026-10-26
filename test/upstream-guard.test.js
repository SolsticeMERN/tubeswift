const test = require('node:test');
const assert = require('node:assert/strict');
const { UpstreamGuard } = require('../lib/upstream-guard');

test('serializes extraction and conversion, and releases a slot only once', async () => {
  const guard = new UpstreamGuard();
  const first = await guard.acquire();
  let secondStarted = false;
  const pending = guard.acquire().then(release => { secondStarted = true; return release; });
  await Promise.resolve();
  assert.equal(secondStarted, false);
  first(); first();
  const second = await pending;
  assert.equal(guard.active, 1);
  second();
  assert.equal(guard.active, 0);
});

test('a YouTube 429 stops queued work and permits a new attempt after cooldown', async () => {
  let now = 1000;
  const guard = new UpstreamGuard({ cooldownMs: 120000, now: () => now });
  const release = await guard.acquire();
  const queued = guard.acquire();
  guard.recordFailure('Unable to download webpage: HTTP Error 429: Too Many Requests');
  await assert.rejects(queued, { code: 'UPSTREAM_COOLDOWN', retryAfter: 120 });
  release();
  now += 60000;
  await assert.rejects(guard.acquire(), { retryAfter: 60 });
  now += 60001;
  const resumed = await guard.acquire();
  resumed();
});

test('unavailable videos do not take the service offline', async () => {
  const guard = new UpstreamGuard();
  guard.recordFailure('ERROR: This video is unavailable');
  const release = await guard.acquire();
  release();
});

test('queue overflow and queue timeout are bounded', async () => {
  const guard = new UpstreamGuard({ maxQueue: 1, waitMs: 10 });
  const release = await guard.acquire();
  const queued = guard.acquire();
  await assert.rejects(guard.acquire(), { code: 'SERVICE_BUSY' });
  await assert.rejects(queued, { code: 'SERVICE_BUSY' });
  release();
  assert.equal(guard.queue.length, 0);
});

test('cancelled queued requests never consume a future worker slot', async () => {
  const guard = new UpstreamGuard();
  const release = await guard.acquire();
  const controller = new AbortController();
  const queued = guard.acquire(controller.signal);
  controller.abort();
  await assert.rejects(queued, { code: 'ABORTED' });
  release();
  assert.equal(guard.active, 0);
  assert.equal(guard.queue.length, 0);
});
