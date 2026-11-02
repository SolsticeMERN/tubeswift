const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const { relayProviderOutput } = require('../lib/provider-logs');

test('provider logs preserve startup and token counts without exposing values or credentials', async () => {
  const stream = new PassThrough();
  let logged = '';
  relayProviderOutput(stream, line => { logged += line; });
  stream.write('Started POT server (v2.0.2) on address 127.0.0.1:4416\n');
  stream.write('Generated Integrity');
  stream.write('Token: {"integrityToken":"never-log-this"}\npoTo');
  stream.write('ken: also-secret\nUsing proxy: http://user:password@proxy.example\n');
  stream.write('Error: a failure containing token=hidden-value\n');
  stream.end('Unknown upstream debug output: private-detail');
  await once(stream, 'end');
  assert.equal(logged, '[provider] Started POT server (v2.0.2) on address 127.0.0.1:4416\n' +
    '[provider] Token generated.\n[provider] Internal error; sensitive details suppressed.\n');
});

test('oversized debug lines remain suppressed across stream chunks', async () => {
  const stream = new PassThrough();
  let logged = '';
  relayProviderOutput(stream, line => { logged += line; });
  stream.write('x'.repeat(5000));
  stream.write('poToken: secret\n');
  stream.end('Started POT server (v2.0.2) on address 127.0.0.1:4416\n');
  await once(stream, 'end');
  assert.equal(logged, '[provider] Started POT server (v2.0.2) on address 127.0.0.1:4416\n');
});
