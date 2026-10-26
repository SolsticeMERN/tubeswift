const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const express = require('express');

// Exercise the real route over HTTP while replacing only the external download
// process. Filesystem checks, response streaming and cleanup remain real.
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeSource = serverSource.slice(serverSource.indexOf('// API: Stream / Download'),
  serverSource.indexOf('// Serve static frontend assets'));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function setup(t, behavior, env = {}) {
  const app = express();
  const calls = [];
  const signals = [];
  const spawn = (executable, args, options) => {
    const child = new EventEmitter();
    child.pid = 900000 + calls.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const directory = path.dirname(args[args.indexOf('-o') + 1]);
    const call = { executable, args, options, child, directory };
    call.finish = (ext, contents = 'fixture media', code = 0) => {
      const output = path.join(directory, `media.${ext}`);
      fs.writeFileSync(output, contents);
      child.stdout.write(`${output}\n`);
      child.emit('close', code);
    };
    calls.push(call);
    setImmediate(() => Promise.resolve().then(() => behavior(call)).catch(err => child.emit('error', err)));
    return child;
  };
  vm.runInNewContext(routeSource, {
    app, fs, os, path, spawn, YTDLP_PATH: 'fixture-yt-dlp', FFMPEG_PATH: '/fixture/ffmpeg',
    process: {
      env, platform: process.platform,
      kill(pid, signal) {
        signals.push({ pid, signal });
        if (signal === 'SIGTERM') {
          const call = calls.find(item => item.child.pid === Math.abs(pid));
          if (call) setImmediate(() => call.child.emit('close', null));
        }
      }
    },
    getBaseYtDlpArgs: () => ['--no-playlist'],
    extractVideoId: url => typeof url === 'string' && /(?:youtu\.be\/|watch\?v=)([\w-]{11})/.exec(url)?.[1],
    sanitizeFilename: name => name.replace(/[^\w -]/g, '').trim().replace(/\s+/g, '_') || 'video',
    describeYtDlpError: stderr => /not a bot/i.test(stderr)
      ? { status: 503, message: 'YouTube rejected the server session.' }
      : { status: 502, message: 'The download failed.' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/download`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    calls.forEach(call => fs.rmSync(call.directory, { recursive: true, force: true }));
  });
  const url = params => `${base}?${new URLSearchParams({ url: 'https://youtu.be/abcdefghijk', ...params })}`;
  return { url, calls, signals };
}

test('MP3 waits for successful conversion and accepts the bitrate used by older row buttons', async t => {
  const started = deferred();
  const release = deferred();
  const fixture = await setup(t, async call => {
    started.resolve();
    await release.promise;
    call.finish('mp3', 'ID3-converted-mp3');
  });
  let receivedHeaders = false;
  const pending = fetch(fixture.url({ ext: 'mp3', category: 'mp3', quality: '320 kbps' }))
    .then(response => { receivedHeaders = true; return response; });
  await started.promise;
  assert.equal(receivedHeaders, false, 'do not announce a download before conversion finishes');
  const call = fixture.calls[0];
  assert.equal(call.args[call.args.indexOf('--audio-quality') + 1], '320k');
  assert.equal(call.args[call.args.indexOf('--audio-format') + 1], 'mp3');
  assert.notEqual(call.args[call.args.indexOf('-o') + 1], '-');
  assert.ok(call.args.includes('--no-simulate'));
  assert.ok(call.args.includes('after_move:filepath'));
  release.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /audio\/mpeg/);
  assert.match(response.headers.get('content-disposition'), /\.mp3/);
  assert.equal(await response.text(), 'ID3-converted-mp3');
  assert.equal(fs.existsSync(call.directory), false);
});

test('MP4 ready selection merges the advertised streams and remuxes to MP4', async t => {
  const fixture = await setup(t, call => call.finish('mp4'));
  const response = await fetch(fixture.url({ ext: 'mp4', category: 'ready', format: '137+140', height: '1080' }));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const args = fixture.calls[0].args;
  assert.equal(args[args.indexOf('-f') + 1],
    '137[ext=mp4][vcodec!=none][height<=1080]+140[ext=m4a][acodec!=none][vcodec=none]');
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4');
  assert.equal(args[args.indexOf('--remux-video') + 1], 'mp4');
});

test('an exact WEBM audio format cannot silently fall back to MP4 video', async t => {
  const fixture = await setup(t, call => call.finish('webm'));
  const response = await fetch(fixture.url({ ext: 'webm', category: 'audio_only', format: '251.0' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /audio\/webm/);
  await response.arrayBuffer();
  assert.equal(fixture.calls[0].args[fixture.calls[0].args.indexOf('-f') + 1],
    '251.0[ext=webm][acodec!=none][vcodec=none]');
});

test('M4A extraction uses a file so yt-dlp can run its audio postprocessor', async t => {
  const fixture = await setup(t, call => call.finish('m4a'));
  const response = await fetch(fixture.url({ ext: 'm4a', category: 'audio_only', format: '140' }));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const args = fixture.calls[0].args;
  assert.ok(args.includes('-x'));
  assert.equal(args[args.indexOf('--audio-format') + 1], 'm4a');
  assert.notEqual(args[args.indexOf('-o') + 1], '-');
});

test('partial file followed by downloader failure never becomes an attachment', async t => {
  const fixture = await setup(t, call => {
    call.child.stderr.write('Sign in to confirm you are not a bot');
    call.finish('mp3', 'partial original bytes', 1);
  });
  const response = await fetch(fixture.url({ ext: 'mp3' }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.equal((await response.json()).success, false);
  assert.equal(fs.existsSync(fixture.calls[0].directory), false);
});

test('rejects a successful process producing the wrong extension or an empty file', async t => {
  for (const [extension, contents] of [['webm', 'original audio'], ['mp3', '']]) {
    await t.test(`${extension} (${contents.length} bytes)`, async t => {
      const fixture = await setup(t, call => call.finish(extension, contents));
      const response = await fetch(fixture.url({ ext: 'mp3' }));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get('content-disposition'), null);
      await response.json();
      assert.equal(fs.existsSync(fixture.calls[0].directory), false);
    });
  }
});

test('invalid selectors, media types, heights and MP3 bitrates fail before spawning', async t => {
  const fixture = await setup(t, () => { throw new Error('must not spawn'); });
  for (const params of [
    { ext: 'exe' },
    { ext: 'webm', category: 'ready' },
    { ext: 'mp3', quality: 'lossless' },
    { ext: 'mp4', category: 'ready', height: '1080]/best' },
    { ext: 'mp4', category: 'video_high', format: '315/18/best' }
  ]) {
    const response = await fetch(fixture.url(params));
    assert.equal(response.status, 400);
    await response.json();
  }
  assert.equal(fixture.calls.length, 0);
});

test('timeout kills the entire process group and removes partial output', async t => {
  const fixture = await setup(t, call => {
    fs.writeFileSync(path.join(call.directory, 'media.webm.part'), 'partial');
  }, { DOWNLOAD_TIMEOUT_MS: '20' });
  const response = await fetch(fixture.url({ ext: 'mp3' }));
  assert.equal(response.status, 504);
  await response.json();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.signals[0].pid, -fixture.calls[0].child.pid);
  assert.equal(fixture.signals[0].signal, 'SIGTERM');
  assert.equal(fs.existsSync(fixture.calls[0].directory), false);
});

test('closing the HTTP request kills the process group and cleans its directory', async t => {
  const started = deferred();
  const fixture = await setup(t, call => {
    fs.writeFileSync(path.join(call.directory, 'media.webm.part'), 'partial');
    started.resolve();
  });
  const controller = new AbortController();
  const pending = fetch(fixture.url({ ext: 'mp3' }), { signal: controller.signal });
  await started.promise;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  for (let attempt = 0; attempt < 30 && fs.existsSync(fixture.calls[0].directory); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(fixture.signals[0].pid, -fixture.calls[0].child.pid);
  assert.equal(fs.existsSync(fixture.calls[0].directory), false);
});
