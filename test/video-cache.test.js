const test = require('node:test');
const assert = require('node:assert/strict');
const { VideoInfoCache } = require('../lib/video-cache');

test('VideoInfoCache returns cached data before TTL expires', () => {
  const cache = new VideoInfoCache({ ttlMs: 1000, maxItems: 5 });
  cache.set('vid123', { title: 'Test Video' });
  assert.deepEqual(cache.get('vid123'), { title: 'Test Video' });
});

test('VideoInfoCache expires data after TTL', async () => {
  const cache = new VideoInfoCache({ ttlMs: 20, maxItems: 5 });
  cache.set('vid123', { title: 'Test Video' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(cache.get('vid123'), null);
});

test('VideoInfoCache evicts oldest item when maxItems reached (LRU)', () => {
  const cache = new VideoInfoCache({ ttlMs: 5000, maxItems: 2 });
  cache.set('v1', { title: 'V1' });
  cache.set('v2', { title: 'V2' });
  cache.get('v1'); // accesses v1, making v2 oldest
  cache.set('v3', { title: 'V3' }); // should evict v2

  assert.deepEqual(cache.get('v1'), { title: 'V1' });
  assert.equal(cache.get('v2'), null);
  assert.deepEqual(cache.get('v3'), { title: 'V3' });
});
