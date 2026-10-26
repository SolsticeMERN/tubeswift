/**
 * In-Memory LRU Cache for Analyzed Video Information
 * Provides sub-millisecond responses for repeated or concurrent queries
 */
class VideoInfoCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 60 * 60 * 1000; // 1 hour default
    this.maxItems = options.maxItems || 300;
    this.cache = new Map();
  }

  get(videoId) {
    if (!videoId) return null;
    const item = this.cache.get(videoId);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(videoId);
      return null;
    }
    // Refresh key position for LRU behavior
    this.cache.delete(videoId);
    this.cache.set(videoId, item);
    return item.data;
  }

  set(videoId, data) {
    if (!videoId || !data) return;
    if (this.cache.has(videoId)) {
      this.cache.delete(videoId);
    } else if (this.cache.size >= this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(videoId, { timestamp: Date.now(), data });
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

module.exports = { VideoInfoCache };
