'use strict';

// The upstream service logs integrity/PO tokens even without an explicit debug
// flag. Relay only known public startup/status messages, never arbitrary text.
function publicProviderLine(line) {
  if (/^Started POT server \(v\d+\.\d+\.\d+\) on address 127\.0\.0\.1:\d{4,5}$/.test(line)) return `[provider] ${line}`;
  if (/^poToken:/.test(line)) return '[provider] Token generated.';
  if (/^(?:Error\b|TypeError\b|SyntaxError\b|ReferenceError\b|Could not listen|error:)/i.test(line)) {
    return '[provider] Internal error; sensitive details suppressed.';
  }
  return null;
}

function relayProviderOutput(stream, write = line => process.stdout.write(line)) {
  let buffer = '';
  let discarded = false;
  const flush = () => {
    if (!discarded) {
      const message = publicProviderLine(buffer.replace(/\r$/, ''));
      if (message) write(`${message}\n`);
    }
    buffer = ''; discarded = false;
  };
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    const parts = chunk.split('\n');
    parts.forEach((part, index) => {
      if (!discarded) {
        buffer += part;
        if (buffer.length > 4096) { buffer = ''; discarded = true; }
      }
      if (index < parts.length - 1) flush();
    });
  });
  stream.on('end', flush);
}

module.exports = { publicProviderLine, relayProviderOutput };
