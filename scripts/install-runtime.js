'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { lock, runtimePaths, supportedNode } = require('../lib/downloader-config');

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifiedDownload(url, destination, sha256) {
  if (fs.existsSync(destination) && await digest(destination) === sha256) return;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download-${process.pid}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} (${new URL(url).hostname})`);
    const hash = crypto.createHash('sha256');
    await pipeline(Readable.fromWeb(response.body), new Transform({
      transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); }
    }), fs.createWriteStream(temporary, { mode: 0o600 }));
    if (hash.digest('hex') !== sha256) throw new Error(`Checksum mismatch for ${path.basename(destination)}`);
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function install() {
  if (process.env.VERCEL === '1') {
    console.log('[runtime] Static Vercel frontend: the download runtime is installed on Render.');
    return;
  }
  if (!supportedNode()) throw new Error('This download runtime requires Node.js 24.16 or newer in the 24.x series.');
  const paths = runtimePaths();
  const artifact = lock.ytDlp.artifacts[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error(`Unsupported download runtime: ${process.platform}/${process.arch}`);
  console.log(`[runtime] Installing verified yt-dlp ${lock.ytDlp.version} and PO provider ${lock.poTokenProvider.version}`);
  await verifiedDownload(`https://github.com/yt-dlp/yt-dlp/releases/download/${lock.ytDlp.version}/${artifact.name}`, paths.downloader, artifact.sha256);
  await fsp.chmod(paths.downloader, 0o755);

  const provider = lock.poTokenProvider;
  const plugin = path.join(paths.plugins, 'bgutil-ytdlp-pot-provider.zip');
  await verifiedDownload(`https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${provider.version}/bgutil-ytdlp-pot-provider.zip`, plugin, provider.pluginSha256);

  const marker = path.join(paths.directory, 'provider-version.json');
  let installed;
  try { installed = JSON.parse(await fsp.readFile(marker, 'utf8')); } catch (_) {}
  if (installed?.commit !== provider.commit || !fs.existsSync(paths.provider)) {
    const archive = path.join(paths.directory, 'provider.tar.gz');
    await verifiedDownload(`https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/tar.gz/${provider.commit}`, archive, provider.sourceSha256);
    const directory = path.join(paths.directory, 'provider');
    await fsp.rm(directory, { recursive: true, force: true });
    await fsp.mkdir(directory, { recursive: true });
    await run('tar', ['-xzf', archive, '--strip-components=1', '-C', directory], paths.directory);
    const server = path.join(directory, 'server');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await run(npm, ['ci', '--no-audit', '--no-fund'], server);
    await run(process.execPath, [path.join(server, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], server);
    await run(npm, ['prune', '--omit=dev', '--no-audit', '--no-fund'], server);
    await fsp.writeFile(marker, JSON.stringify({ commit: provider.commit, version: provider.version }));
  }
  await fsp.writeFile(paths.manifest, JSON.stringify({
    downloader: lock.ytDlp.version, provider: provider.version, providerCommit: provider.commit,
    platform: process.platform, arch: process.arch
  }, null, 2));
  console.log('[runtime] Downloader, plugin and private token service installed.');
}

if (require.main === module) install().catch(error => { console.error(`[runtime] ${error.message}`); process.exitCode = 1; });
module.exports = { verifiedDownload, install };
