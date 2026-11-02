'use strict';
const { classifyYoutubeError } = require('./youtube-errors');

// A per-process capacity limit and cooldown. This reduces avoidable requests;
// it cannot remove a restriction imposed by YouTube on the hosting network.
class UpstreamGuard {
  constructor({ concurrency = 1, maxQueue = 4, waitMs = 30000, cooldownMs = 120000, now = Date.now } = {}) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.waitMs = waitMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.active = 0;
    this.queue = [];
    this.blockedUntil = 0;
    this.lastResult = null;
  }

  cooldownError() {
    const retryAfter = Math.max(1, Math.ceil((this.blockedUntil - this.now()) / 1000));
    return Object.assign(new Error(`YouTube is temporarily limiting downloads. Please try again in ${retryAfter} seconds.`), {
      code: 'UPSTREAM_COOLDOWN', retryAfter
    });
  }

  recordFailure(stderr) {
    const failure = classifyYoutubeError(stderr);
    this.lastResult = { code: failure.code, at: new Date(this.now()).toISOString() };
    if (!['YOUTUBE_RATE_LIMITED', 'YOUTUBE_SESSION_REJECTED'].includes(failure.code)) return failure;
    this.blockedUntil = this.now() + this.cooldownMs;
    for (const entry of this.queue.splice(0)) {
      entry.cleanup();
      entry.reject(this.cooldownError());
    }
    return { ...failure, retryAfter: Math.ceil(this.cooldownMs / 1000) };
  }

  recordSuccess() {
    this.lastResult = { code: 'SUCCESS', at: new Date(this.now()).toISOString() };
  }

  snapshot() {
    return {
      state: this.blockedUntil > this.now() ? 'cooldown' : 'available_to_attempt',
      retryAfter: Math.max(0, Math.ceil((this.blockedUntil - this.now()) / 1000)),
      active: this.active, queued: this.queue.length, lastResult: this.lastResult
    };
  }

  acquire(signal) {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Request cancelled.'), { code: 'ABORTED' }));
    if (this.blockedUntil > this.now()) return Promise.reject(this.cooldownError());
    if (this.active < this.concurrency) return Promise.resolve(this.takeSlot());
    if (this.queue.length >= this.maxQueue) return Promise.reject(this.busyError());
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      const remove = () => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) this.queue.splice(index, 1);
      };
      const abort = () => {
        remove(); entry.cleanup();
        reject(Object.assign(new Error('Request cancelled.'), { code: 'ABORTED' }));
      };
      const timer = setTimeout(() => {
        remove(); entry.cleanup(); reject(this.busyError());
      }, this.waitMs);
      entry.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(entry);
    });
  }

  busyError() {
    return Object.assign(new Error('The download service is busy. Please try again shortly.'), { code: 'SERVICE_BUSY', retryAfter: 10 });
  }

  takeSlot() {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      while (this.queue.length && this.active < this.concurrency) {
        const entry = this.queue.shift();
        entry.cleanup();
        if (this.blockedUntil > this.now()) entry.reject(this.cooldownError());
        else entry.resolve(this.takeSlot());
      }
    };
  }
}

module.exports = { UpstreamGuard };
