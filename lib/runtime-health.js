'use strict';

const fs = require('node:fs');
const { lock, runtimePaths, tokenProviderUrl, supportedNode } = require('./downloader-config');

function createRuntimeHealth({ paths = runtimePaths(), providerUrl = tokenProviderUrl(), ffmpegPath, cacheMs = 3000 } = {}) {
  let cached;
  let expires = 0;
  let pending;
  async function inspect() {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8')); } catch (_) {}
    let providerReady = false;
    try {
      const response = await fetch(`${providerUrl}/ping`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
      providerReady = response.ok && (await response.json()).version === lock.poTokenProvider.version;
    } catch (_) {}
    const runtime = {
      downloaderVersion: manifest?.downloader || null,
      providerVersion: lock.poTokenProvider.version,
      downloaderReady: manifest?.downloader === lock.ytDlp.version && fs.existsSync(paths.downloader),
      pluginReady: fs.existsSync(require('node:path').join(paths.plugins, 'bgutil-ytdlp-pot-provider.zip')),
      providerReady,
      ffmpegReady: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),
      javascriptReady: supportedNode()
    };
    return { ready: Object.entries(runtime).filter(([key]) => key.endsWith('Ready')).every(([, value]) => value), ...runtime };
  }
  return async function getHealth() {
    if (cached && Date.now() < expires) return cached;
    if (!pending) pending = inspect().then(value => {
      cached = value; expires = Date.now() + cacheMs; return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createRuntimeHealth };
