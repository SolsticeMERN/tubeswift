const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const FFMPEG_PATH = require('ffmpeg-static') || 'ffmpeg';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for uptime monitors and warmup pings
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});


let COOKIES_PATH = fs.existsSync('/etc/secrets/cookies.txt')
  ? '/etc/secrets/cookies.txt'
  : path.join(__dirname, 'cookies.txt');

function writeCookies(value) {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/.test(normalized)) {
    throw new Error('Cookies must be an exported Netscape cookie file.');
  }
  const targetPath = path.join(__dirname, 'cookies.txt');
  fs.writeFileSync(targetPath, normalized, { encoding: 'utf-8', mode: 0o600 });
  try { fs.chmodSync(targetPath, 0o600); } catch (_) {}
  COOKIES_PATH = targetPath;
}

// Initialize cookies from environment variables if set (for Render / cloud deployments)
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
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--extractor-args', 'youtube:player_client=web,mweb,web_embedded',
    '--no-playlist'
  ];
  if (fs.existsSync(COOKIES_PATH)) {
    args.push('--cookies', COOKIES_PATH);
  }
  return args;
}

function describeYtDlpError(stderr) {
  if (/sign in to confirm|not a bot|cookies are no longer valid/i.test(stderr)) {
    return {
      status: 503,
      message: 'YouTube rejected the server session. The site administrator must refresh the YouTube cookies and check whether the hosting IP is blocked. Choosing another format will not fix this.'
    };
  }
  return { status: 502, message: 'YouTube could not provide this video. It may be unavailable or restricted. Please try again later.' };
}

// Helper to format duration seconds to MM:SS or HH:MM:SS
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper to format byte sizes
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return null;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// API: Get Video Information & Available Formats
app.get('/api/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ success: false, error: 'Please provide a valid YouTube URL.' });
  }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    return res.status(400).json({
      success: false,
      error: 'Invalid YouTube link. Please paste a standard video or Shorts URL (e.g. https://youtu.be/... or https://www.youtube.com/watch?v=...)'
    });
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    ...getBaseYtDlpArgs(),
    '--dump-single-json',
    cleanUrl
  ];

  console.log(`[INFO] Fetching full format list for ID: ${videoId}`);

  let stdoutData = '';
  let stderrData = '';
  const proc = spawn(YTDLP_PATH, args);

  proc.stdout.on('data', chunk => {
    stdoutData += chunk.toString();
  });

  proc.stderr.on('data', chunk => {
    stderrData += chunk.toString();
  });

  proc.on('error', () => {
    if (!res.headersSent) res.status(503).json({ success: false, error: 'Video service could not start. Please contact the site administrator.' });
  });

  proc.on('close', async (code) => {
    if (res.headersSent || res.destroyed) return;
    if (code !== 0 || !stdoutData.trim()) {
      console.warn(`[WARN] yt-dlp exited with code ${code}. Error: ${stderrData}`);
      const failure = describeYtDlpError(stderrData);
      return res.status(failure.status).json({ success: false, error: failure.message });
    }

    try {
      const info = JSON.parse(stdoutData);
      const dur = info.duration || 215; // default fallback duration in seconds
      const rawFormats = info.formats || [];

      // Helper to find exact filesize from yt-dlp formats
      const findFmtSize = (formatId, fallbackKbps) => {
        const found = rawFormats.find(f => String(f.format_id) === String(formatId));
        if (found) {
          const bytes = found.filesize || found.filesize_approx;
          if (bytes && !isNaN(bytes)) return formatBytes(bytes);
        }
        if (fallbackKbps) {
          const bytes = (fallbackKbps * 1000 / 8) * dur;
          return formatBytes(bytes);
        }
        return 'Available';
      };

      // Helper to estimate size from bitrate in kbps
      const calcSize = (kbps) => {
        const bytes = (kbps * 1000 / 8) * dur;
        return `≈ ${formatBytes(bytes)}`;
      };

      // Size for progressive 360p (itag 18)
      const fmt18 = rawFormats.find(f => String(f.format_id) === '18');
      const size18 = (fmt18 && (fmt18.filesize || fmt18.filesize_approx)) 
        ? formatBytes(fmt18.filesize || fmt18.filesize_approx) 
        : formatBytes((450 * 1000 / 8) * dur);

      // 1. Ready to Download (Video + Audio Combined)
      const readyFormats = [
        {
          id: 'ready-1080p',
          format_id: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/18',
          label: '★ 1080p Full HD MP4 — High Quality',
          quality: '1080p Full HD',
          resolution: '1920x1080',
          ext: 'mp4',
          height: 1080,
          size: findFmtSize('299') !== 'Available' ? findFmtSize('299') : formatBytes((4800 * 1000 / 8) * dur),
          category: 'ready',
          isRecommended: true
        },
        {
          id: 'ready-720p',
          format_id: 'bestvideo[height<=720]+bestaudio/best[height<=720]/18',
          label: '★ 720p HD MP4 — Fast & Clear',
          quality: '720p HD',
          resolution: '1280x720',
          ext: 'mp4',
          height: 720,
          size: findFmtSize('298') !== 'Available' ? findFmtSize('298') : formatBytes((2800 * 1000 / 8) * dur),
          category: 'ready',
          isRecommended: false
        },
        {
          id: 'ready-360p',
          format_id: '18',
          label: '★ 360p MP4 — Recommended (Instant)',
          quality: '360p SD',
          resolution: '640x360',
          ext: 'mp4',
          height: 360,
          size: size18,
          category: 'ready',
          isRecommended: true
        }
      ];

      // 2. High Quality Video Streams (Exact Itags & Resolutions matching SnapYT)
      const highQualityFormats = [
        { id: '2160p60-webm', format_id: '315', label: '2160p60 WEBM · 4K 60fps', quality: '2160p60 4K', resolution: '3840x2160', ext: 'webm', height: 2160, size: findFmtSize('315', 18000), category: 'video_high' },
        { id: '2160p60-mp4', format_id: '401', label: '2160p60 MP4 (AV1) · 4K 60fps', quality: '2160p60 4K', resolution: '3840x2160', ext: 'mp4', height: 2160, size: findFmtSize('401', 9500), category: 'video_high' },
        { id: '1440p60-webm', format_id: '308', label: '1440p60 WEBM · 2K 60fps', quality: '1440p60 2K', resolution: '2560x1440', ext: 'webm', height: 1440, size: findFmtSize('308', 6500), category: 'video_high' },
        { id: '1440p60-mp4', format_id: '400', label: '1440p60 MP4 (AV1) · 2K 60fps', quality: '1440p60 2K', resolution: '2560x1440', ext: 'mp4', height: 1440, size: findFmtSize('400', 4200), category: 'video_high' },
        { id: '1080p60-mp4', format_id: '299', label: '1080p60 MP4 · Full HD 60fps', quality: '1080p60 FHD', resolution: '1920x1080', ext: 'mp4', height: 1080, size: findFmtSize('299', 3800), category: 'video_high' },
        { id: '1080p60-webm', format_id: '303', label: '1080p60 WEBM · Full HD 60fps', quality: '1080p60 FHD', resolution: '1920x1080', ext: 'webm', height: 1080, size: findFmtSize('303', 2900), category: 'video_high' },
        { id: '1080p-mp4', format_id: '137', label: '1080p MP4 · Full HD', quality: '1080p FHD', resolution: '1920x1080', ext: 'mp4', height: 1080, size: findFmtSize('137', 2500), category: 'video_high' },
        { id: '720p60-mp4', format_id: '298', label: '720p60 MP4 · HD 60fps', quality: '720p60 HD', resolution: '1280x720', ext: 'mp4', height: 720, size: findFmtSize('298', 2200), category: 'video_high' },
        { id: '720p60-webm', format_id: '302', label: '720p60 WEBM · HD 60fps', quality: '720p60 HD', resolution: '1280x720', ext: 'webm', height: 720, size: findFmtSize('302', 1400), category: 'video_high' },
        { id: '720p-mp4', format_id: '136', label: '720p MP4 · HD', quality: '720p HD', resolution: '1280x720', ext: 'mp4', height: 720, size: findFmtSize('136', 1300), category: 'video_high' },
        { id: '720p-webm', format_id: '247', label: '720p WEBM · HD', quality: '720p HD', resolution: '1280x720', ext: 'webm', height: 720, size: findFmtSize('247', 900), category: 'video_high' },
        { id: '480p-mp4', format_id: '135', label: '480p MP4 · Standard', quality: '480p SD', resolution: '854x480', ext: 'mp4', height: 480, size: findFmtSize('135', 550), category: 'video_high' },
        { id: '480p-webm', format_id: '244', label: '480p WEBM', quality: '480p SD', resolution: '854x480', ext: 'webm', height: 480, size: findFmtSize('244', 480), category: 'video_high' },
        { id: '360p-webm', format_id: '243', label: '360p WEBM', quality: '360p SD', resolution: '640x360', ext: 'webm', height: 360, size: findFmtSize('243', 310), category: 'video_high' },
        { id: '360p-mp4', format_id: '134', label: '360p MP4', quality: '360p SD', resolution: '640x360', ext: 'mp4', height: 360, size: findFmtSize('134', 300), category: 'video_high' },
        { id: '240p-mp4', format_id: '133', label: '240p MP4', quality: '240p Low', resolution: '426x240', ext: 'mp4', height: 240, size: findFmtSize('133', 160), category: 'video_high' },
        { id: '240p-webm', format_id: '242', label: '240p WEBM', quality: '240p Low', resolution: '426x240', ext: 'webm', height: 240, size: findFmtSize('242', 150), category: 'video_high' },
        { id: '144p-webm', format_id: '278', label: '144p WEBM', quality: '144p Mobile', resolution: '256x144', ext: 'webm', height: 144, size: findFmtSize('278', 80), category: 'video_high' },
        { id: '144p-mp4', format_id: '160', label: '144p MP4', quality: '144p Mobile', resolution: '256x144', ext: 'mp4', height: 144, size: findFmtSize('160', 75), category: 'video_high' }
      ];

      // 3. MP3 Formats (Studio Transcoded)
      const mp3Formats = [
        { id: 'mp3-320', format_id: '18', label: 'MP3 · 320 kbps (Studio Quality)', quality: '320 kbps', bitrate: '320k', ext: 'mp3', size: calcSize(320), category: 'mp3' },
        { id: 'mp3-256', format_id: '18', label: 'MP3 · 256 kbps (Premium Quality)', quality: '256 kbps', bitrate: '256k', ext: 'mp3', size: calcSize(256), category: 'mp3' },
        { id: 'mp3-192', format_id: '18', label: 'MP3 · 192 kbps (Standard Quality)', quality: '192 kbps', bitrate: '192k', ext: 'mp3', size: calcSize(192), category: 'mp3' },
        { id: 'mp3-128', format_id: '18', label: 'MP3 · 128 kbps (Compact / Mobile)', quality: '128 kbps', bitrate: '128k', ext: 'mp3', size: calcSize(128), category: 'mp3' }
      ];

      // 4. Native Audio Only
      const nativeAudioFormats = [
        { id: 'audio-opus-156', format_id: '251', label: 'Opus Audio · 156 kbps (High Fidelity)', quality: 'Opus 156k', bitrate: '156k', ext: 'webm', size: findFmtSize('251', 156), category: 'audio_only' },
        { id: 'audio-m4a', format_id: '140', label: 'M4A Audio · 131 kbps (Original Apple AAC)', quality: 'M4A AAC', bitrate: '131k', ext: 'm4a', size: findFmtSize('140', 131), category: 'audio_only' },
        { id: 'audio-opus-82', format_id: '250', label: 'Opus Audio · 82 kbps (Standard)', quality: 'Opus 82k', bitrate: '82k', ext: 'webm', size: findFmtSize('250', 82), category: 'audio_only' },
        { id: 'audio-opus-64', format_id: '249', label: 'Opus Audio · 64 kbps (Low Data)', quality: 'Opus 64k', bitrate: '64k', ext: 'webm', size: findFmtSize('249', 64), category: 'audio_only' }
      ];

      // Flat combined array
      const allOptions = [
        ...readyFormats,
        ...highQualityFormats,
        ...mp3Formats,
        ...nativeAudioFormats
      ];

      // Combined arrays for backwards compatibility
      const videoFormats = [...readyFormats, ...highQualityFormats];
      const audioFormats = [...mp3Formats, ...nativeAudioFormats];

      // Pick best thumbnail
      let bestThumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      if (info.thumbnails && info.thumbnails.length > 0) {
        bestThumbnail = info.thumbnails[info.thumbnails.length - 1].url || bestThumbnail;
      }

      return res.json({
        success: true,
        data: {
          id: videoId,
          title: info.title || 'YouTube Video',
          author: info.uploader || info.channel || 'YouTube Creator',
          authorUrl: info.uploader_url || `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: bestThumbnail,
          duration: dur,
          durationFormatted: info.duration_string || formatDuration(dur),
          views: info.view_count ? info.view_count.toLocaleString() : null,
          allOptions: allOptions,
          readyFormats: readyFormats,
          highQualityFormats: highQualityFormats,
          mp3Formats: mp3Formats,
          nativeAudioFormats: nativeAudioFormats,
          videoFormats: videoFormats,
          audioFormats: audioFormats,
          totalOptionsCount: allOptions.length
        }
      });

    } catch (parseErr) {
      console.error('[ERR] JSON parsing failed:', parseErr);
      return res.status(500).json({ success: false, error: 'Failed to process video information.' });
    }
  });
});

// API: Stream / Download Video or Audio (All Formats Handled)
app.get(['/api/download', '/api/download/:filename'], (req, res) => {
  const { url, format, ext, title, quality, category, height } = req.query;

  if (!url) {
    return res.status(400).send('URL is required');
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).send('Invalid YouTube URL');
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fileExt = (ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  let rawTitle = title || req.params.filename || 'TubeSwift_Video';
  if (rawTitle.toLowerCase().endsWith(`.${fileExt}`)) {
    rawTitle = rawTitle.slice(0, -(fileExt.length + 1));
  }
  const cleanTitle = sanitizeFilename(rawTitle);
  const safeFilename = `${cleanTitle}.${fileExt}`;

  let contentType = 'video/mp4';
  if (fileExt === 'mp3') {
    contentType = 'audio/mpeg';
  } else if (fileExt === 'm4a') {
    contentType = 'audio/mp4';
  } else if (fileExt === 'webm') {
    contentType = category === 'audio_only' ? 'audio/webm' : 'video/webm';
  }

  let dlArgs = [...getBaseYtDlpArgs()];

  if (fileExt === 'mp3') {
    // Transcode audio on the fly with ffmpeg
    dlArgs.push(
      '--ffmpeg-location', FFMPEG_PATH,
      '-f', 'ba/b',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', quality || '320k',
      '-o', '-',
      cleanUrl
    );
  } else if (fileExt === 'm4a') {
    // Extract AAC audio
    dlArgs.push(
      '--ffmpeg-location', FFMPEG_PATH,
      '-f', '140/ba/b',
      '-x',
      '--audio-format', 'm4a',
      '-o', '-',
      cleanUrl
    );
  } else if (category === 'ready') {
    if (format === '18') {
      // Instant progressive 360p with audio
      dlArgs.push(
        '-f', '18/b',
        '-o', '-',
        cleanUrl
      );
    } else {
      // 1080p / 720p merged with audio via ffmpeg
      const h = height || (String(format || '').includes('1080') ? 1080 : 720);
      dlArgs.push(
        '--ffmpeg-location', FFMPEG_PATH,
        '-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/18/best`,
        '--merge-output-format', 'mp4',
        '-o', '-',
        cleanUrl
      );
    }
  } else {
    // High-res video stream or audio stream
    const targetFmt = format || 'best';
    dlArgs.push(
      '--ffmpeg-location', FFMPEG_PATH,
      '-f', `${targetFmt}/18/best`,
      '-o', '-',
      cleanUrl
    );
  }

  const child = spawn(YTDLP_PATH, dlArgs);

  let headersSent = false;
  let stderrOutput = '';

  child.stdout.on('data', chunk => {
    if (!headersSent) {
      headersSent = true;
      // Send 200 headers ONLY when real video/audio data is actively flowing
      res.writeHead(200, {
        'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*'
      });
    }
    res.write(chunk);
  });

  child.stderr.on('data', data => {
    const msg = data.toString();
    stderrOutput += msg;
    if (!msg.includes('Deprecated Feature') && !msg.includes('NotOpenSSLWarning')) {
      console.error(`[YTDLP STDERR] ${msg.trim()}`);
    }
  });

  child.on('error', err => {
    console.error('[ERR] Process spawn error:', err);
    if (!headersSent) {
      res.status(500).send('Download stream failed to initialize.');
    }
  });

  child.on('close', code => {
    console.log(`[INFO] Download stream completed with code ${code}`);
    if (res.writableEnded || res.destroyed) return;
    if (!headersSent) {
      // yt-dlp errored before producing any data - do NOT send a 0-byte corrupt file
      console.error(`[ERR] yt-dlp failed with code ${code} without data: ${stderrOutput}`);
      const failure = describeYtDlpError(stderrOutput);
      res.status(failure.status).send(failure.message);
    } else {
      res.end();
    }
  });

  // If user cancels download or closes tab, kill child process cleanly
  res.on('close', () => {
    if (!res.writableEnded && !child.killed) {
      console.log('[INFO] Client disconnected, killing download process');
      child.kill('SIGINT');
    }
  });
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
