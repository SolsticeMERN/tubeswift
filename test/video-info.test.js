'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVideoInfo } = require('../lib/video-info');

function stream(format_id, overrides = {}) {
  return { format_id, url: 'https://media.example/video', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none',
    width: 1920, height: 1080, fps: 30, ...overrides };
}

function audio(format_id, overrides = {}) {
  return stream(format_id, { ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', width: null, height: null,
    abr: 128, ...overrides });
}

test('omits unavailable, DRM, storyboard, and unsafe format choices', () => {
  const data = buildVideoInfo({ formats: [
    stream('137', { url: undefined }),
    stream('399', { has_drm: true }),
    stream('sb0', { vcodec: 'none', acodec: 'none', ext: 'mhtml' }),
    stream('137/best'),
    audio('140', { url: 'file:///tmp/media' })
  ] }, 'knownVideo');
  assert.deepEqual(data.allOptions, []);
  assert.equal(data.totalOptionsCount, 0);
});

test('uses only actual MP4 heights and exact compatible audio and video IDs', () => {
  const data = buildVideoInfo({ duration: 60, formats: [
    stream('137', { filesize: 10 * 1024 ** 2 }),
    stream('136', { height: 720, width: 1280, filesize: 5 * 1024 ** 2 }),
    stream('401', { height: 2160, width: 3840 }),
    stream('18', { height: 360, width: 640, acodec: 'mp4a.40.2', filesize: 2 * 1024 ** 2 }),
    audio('140', { filesize: 1024 ** 2 })
  ] }, 'knownVideo');
  assert.deepEqual(data.readyFormats.map(format => format.height), [1080, 720, 360]);
  assert.deepEqual(data.readyFormats.map(format => format.format_id), ['137+140', '136+140', '18']);
  assert.equal(data.readyFormats[0].size, '≈ 11.00 MB');
  assert.equal(data.readyFormats[2].size, '2.00 MB');
  assert.deepEqual(data.highQualityFormats.map(format => format.format_id), ['401', '137', '136']);
  assert.equal(data.highQualityFormats[0].label, '2160p MP4 · Video only');
  assert.equal(data.totalOptionsCount, data.allOptions.length);
  assert.deepEqual(data.videoFormats, [...data.readyFormats, ...data.highQualityFormats]);
  assert.deepEqual(data.audioFormats, [...data.mp3Formats, ...data.nativeAudioFormats]);
});

test('does not invent MP4 combinations when only WebM audio exists', () => {
  const data = buildVideoInfo({ formats: [stream('137'), audio('251', { ext: 'webm', acodec: 'opus' })] }, 'id');
  assert.equal(data.readyFormats.length, 0);
  assert.deepEqual(data.highQualityFormats.map(format => format.format_id), ['137']);
  assert.deepEqual(data.nativeAudioFormats.map(format => format.format_id), ['251']);
});

test('a low resolution progressive stream stays low resolution and supports MP3 conversion', () => {
  const data = buildVideoInfo({ duration: 10, formats: [
    stream('18', { height: 360, width: 640, acodec: 'mp4a.40.2' })
  ] }, 'id');
  assert.deepEqual(data.readyFormats.map(format => format.height), [360]);
  assert.equal(data.nativeAudioFormats.length, 0);
  assert.deepEqual(data.mp3Formats.map(format => format.bitrate), ['320k', '256k', '192k', '128k']);
  assert.ok(data.mp3Formats.every(format => format.format_id === '18' && /conversion/.test(format.label)));
  assert.ok(data.mp3Formats.every(format => format.size.startsWith('≈ ')));
});

test('video without an audio source offers no audio or MP3 options', () => {
  const data = buildVideoInfo({ formats: [stream('137')] }, 'id');
  assert.equal(data.readyFormats.length, 0);
  assert.equal(data.mp3Formats.length, 0);
  assert.equal(data.nativeAudioFormats.length, 0);
  assert.equal(data.highQualityFormats.length, 1);
});

test('missing metadata and size are unknown rather than fabricated', () => {
  const data = buildVideoInfo({ formats: [audio('audio-main', { abr: undefined })] }, 'id');
  assert.equal(data.duration, null);
  assert.equal(data.durationFormatted, 'Unknown');
  assert.equal(data.title, '');
  assert.equal(data.author, '');
  assert.equal(data.thumbnail, null);
  assert.equal(data.nativeAudioFormats[0].size, 'Unknown');
  assert.ok(data.mp3Formats.every(format => format.size === 'Unknown'));
});

test('keeps provided metadata, zero views, actual frame rate and approximate sizes', () => {
  const data = buildVideoInfo({ title: 'A video', channel: 'A creator', channel_url: 'https://example.com/creator',
    duration: 3661, view_count: 0, thumbnails: [{ url: 'https://example.com/thumbnail.jpg' }], formats: [
      stream('video-main', { fps: 60, filesize_approx: 4 * 1024 ** 2 }),
      audio('audio-main', { abr: 160 })
    ] }, 'id');
  assert.equal(data.durationFormatted, '1:01:01');
  assert.equal(data.views, '0');
  assert.equal(data.title, 'A video');
  assert.equal(data.author, 'A creator');
  assert.equal(data.thumbnail, 'https://example.com/thumbnail.jpg');
  assert.equal(data.highQualityFormats[0].quality, '1080p60');
  assert.equal(data.highQualityFormats[0].size, '≈ 4.00 MB');
  assert.equal(data.nativeAudioFormats[0].bitrate, '160k');
  assert.ok(data.nativeAudioFormats[0].size.startsWith('≈ '));
});
