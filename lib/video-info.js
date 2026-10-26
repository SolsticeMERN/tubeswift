'use strict';

const SAFE_FORMAT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatDuration(duration) {
  if (duration === null) return 'Unknown';
  const seconds = Math.floor(duration);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}

function hasCodec(codec) {
  return typeof codec === 'string' && codec !== '' && codec !== 'none';
}

function downloadableFormat(format) {
  return format && SAFE_FORMAT_ID.test(String(format.format_id || '')) &&
    typeof format.url === 'string' && /^https?:\/\//i.test(format.url) &&
    !format.has_drm && (hasCodec(format.vcodec) || hasCodec(format.acodec));
}

function formatSize(format, duration) {
  const exact = positiveNumber(format.filesize);
  if (exact) return { bytes: exact, estimated: false };
  const approx = positiveNumber(format.filesize_approx);
  if (approx) return { bytes: approx, estimated: true };
  const bitrate = positiveNumber(format.tbr) || positiveNumber(format.abr) || positiveNumber(format.vbr);
  return bitrate && duration !== null && duration > 0
    ? { bytes: bitrate * 1000 / 8 * duration, estimated: true }
    : null;
}

function sizeLabel(size) {
  return size ? `${size.estimated ? '≈ ' : ''}${formatBytes(size.bytes)}` : 'Unknown';
}

function qualityLabel(format) {
  const height = positiveNumber(format.height);
  if (!height) return 'Video';
  const fps = positiveNumber(format.fps);
  return `${Math.round(height)}p${fps && fps > 30 ? Math.round(fps) : ''}`;
}

function resolutionLabel(format) {
  const width = positiveNumber(format.width);
  const height = positiveNumber(format.height);
  if (width && height) return `${Math.round(width)}x${Math.round(height)}`;
  return height ? `${Math.round(height)}p` : '';
}

function bitrate(format) {
  return positiveNumber(format.abr) || positiveNumber(format.tbr) || 0;
}

function compareVideo(a, b) {
  return (positiveNumber(b.height) || 0) - (positiveNumber(a.height) || 0) ||
    (positiveNumber(b.fps) || 0) - (positiveNumber(a.fps) || 0) ||
    (positiveNumber(b.tbr) || 0) - (positiveNumber(a.tbr) || 0);
}

function buildVideoInfo(info = {}, videoId) {
  const duration = typeof info.duration === 'number' && Number.isFinite(info.duration) && info.duration >= 0
    ? info.duration : null;
  const seen = new Set();
  const formats = (Array.isArray(info.formats) ? info.formats : []).filter(format => {
    if (!downloadableFormat(format) || seen.has(String(format.format_id))) return false;
    seen.add(String(format.format_id));
    return true;
  });
  const videos = formats.filter(format => hasCodec(format.vcodec)).sort(compareVideo);
  const audioOnly = formats.filter(format => !hasCodec(format.vcodec) && hasCodec(format.acodec))
    .sort((a, b) => bitrate(b) - bitrate(a));
  const m4aAudio = audioOnly.find(format => format.ext === 'm4a' && /^(mp4a|aac|alac)([.\d-]|$)/i.test(format.acodec));

  // Show one real MP4 option for each available height up to Full HD. Prefer an
  // existing combined stream; otherwise select exact MP4 video + AAC audio IDs.
  const readyByHeight = new Map();
  for (const format of videos) {
    const height = positiveNumber(format.height);
    if (format.ext !== 'mp4' || !height || height > 1080) continue;
    const progressive = hasCodec(format.acodec);
    if (!progressive && !m4aAudio) continue;
    const previous = readyByHeight.get(height);
    if (!previous || (!hasCodec(previous.acodec) && progressive)) readyByHeight.set(height, format);
  }

  const readyFormats = [...readyByHeight.values()].sort(compareVideo).map((format, index) => {
    const progressive = hasCodec(format.acodec);
    const videoSize = formatSize(format, duration);
    const audioSize = progressive ? null : formatSize(m4aAudio, duration);
    const size = progressive ? videoSize : videoSize && audioSize
      ? { bytes: videoSize.bytes + audioSize.bytes, estimated: true } : null;
    return {
      id: `ready-${format.format_id}`,
      format_id: progressive ? String(format.format_id) : `${format.format_id}+${m4aAudio.format_id}`,
      label: `${qualityLabel(format)} MP4 · Video + audio`,
      quality: qualityLabel(format),
      resolution: resolutionLabel(format),
      ext: 'mp4',
      height: format.height,
      size: sizeLabel(size),
      category: 'ready',
      isRecommended: index === 0
    };
  });

  const highQualityFormats = videos.filter(format => !hasCodec(format.acodec)).map(format => ({
    id: `video-${format.format_id}`,
    format_id: String(format.format_id),
    label: `${qualityLabel(format)} ${String(format.ext || '').toUpperCase()} · Video only`.trim(),
    quality: qualityLabel(format),
    resolution: resolutionLabel(format),
    ext: format.ext || '',
    height: positiveNumber(format.height),
    size: sizeLabel(formatSize(format, duration)),
    category: 'video_high'
  }));

  const nativeAudioFormats = audioOnly.map(format => {
    const kbps = bitrate(format);
    return {
      id: `audio-${format.format_id}`,
      format_id: String(format.format_id),
      label: `${String(format.ext || 'Audio').toUpperCase()} · Original audio${kbps ? ` · ${Math.round(kbps)} kbps` : ''}`,
      quality: `${String(format.ext || 'Audio').toUpperCase()}${kbps ? ` ${Math.round(kbps)} kbps` : ''}`,
      bitrate: kbps ? `${Math.round(kbps)}k` : '',
      ext: format.ext || '',
      size: sizeLabel(formatSize(format, duration)),
      category: 'audio_only'
    };
  });

  const audioSource = audioOnly[0] || formats.filter(format => hasCodec(format.acodec))
    .sort((a, b) => bitrate(b) - bitrate(a))[0];
  const mp3Formats = audioSource ? [320, 256, 192, 128].map(kbps => ({
    id: `mp3-${kbps}`,
    format_id: String(audioSource.format_id),
    label: `MP3 · ${kbps} kbps (conversion)`,
    quality: `${kbps} kbps`,
    description: 'Converted from the available audio. A higher output bitrate does not improve the source quality.',
    bitrate: `${kbps}k`,
    ext: 'mp3',
    size: duration !== null && duration > 0 ? sizeLabel({ bytes: kbps * 1000 / 8 * duration, estimated: true }) : 'Unknown',
    category: 'mp3'
  })) : [];

  const allOptions = [...readyFormats, ...highQualityFormats, ...mp3Formats, ...nativeAudioFormats];
  const thumbnail = typeof info.thumbnail === 'string' && info.thumbnail ? info.thumbnail :
    (Array.isArray(info.thumbnails) ? [...info.thumbnails].reverse().find(item => item && typeof item.url === 'string' && item.url) : null)?.url || null;

  return {
    id: videoId,
    title: info.title || '',
    author: info.uploader || info.channel || '',
    authorUrl: info.uploader_url || info.channel_url || null,
    thumbnail,
    duration,
    durationFormatted: info.duration_string || formatDuration(duration),
    views: typeof info.view_count === 'number' && Number.isFinite(info.view_count)
      ? info.view_count.toLocaleString('en-US') : null,
    allOptions,
    readyFormats,
    highQualityFormats,
    mp3Formats,
    nativeAudioFormats,
    videoFormats: [...readyFormats, ...highQualityFormats],
    audioFormats: [...mp3Formats, ...nativeAudioFormats],
    totalOptionsCount: allOptions.length
  };
}

module.exports = { buildVideoInfo };
