'use strict';

// Explicit, billable-bandwidth smoke check: never runs as a health probe.
// Uses one short public test video and fully decodes the resulting media.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');

async function main() {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
  const base = options.base || 'http://127.0.0.1:3000';
  const video = options.video || 'jNQXAC9IVRw';
  if (!/^[\w-]{11}$/.test(video)) throw new Error('--video must be an 11-character YouTube video ID.');
  const started = Date.now();
  const url = `https://www.youtube.com/watch?v=${video}`;
  const response = await fetch(`${base}/api/info?${new URLSearchParams({ url })}`, { signal: AbortSignal.timeout(180000) });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Metadata HTTP ${response.status}: ${body.code || ''} ${body.error || ''}`);
  if (!Number.isFinite(body.data.duration) || body.data.duration > 90) throw new Error('Choose a public test video under 90 seconds to bound bandwidth and conversion work.');
  console.log(`[verify] Metadata: ${video}, ${body.data.totalOptionsCount} options, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const ready = [...body.data.readyFormats].filter(format => format.height <= 720).sort((a, b) => b.height - a.height)[0];
  const audio = body.data.mp3Formats.find(format => format.bitrate === '128k');
  if (!ready || !audio) throw new Error('Both a combined MP4 selection and MP3 source are required.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tubeswift-verify-'));
  try {
    for (const format of [ready, audio]) {
      const params = new URLSearchParams({ url, format: format.format_id, ext: format.ext, category: format.category,
        quality: format.bitrate || format.quality, ...(format.height ? { height: String(format.height) } : {}) });
      const download = await fetch(`${base}/api/download?${params}`, { signal: AbortSignal.timeout(660000) });
      if (!download.ok) {
        const failure = await download.json();
        throw new Error(`${format.ext} HTTP ${download.status}: ${failure.code || ''} ${failure.error || ''}`);
      }
      if (!download.headers.get('content-disposition')?.includes(`.${format.ext}`)) throw new Error('Missing download attachment filename.');
      const file = path.join(directory, `media.${format.ext}`);
      const bytes = Buffer.from(await download.arrayBuffer());
      if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('Unexpected test download size.');
      await fs.writeFile(file, bytes);
      const args = ['-v', 'error', '-xerror', '-f', format.ext === 'mp4' ? 'mov' : 'mp3', '-i', file];
      if (format.ext === 'mp4') args.push('-map', '0:v:0');
      args.push('-map', '0:a:0', '-f', 'null', '-');
      await new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = '';
        child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`Media decode failed: ${errors}`)));
      });
      console.log(`[verify] ${format.ext.toUpperCase()}: ${bytes.length} bytes; complete decode passed${format.ext === 'mp4' ? ' (video + audio)' : ''}.`);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { console.error(`[verify] ${error.message}`); process.exitCode = 1; });
