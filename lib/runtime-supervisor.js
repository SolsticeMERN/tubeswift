'use strict';

const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

// Both processes belong to one service lifecycle. Never leave the API running
// after its token provider exits, or leave an orphaned provider after shutdown.
async function supervise({ provider, application, healthUrl, providerVersion, timeoutMs = 45000, signal }) {
  const children = new Set();
  const boot = new AbortController();
  let stopping;
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const abort = () => { void stop(0); };
  signal?.addEventListener('abort', abort, { once: true });

  function launch(spec) {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd, env: spec.env,
      stdio: spec.pipeOutput ? ['ignore', 'pipe', 'pipe'] : (spec.stdio || 'inherit'),
      detached: process.platform !== 'win32'
    });
    if (spec.pipeOutput) {
      spec.pipeOutput(child.stdout);
      spec.pipeOutput(child.stderr);
    }
    children.add(child);
    child.once('error', error => { boot.abort(error); void stop(1); });
    child.once('close', () => { children.delete(child); boot.abort(new Error('A runtime component exited.')); void stop(1); });
    return child;
  }

  function stop(code = 0) {
    if (stopping) return stopping;
    boot.abort(new Error('Runtime is shutting down.'));
    stopping = Promise.all([...children].map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const signal = name => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
          else child.kill(name);
        } catch (_) {}
      };
      const timer = setTimeout(() => signal('SIGKILL'), 5000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      signal('SIGTERM');
    }))).then(() => { signal?.removeEventListener('abort', abort); resolveExit(code); return code; });
    return stopping;
  }

  try {
    if (signal?.aborted) { await stop(0); return { stop, exited }; }
    launch(provider);
    const deadline = Date.now() + timeoutMs;
    let healthy = false;
    while (Date.now() < deadline && !boot.signal.aborted) {
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.any([boot.signal, AbortSignal.timeout(1000)]), redirect: 'error' });
        healthy = response.ok && (await response.json()).version === providerVersion;
        if (healthy) break;
      } catch (_) {}
      await delay(200, null, { signal: boot.signal });
    }
    if (!healthy || boot.signal.aborted) throw new Error('The private token service did not become ready.');
    launch(application);
    return { stop, exited };
  } catch (error) {
    await stop(signal?.aborted ? 0 : 1);
    if (signal?.aborted) return { stop, exited };
    throw new Error(`Downloader startup failed: ${error.message}`);
  }
}

module.exports = { supervise };
