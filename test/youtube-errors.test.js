const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyYoutubeError, redactDiagnostic } = require('../lib/youtube-errors');
const { UpstreamGuard } = require('../lib/upstream-guard');

test('mixed diagnostics keep explicit rate-limit and bot evidence in either order', () => {
  for (const [detail, code] of [
    ['HTTP Error 429: Too Many Requests', 'YOUTUBE_RATE_LIMITED'],
    ["Sign in to confirm you’re not a bot", 'YOUTUBE_SESSION_REJECTED']
  ]) {
    for (const text of [`Video unavailable\n${detail}`, `${detail}\nVideo unavailable`]) {
      const guard = new UpstreamGuard();
      const failure = guard.recordFailure(text);
      assert.equal(failure.code, code);
      assert.equal(failure.status, 503);
      assert.equal(failure.retryAfter, 120);
      assert.equal(guard.snapshot().state, 'cooldown');
    }
  }
});

test('unavailable and account-only videos do not block other downloads', async () => {
  for (const [text, code] of [
    ['Video is unavailable', 'VIDEO_UNAVAILABLE'],
    ['Private video. Sign in if you have access.', 'VIDEO_UNAVAILABLE'],
    ['Sign in to confirm your age', 'VIDEO_RESTRICTED'],
    ['Requested format is not available', 'VIDEO_FORMATS_CHANGED']
  ]) {
    const guard = new UpstreamGuard();
    assert.equal(guard.recordFailure(text).code, code);
    const release = await guard.acquire();
    release();
    assert.equal(guard.blockedUntil, 0);
  }
});

test('a successful extraction is reported as an observation, not permanent availability', () => {
  const guard = new UpstreamGuard();
  assert.equal(guard.snapshot().lastResult, null);
  guard.recordSuccess();
  assert.equal(guard.snapshot().lastResult.code, 'SUCCESS');
  assert.equal(guard.snapshot().state, 'available_to_attempt');
  assert.equal(classifyYoutubeError('connection timed out').status, 502);
});

test('proxy userinfo cannot appear in recorded diagnostics', () => {
  const text = 'Failed http://alice:secret@proxy.example:8000 and socks5h://user:p%40ss@other:1080';
  const safe = redactDiagnostic(text);
  assert.doesNotMatch(safe, /alice|secret|p%40ss|user:/);
  assert.match(safe, /proxy.example:8000/);
});
