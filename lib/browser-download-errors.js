'use strict';

// Native attachments stream through an iframe without buffering a large Blob.
// Only the initiating window receives public errors; API clients retain JSON.
function browserDownloadErrors(req, res, next) {
  if (req.query.delivery !== 'frame') return next();
  const id = req.query.deliveryId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(id)) return next();
  let origin;
  try {
    const url = new URL(req.query.deliveryOrigin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== req.query.deliveryOrigin) return next();
    origin = url.origin;
  } catch (_) { return next(); }
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode < 400 || body?.success !== false) return json(body);
    const message = JSON.stringify({ source: 'tubeswift-download', id,
      error: body.error || 'The download could not start.', code: body.code || 'DOWNLOAD_FAILED' }).replace(/</g, '\\u003c');
    res.set({
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${id}'; frame-ancestors ${origin}`
    });
    return res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Download unavailable</title><p>The download could not start. Please return to TubeSwift and try again.</p><script nonce="${id}">parent.postMessage(${message},${JSON.stringify(origin)});</script>`);
  };
  next();
}

module.exports = { browserDownloadErrors };
