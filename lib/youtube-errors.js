'use strict';

// Inspect the complete diagnostic, not just its first generic "unavailable"
// heading. Never discard explicit restriction evidence from another request.
function classifyYoutubeError(diagnostic = '') {
  const text = String(diagnostic).replace(/[’‘]/g, "'");
  if (/(?:HTTP(?: Error)?|status(?: code)?)[\s:=]+429\b|too many requests|(?:content isn't available|session|account).{0,100}rate.limit/i.test(text)) {
    return { status: 503, code: 'YOUTUBE_RATE_LIMITED', message: 'YouTube is temporarily limiting downloads. Please try again later.' };
  }
  if (/not\s+a\s+bot|captcha challenge|bot.verification/i.test(text)) {
    return { status: 503, code: 'YOUTUBE_SESSION_REJECTED', message: 'YouTube is temporarily rejecting downloads from this server. Please try again later.' };
  }
  if (/cookies are no longer valid|cookies.*(?:expired|invalid)/i.test(text)) {
    return { status: 503, code: 'YOUTUBE_COOKIES_EXPIRED', message: 'The server YouTube session needs attention. Please try again later.' };
  }
  if (/sign in to confirm your age|age.restricted|members.only|join this channel/i.test(text)) {
    return { status: 403, code: 'VIDEO_RESTRICTED', message: 'This video requires access that the public downloader cannot provide.' };
  }
  if (/private video|video (?:is )?unavailable|has been removed|not available in your country/i.test(text)) {
    return { status: 404, code: 'VIDEO_UNAVAILABLE', message: 'This video is unavailable, private, or restricted.' };
  }
  if (/requested format is not available|no video formats found/i.test(text)) {
    return { status: 409, code: 'VIDEO_FORMATS_CHANGED', message: 'The available formats changed. Please paste the link again to refresh them.' };
  }
  return { status: 502, code: 'YOUTUBE_REQUEST_FAILED', message: 'The download could not be prepared. Please try again later.' };
}

function redactDiagnostic(value) {
  return String(value).split(/\r?\n/).map(line => {
    if (/\b(?:integrityToken|poToken|po_token|pot|Authorization|Cookie|visitorData)["']?\s*[:=]/i.test(line)) {
      return '[redacted credential diagnostic]';
    }
    return line.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@');
  }).join('\n');
}

module.exports = { classifyYoutubeError, redactDiagnostic };
