const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const { buildVideoInfo } = require('./lib/video-info');
const { UpstreamGuard } = require('./lib/upstream-guard');
const { VideoInfoCache } = require('./lib/video-cache');
const FFMPEG_PATH = require('ffmpeg-static') || 'ffmpeg';

const app = express();
const PORT = process.env.PORT || 3000;
const upstreamGuard = new UpstreamGuard();
const videoInfoCache = new VideoInfoCache({ ttlMs: 60 * 60 * 1000, maxItems: 300 });
// Public downloads can run in guest mode or use configured session cookies.
// Uses configured cookies (e.g. YOUTUBE_COOKIES_BASE64 on Render) if present,
// unless YOUTUBE_AUTH_MODE=guest is explicitly set.
const USE_COOKIES = process.env.YOUTUBE_AUTH_MODE !== 'guest';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for uptime monitors and warmup pings
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});


const RENDER_COOKIES_PATH = '/etc/secrets/cookies.txt';
const LOCAL_COOKIES_PATH = path.join(__dirname, 'cookies.txt');
let COOKIES_PATH = null;
let runtimeCookiesDir = null;
process.once('exit', () => {
  if (runtimeCookiesDir) fs.rmSync(runtimeCookiesDir, { recursive: true, force: true });
});

function writeCookies(value) {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/.test(normalized)) {
    throw new Error('Cookies must be an exported Netscape cookie file.');
  }
  // yt-dlp writes its cookie jar on exit. Keep mounted secrets and the
  // original export untouched by using a private, writable runtime copy.
  runtimeCookiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeswift-'));
  const targetPath = path.join(runtimeCookiesDir, 'cookies.txt');
  fs.writeFileSync(targetPath, normalized, { encoding: 'utf-8', mode: 0o600 });
  try { fs.chmodSync(targetPath, 0o600); } catch (_) {}
  COOKIES_PATH = targetPath;
}

// Initialize cookies from environment variables if set (for Render / cloud deployments)
if (USE_COOKIES) {
  const cookieSources = [
    process.env.YOUTUBE_COOKIES_BASE64 && 'YOUTUBE_COOKIES_BASE64',
    process.env.YOUTUBE_COOKIES && 'YOUTUBE_COOKIES',
    fs.existsSync(RENDER_COOKIES_PATH) && RENDER_COOKIES_PATH
  ].filter(Boolean);
  if (cookieSources.length > 1) {
    console.warn(`[WARN] Multiple YouTube cookie sources configured. Using ${cookieSources[0]}; remove older sources before refreshing a lower-priority source.`);
  }
  if (process.env.YOUTUBE_COOKIES_BASE64) {
    try {
      const decoded = Buffer.from(process.env.YOUTUBE_COOKIES_BASE64, 'base64').toString('utf-8');
      writeCookies(decoded);
      console.log('[INFO] Loaded YouTube cookies from YOUTUBE_COOKIES_BASE64 env.');
    } catch (err) {
      console.error('[ERR] Failed to decode YOUTUBE_COOKIES_BASE64:', err);
    }
  } else if (process.env.YOUTUBE_COOKIES) {
    try {
      writeCookies(process.env.YOUTUBE_COOKIES);
      console.log('[INFO] Loaded YouTube cookies from YOUTUBE_COOKIES env.');
    } catch (err) {
      console.error('[ERR] Failed to write YOUTUBE_COOKIES:', err);
    }
  } else {
    const source = fs.existsSync(RENDER_COOKIES_PATH) ? RENDER_COOKIES_PATH : LOCAL_COOKIES_PATH;
    if (fs.existsSync(source)) {
      try {
        writeCookies(fs.readFileSync(source, 'utf-8'));
        console.log(`[INFO] Loaded YouTube cookies from ${source} into a writable runtime copy.`);
      } catch (err) {
        console.error('[ERR] Failed to load YouTube cookie file:', err.message);
      }
    }
  }
  if (!COOKIES_PATH) console.warn('[WARN] No valid YouTube cookie file loaded. Requests will use a guest session.');
} else {
  console.log('[INFO] Public YouTube downloads use a guest session (YOUTUBE_AUTH_MODE=guest).');
}
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.warn('[WARN] YouTube JavaScript challenge solving requires Node.js 22 or newer.');
}

// Locate yt-dlp executable
function getYtDlpPath() {
  const possiblePaths = [
    ...(process.platform === 'darwin' ? [path.join(__dirname, 'yt-dlp_macos')] : []),
    path.join(__dirname, 'yt-dlp'),
    ...(process.platform === 'darwin' ? ['/tmp/yt-dlp_macos'] : []),
    '/Users/shakilsarker/Library/Python/3.9/bin/yt-dlp',
    'yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp'
  ];
  for (const p of possiblePaths) {
    try {
      if (p.startsWith('/') || p.includes('/')) {
        if (fs.existsSync(p)) return p;
      } else {
        execSync(`which ${p}`, { stdio: 'ignore' });
        return p;
      }
    } catch (e) {}
  }
  return 'yt-dlp';
}

const YTDLP_PATH = getYtDlpPath();
console.log(`[INFO] Using yt-dlp at: ${YTDLP_PATH}`);

// Let yt-dlp select compatible YouTube clients for the current release.
function getBaseYtDlpArgs() {
  const args = [
    '--ignore-config',
    '--socket-timeout', '20',
    '--retries', '0',
    '--extractor-retries', '0',
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '--no-playlist'
  ];
  if (COOKIES_PATH && fs.existsSync(COOKIES_PATH)) {
    args.push('--cookies', COOKIES_PATH);
  }
  return args;
}

function describeYtDlpError(stderr) {
  upstreamGuard.recordFailure(stderr);
  if (/HTTP Error 429/i.test(stderr)) {
    return { status: 503, code: 'YOUTUBE_RATE_LIMITED', retryAfter: 120, message: 'YouTube is temporarily limiting downloads from this server. Please try again in 2 minutes.' };
  }
  if (/cookies are no longer valid|cookies.*(?:expired|invalid)/i.test(stderr)) {
    return { status: 503, code: 'YOUTUBE_COOKIES_EXPIRED', message: 'The server YouTube login has expired. The site administrator needs to refresh the saved session.' };
  }
  if (/sign in to confirm|not a bot/i.test(stderr)) {
    return { status: 503, code: 'YOUTUBE_SESSION_REJECTED', retryAfter: 120, message: 'YouTube is currently rejecting requests from this server. Please try again later.' };
  }
  if (/private video|video unavailable|video is unavailable|has been removed|not available in your country/i.test(stderr)) {
    return { status: 404, code: 'VIDEO_UNAVAILABLE', message: 'This video is unavailable, private, or restricted.' };
  }
  return { status: 502, code: 'YOUTUBE_REQUEST_FAILED', message: 'YouTube could not provide this video. Please try again later.' };
}

// Clean filename for HTTP Content-Disposition (Pure safe characters for all OS)
function sanitizeFilename(name) {
  return (name || 'video')
    .replace(/[^\w\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 60) || 'TubeSwift_Video';
}

// Extract YouTube Video ID
function extractVideoId(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// Bound CPU/memory use and avoid repeatedly contacting an upstream that has
// rejected this instance. Queued requests can be cancelled and cannot grow
// without limit. This is a capacity guard, not a durable background job queue.
app.use(['/api/info', '/api/download'], async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const videoId = extractVideoId(req.query.url);
  if (!videoId) return next();

  // Instant In-Memory Cache: return in 0ms without waiting on an upstream slot
  if (req.path === '/api/info') {
    const cached = videoInfoCache.get(videoId);
    if (cached) {
      console.log(`[INFO] Cache HIT for video ${videoId} (instant response)`);
      return res.json({ success: true, data: cached, cached: true });
    }
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    const release = await upstreamGuard.acquire(controller.signal);
    res.off('close', abort);
    if (res.destroyed) { release(); return; }
    res.once('finish', release);
    res.once('close', release);
    return next();
  } catch (err) {
    res.off('close', abort);
    if (err.code === 'ABORTED' || res.destroyed) return;
    res.set('Retry-After', String(err.retryAfter || 10));
    return res.status(503).json({ success: false, code: err.code, retryAfter: err.retryAfter || 10, error: err.message });
  }
});

// API: Get Video Information & Available Formats
app.get('/api/info', (req, res) => {
  const videoId = extractVideoId(typeof req.query.url === 'string' ? req.query.url : '');
  if (!videoId) {
    return res.status(400).json({ success: false, error: 'Please provide a valid YouTube video or Shorts URL.' });
  }

  // Double check cache
  const cached = videoInfoCache.get(videoId);
  if (cached) {
    return res.json({ success: true, data: cached, cached: true });
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const proc = spawn(YTDLP_PATH, [
    ...getBaseYtDlpArgs(), '--ffmpeg-location', FFMPEG_PATH,
    '--dump-single-json', '--skip-download',
    '--no-write-comments',
    '--no-write-subs',
    '--no-write-auto-subs',
    cleanUrl
  ], { detached: process.platform !== 'win32' });
  let stdout = '';
  let stderr = '';
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, 'SIGKILL');
      else proc.kill('SIGKILL');
    } catch (_) {}
  }
  const timer = setTimeout(() => {
    stop();
    if (!res.headersSent && !res.destroyed) res.status(504).json({ success: false, error: 'YouTube took too long to respond. Please try again later.' });
  }, 60000);
  res.on('close', () => {
    clearTimeout(timer);
    if (!res.writableEnded) stop();
  });
  proc.stdout.on('data', data => {
    stdout += data.toString();
    if (stdout.length > 8 * 1024 * 1024) {
      stop();
      if (!res.headersSent && !res.destroyed) res.status(502).json({ success: false, error: 'The video information was too large to process.' });
    }
  });
  proc.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-32768); });
  proc.on('error', () => {
    clearTimeout(timer);
    if (!res.headersSent && !res.destroyed) res.status(503).json({ success: false, error: 'The video service could not start. Please contact the site administrator.' });
  });
  proc.on('close', code => {
    clearTimeout(timer);
    if (res.headersSent || res.destroyed) return;
    if (code !== 0 || !stdout.trim()) {
      console.warn(`[WARN] YouTube extraction failed for ${videoId}: ${stderr}`);
      const failure = describeYtDlpError(stderr);
      if (failure.retryAfter) res.set('Retry-After', String(failure.retryAfter));
      return res.status(failure.status).json({ success: false, code: failure.code, error: failure.message });
    }
    try {
      const data = buildVideoInfo(JSON.parse(stdout), videoId);
      if (!data.totalOptionsCount) {
        return res.status(502).json({ success: false, error: 'YouTube did not provide any downloadable formats for this video.' });
      }
      videoInfoCache.set(videoId, data);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ERR] Could not process video information:', err.message);
      return res.status(502).json({ success: false, error: 'Could not process the video information.' });
    }
  });
});

// API: Stream / Download Video or Audio (All Formats Handled)
// Complete merging/conversion before serving a file. yt-dlp skips its audio
// postprocessors for stdout output, so `-x -o -` cannot produce a real MP3.
app.get(['/api/download', '/api/download/:filename'], (req, res) => {
  const fields = ['url', 'format', 'ext', 'title', 'quality', 'category', 'height'];
  if (fields.some(key => req.query[key] !== undefined && typeof req.query[key] !== 'string')) {
    return res.status(400).json({ success: false, error: 'Invalid download parameters.' });
  }
  const { url, format = '', ext = 'mp4', title, quality = '', category = '', height = '' } = req.query;
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ success: false, error: 'Invalid YouTube URL.' });

  const fileExt = ext.toLowerCase();
  const safeId = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  const exactFormats = format.split('+');
  const isExact = format.length <= 160 && exactFormats.length <= 2 && exactFormats.every(id => safeId.test(id));
  const legacyReady = /^bestvideo\[height<=(720|1080)\]\+bestaudio\/best\[height<=\1\]\/18$/.test(format);
  if (!['mp4', 'webm', 'm4a', 'mp3'].includes(fileExt) ||
      !['', 'ready', 'video_high', 'video', 'audio_only', 'mp3'].includes(category) ||
      (height && (!/^\d{1,4}$/.test(height) || Number(height) < 1 || Number(height) > 4320)) ||
      (format && !isExact && !(category === 'ready' && legacyReady)) ||
      (category === 'ready' && fileExt !== 'mp4') ||
      (category === 'mp3' && fileExt !== 'mp3') ||
      (category === 'audio_only' && !['webm', 'm4a'].includes(fileExt)) ||
      (['video_high', 'video'].includes(category) && !['mp4', 'webm'].includes(fileExt))) {
    return res.status(400).json({ success: false, error: 'Unsupported download format.' });
  }

  const dlArgs = [...getBaseYtDlpArgs(), '--ffmpeg-location', FFMPEG_PATH, '--no-progress', '--no-simulate'];
  if (fileExt === 'mp3') {
    // Accept both the dropdown's "320k" and older buttons' "320 kbps".
    const bitrate = quality ? quality.trim().match(/^(128|192|256|320)\s*(?:k|kbps)?$/i) : ['', '320'];
    if (!bitrate) return res.status(400).json({ success: false, error: 'Unsupported MP3 bitrate.' });
    dlArgs.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${bitrate[1]}k`);
  } else if (fileExt === 'm4a') {
    if (exactFormats.length > 1) return res.status(400).json({ success: false, error: 'Choose one audio format.' });
    dlArgs.push('-f', format ? `${format}[acodec!=none][vcodec=none]` : 'bestaudio', '-x', '--audio-format', 'm4a');
  } else if (category === 'ready' || (!category && (!format || format === 'best'))) {
    const limit = Number(height || (format.includes('720') ? 720 : 1080));
    let selector;
    if (isExact && format !== 'best') {
      selector = exactFormats.length === 2
        ? `${exactFormats[0]}[ext=mp4][vcodec!=none][height<=${limit}]+${exactFormats[1]}[ext=m4a][acodec!=none][vcodec=none]`
        : `${format}[ext=mp4][vcodec!=none][acodec!=none][height<=${limit}]`;
    } else {
      selector = `bestvideo[ext=mp4][height<=${limit}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${limit}]`;
    }
    dlArgs.push('-f', selector, '--merge-output-format', 'mp4', '--remux-video', 'mp4');
  } else {
    if (!format || exactFormats.length !== 1) {
      return res.status(400).json({ success: false, error: 'Choose an available format first.' });
    }
    const mediaFilter = category === 'audio_only' ? '[acodec!=none][vcodec=none]' : '[vcodec!=none]';
    dlArgs.push('-f', `${format}[ext=${fileExt}]${mediaFilter}`);
  }

  let rawTitle = title || req.params.filename || 'TubeSwift_Video';
  if (rawTitle.toLowerCase().endsWith(`.${fileExt}`)) rawTitle = rawTitle.slice(0, -(fileExt.length + 1));
  const safeFilename = `${sanitizeFilename(rawTitle)}.${fileExt}`;
  const positiveLimit = (value, fallback, maximum) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
  };
  const timeoutMs = positiveLimit(process.env.DOWNLOAD_TIMEOUT_MS, 10 * 60 * 1000, 60 * 60 * 1000);
  const maxBytes = positiveLimit(process.env.MAX_DOWNLOAD_BYTES, 512 * 1024 * 1024, 10 * 1024 * 1024 * 1024);
  let tempDir;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeswift-download-'));
  } catch (err) {
    console.error('[ERR] Cannot create download directory:', err.message);
    return res.status(503).json({ success: false, error: 'Download storage is temporarily unavailable.' });
  }
  dlArgs.push('--max-filesize', String(maxBytes), '--print', 'after_move:filepath',
    '-o', path.join(tempDir, 'media.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`);

  let child;
  let childClosed = false;
  let responseStarted = false;
  let cancelled = false;
  let stopping = false;
  let cleaned = false;
  let stdout = '';
  let stderr = '';
  let timeout;
  let sizeMonitor;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      console.warn('[WARN] Could not clean download directory:', err.message);
    }
  };
  const stopTimers = () => { clearTimeout(timeout); clearInterval(sizeMonitor); };
  const stopChild = () => {
    if (stopping || childClosed || !child || !child.pid) return;
    stopping = true;
    const signal = sig => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch (_) {
        try { child.kill(sig); } catch (_) {}
      }
    };
    signal('SIGTERM');
    const forceKill = setTimeout(() => signal('SIGKILL'), 2000);
    forceKill.unref();
  };
  const fail = (status, message) => {
    if (responseStarted || res.destroyed || res.writableEnded) return;
    responseStarted = true;
    res.status(status).json({ success: false, error: message });
  };
  res.once('close', () => {
    if (!res.writableFinished) {
      cancelled = true;
      stopTimers();
      stopChild();
      if (childClosed) cleanup();
    }
  });

  try {
    child = spawn(YTDLP_PATH, dlArgs, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    cleanup();
    return fail(503, 'Download service could not start. Please contact the site administrator.');
  }
  child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-16384); });
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-65536); });
  child.once('error', err => {
    console.error('[ERR] Download process could not start:', err.message);
    childClosed = true;
    stopTimers();
    cleanup();
    fail(503, 'Download service could not start. Please contact the site administrator.');
  });
  child.once('close', code => {
    childClosed = true;
    stopTimers();
    if (cancelled || responseStarted || res.destroyed) return cleanup();
    if (code !== 0) {
      console.warn(`[WARN] Download failed with code ${code}: ${stderr}`);
      const failure = describeYtDlpError(stderr);
      if (failure.retryAfter) res.set('Retry-After', String(failure.retryAfter));
      cleanup();
      return fail(failure.status, failure.message);
    }
    const finalPath = path.resolve(stdout.trim().split(/\r?\n/).pop() || '');
    try {
      const stat = fs.lstatSync(finalPath);
      if (path.dirname(finalPath) !== tempDir || path.extname(finalPath).toLowerCase() !== `.${fileExt}` ||
          !stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maxBytes) {
        throw new Error('The output file did not match the requested format or size.');
      }
    } catch (err) {
      console.warn('[WARN] Invalid download output:', err.message);
      cleanup();
      return fail(502, 'The requested format could not be prepared. Please refresh the video and choose an available format.');
    }
    responseStarted = true;
    const contentType = fileExt === 'mp3' ? 'audio/mpeg' : fileExt === 'm4a' ? 'audio/mp4'
      : fileExt === 'webm' ? (category === 'audio_only' ? 'audio/webm' : 'video/webm') : 'video/mp4';
    res.set({ 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
    res.download(finalPath, safeFilename, err => {
      cleanup();
      if (err && !res.headersSent && !res.destroyed) {
        res.status(502).json({ success: false, error: 'The prepared file could not be sent. Please try again.' });
      }
    });
  });
  timeout = setTimeout(() => {
    stopChild();
    fail(504, 'The download took too long. Please try a shorter video or a lower quality.');
  }, timeoutMs);
  timeout.unref();
  sizeMonitor = setInterval(() => {
    try {
      const bytes = fs.readdirSync(tempDir).reduce((total, name) => {
        const stat = fs.lstatSync(path.join(tempDir, name));
        return total + (stat.isFile() ? stat.size : 0);
      }, 0);
      // Merging temporarily retains source streams beside the finished file.
      if (bytes > maxBytes * 3) {
        stopChild();
        fail(413, 'This download is too large. Please choose a shorter video or a lower quality.');
      }
    } catch (_) {}
  }, 2000);
  sizeMonitor.unref();
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Clean SEO URLs
// Clean SEO URLs
app.get('/youtube-video-downloader', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/youtube-shorts-downloader', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'youtube-shorts-downloader.html'));
});

app.get('/youtube-4k-downloader', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'youtube-4k-downloader.html'));
});

app.get('/youtube-to-mp4', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'youtube-to-mp4.html'));
});

app.get('/youtube-mp3-downloader', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'youtube-mp3-downloader.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// Catch-all route to index.html for SPA/HTML fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 TubeSwift Downloader Server Running at: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
