'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { lock, runtimePaths, tokenProviderUrl, buildYtDlpArgs, supportedNode } = require('../lib/downloader-config');
const { supervise } = require('../lib/runtime-supervisor');

async function main() {
  if (!supportedNode()) throw new Error('Use the Node.js version pinned in .node-version.');
  const paths = runtimePaths();
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8')); } catch (_) {}
  if (manifest?.downloader !== lock.ytDlp.version || manifest?.providerCommit !== lock.poTokenProvider.commit ||
      manifest?.platform !== process.platform || manifest?.arch !== process.arch ||
      ![paths.downloader, paths.provider, path.join(paths.plugins, 'bgutil-ytdlp-pot-provider.zip')].every(file => fs.existsSync(file))) {
    throw new Error('The pinned download runtime is missing or outdated. Run npm run build first.');
  }
  buildYtDlpArgs(); // Validate configuration before exposing the API.
  const url = tokenProviderUrl();
  const env = { ...process.env, YOUTUBE_AUTH_MODE: process.env.YOUTUBE_AUTH_MODE || 'guest' };
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  const runtime = await supervise({
    provider: { command: process.execPath, args: [paths.provider, '--host', '127.0.0.1', '--port', new URL(url).port], cwd: path.dirname(paths.provider), env },
    application: { command: process.execPath, args: [path.join(__dirname, '..', 'server.js')], env },
    healthUrl: `${url}/ping`, providerVersion: lock.poTokenProvider.version, signal: controller.signal
  });
  if (!controller.signal.aborted) console.log(`[runtime] Private token service ${lock.poTokenProvider.version} is ready; starting API.`);
  process.exitCode = await runtime.exited;
}

main().catch(error => { console.error(`[runtime] ${error.message}`); process.exitCode = 1; });
