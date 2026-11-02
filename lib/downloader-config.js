'use strict';

const path = require('node:path');
const lock = require('../runtime-lock.json');

function supportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major === 24 && minor >= 16;
}

function runtimePaths(root = path.join(__dirname, '..')) {
  const directory = path.join(root, '.runtime');
  return {
    directory,
    downloader: path.join(directory, 'yt-dlp'),
    plugins: path.join(directory, 'plugins'),
    provider: path.join(directory, 'provider', 'server', 'build', 'main.js'),
    manifest: path.join(directory, 'manifest.json')
  };
}

function tokenProviderUrl(env = process.env) {
  const port = Number(env.POT_PORT || 4416);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('POT_PORT must be a port between 1024 and 65535.');
  return `http://127.0.0.1:${port}`;
}

function buildYtDlpArgs({ env = process.env, nodePath = process.execPath, cookiePath, paths = runtimePaths() } = {}) {
  const clients = env.YOUTUBE_PLAYER_CLIENTS || 'mweb';
  if (!/^[a-z_]+(?:,[a-z_]+)*$/.test(clients)) throw new Error('YOUTUBE_PLAYER_CLIENTS must be a comma-separated client list.');
  const args = [
    '--ignore-config', '--no-playlist',
    '--socket-timeout', '20',
    // Only transfer/fragment recovery. Explicit 4xx rejections are not transient
    // HTTP retries; extraction and the outer request are independently bounded.
    '--retries', '2', '--extractor-retries', '0', '--fragment-retries', '2',
    '--retry-sleep', 'http:exp=1:4', '--retry-sleep', 'fragment:exp=1:4',
    '--abort-on-unavailable-fragments', '--sleep-requests', '0.75',
    '--js-runtimes', `node:${nodePath}`, '--remote-components', 'ejs:github',
    '--plugin-dirs', paths.plugins,
    '--extractor-args', `youtube:player_client=${clients}`,
    '--extractor-args', `youtubepot-bgutilhttp:base_url=${tokenProviderUrl(env)}`
  ];
  if (cookiePath) args.push('--cookies', cookiePath);
  if (env.YTDLP_PROXY) {
    const proxy = new URL(env.YTDLP_PROXY);
    if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(proxy.protocol)) {
      throw new Error('YTDLP_PROXY has an unsupported protocol.');
    }
    args.push('--proxy', env.YTDLP_PROXY);
  }
  return args;
}

module.exports = { lock, runtimePaths, tokenProviderUrl, buildYtDlpArgs, supportedNode };
