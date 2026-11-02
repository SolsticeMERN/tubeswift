const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { supervise } = require('../lib/runtime-supervisor');
const { createRuntimeHealth } = require('../lib/runtime-health');
const { runtimePaths, lock, buildYtDlpArgs } = require('../lib/downloader-config');
const { verifiedDownload } = require('../scripts/install-runtime');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tubeswift-runtime-test-'));
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, server, port, url: `http://127.0.0.1:${port}` };
}

async function waitFor(file) {
  for (let i = 0; i < 100; i++) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (_) { await delay(20); }
  }
  throw new Error(`Child did not write ${path.basename(file)}`);
}

async function startFixture(t, { crash = false, version = '2.0.2', timeoutMs = 3000, signal } = {}) {
  const f = await fixture(t);
  // Release the reserved port so a real provider child can own its listener.
  await new Promise(resolve => f.server.close(resolve));
  const marker = path.join(f.directory, 'app.json');
  const providerMarker = path.join(f.directory, 'provider.json');
  const providerCode = `
    const fs = require('node:fs');
    const server = require('node:http').createServer((req, res) => res.end(JSON.stringify({version: ${JSON.stringify(version)}})));
    server.listen(${f.port}, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(providerMarker)}, JSON.stringify({pid:process.pid})));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
    ${crash ? 'setTimeout(() => process.exit(1), 700);' : ''}
  `;
  const appCode = `
    require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid}));
    setInterval(() => {}, 1000);
    process.on('SIGTERM', () => process.exit(0));
  `;
  const runtime = await supervise({
    provider: { command: process.execPath, args: ['-e', providerCode], stdio: 'ignore' },
    application: { command: process.execPath, args: ['-e', appCode], stdio: 'ignore' },
    healthUrl: `${f.url}/ping`, providerVersion: '2.0.2', timeoutMs, signal
  });
  t.after(() => runtime.stop(0));
  return { ...f, runtime, marker, providerMarker };
}

test('supervisor waits for the provider and stops both real child processes', async t => {
  const f = await startFixture(t);
  const app = await waitFor(f.marker);
  const provider = await waitFor(f.providerMarker);
  assert.equal(await f.runtime.stop(0), 0);
  assert.equal(await f.runtime.exited, 0);
  for (const pid of [app.pid, provider.pid]) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('a provider crash stops the API instead of leaving a falsely healthy service', async t => {
  const f = await startFixture(t, { crash: true });
  const app = await waitFor(f.marker);
  assert.equal(await f.runtime.exited, 1);
  assert.throws(() => process.kill(app.pid, 0), { code: 'ESRCH' });
});

test('an incompatible provider cannot start the API', async t => {
  await assert.rejects(startFixture(t, { version: 'wrong-version', timeoutMs: 400 }), /did not become ready/);
});

test('shutdown during provider startup leaves no running child', async t => {
  const controller = new AbortController();
  const pending = startFixture(t, { version: 'not-ready', signal: controller.signal });
  await delay(100);
  controller.abort();
  const f = await pending;
  assert.equal(await f.runtime.exited, 0);
  await assert.rejects(fs.access(f.marker), { code: 'ENOENT' });
});

test('readiness requires compatible provider, plugin, downloader and FFmpeg', async t => {
  const f = await fixture(t);
  let version = lock.poTokenProvider.version;
  f.server.on('request', (req, res) => res.end(JSON.stringify({ version })));
  const paths = runtimePaths(f.directory);
  await fs.mkdir(paths.plugins, { recursive: true });
  await fs.writeFile(paths.manifest, JSON.stringify({ downloader: lock.ytDlp.version }));
  await fs.writeFile(paths.downloader, 'fixture');
  const ffmpeg = path.join(f.directory, 'ffmpeg');
  await fs.writeFile(ffmpeg, 'fixture');
  const health = createRuntimeHealth({ paths, providerUrl: f.url, ffmpegPath: ffmpeg, cacheMs: 0 });
  assert.equal((await health()).ready, false, 'missing plugin is not ready');
  await fs.writeFile(path.join(paths.plugins, 'bgutil-ytdlp-pot-provider.zip'), 'fixture');
  assert.equal((await health()).ready, true);
  version = 'incompatible';
  assert.equal((await health()).ready, false);
  assert.equal((await health()).providerReady, false);
});

test('corrupt artifacts cannot replace a previously installed file', async t => {
  const f = await fixture(t);
  f.server.on('request', (req, res) => res.end('corrupted-download'));
  const target = path.join(f.directory, 'artifact');
  await fs.writeFile(target, 'previous-install');
  const expected = crypto.createHash('sha256').update('expected-content').digest('hex');
  await assert.rejects(verifiedDownload(f.url, target, expected), /Checksum mismatch/);
  assert.equal(await fs.readFile(target, 'utf8'), 'previous-install');
  assert.deepEqual((await fs.readdir(f.directory)), ['artifact']);
});

test('metadata and media share the same plugin, client and network configuration', () => {
  const args = buildYtDlpArgs({ env: { YTDLP_PROXY: 'http://user:secret@proxy.example:8000', POT_PORT: '4450' } });
  assert.equal(args[args.indexOf('--proxy') + 1], 'http://user:secret@proxy.example:8000');
  assert.ok(args.includes('youtubepot-bgutilhttp:base_url=http://127.0.0.1:4450'));
  assert.ok(args.includes('youtube:player_client=mweb'));
  assert.ok(args.includes('--abort-on-unavailable-fragments'));
  assert.equal(args[args.indexOf('--fragment-retries') + 1], '2');
  assert.ok(!args.includes('--cookies'), 'guest mode does not use an owner session');
  assert.throws(() => buildYtDlpArgs({ env: { POT_PORT: 'invalid' } }), /POT_PORT/);
});
