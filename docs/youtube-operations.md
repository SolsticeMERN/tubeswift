# Operating the YouTube backend

## Runtime and deployment

Use the Node.js version in `.node-version`. Run `npm ci` to install application dependencies and the verified download runtime, then `npm start` to start the managed backend. `npm run build` repeats runtime installation safely. Vercel builds only the static frontend and skip the backend runtime installation.

`runtime-lock.json` pins official yt-dlp binaries and the [BgUtils PO-token provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) source and plugin. The installer checks SHA-256 hashes before replacing artifacts and installs provider dependencies from its committed lockfile. Linux uses the standalone binary, so a host Python upgrade is unnecessary. The EJS scripts are bundled with that yt-dlp release, with its version-specific GitHub component fallback enabled.

`npm start` starts the provider on **127.0.0.1:4416**, waits for a compatible `/ping` response, then starts the public API on `PORT`. Neither the provider nor its token/debug endpoints should be exposed through Render, a reverse proxy, or the frontend. If either process exits, the supervisor stops the other and exits, allowing the hosting platform to restart the complete service. Redeploy shutdown also terminates detached yt-dlp/FFmpeg process groups.

On Render, use build command `npm ci`, start command `npm start`, and health-check path `/health`. No paid upgrade is required by these code changes. Native provider dependencies must build successfully in the deployment logs before the new release is accepted.

## Authentication and network context

Public downloads default to **guest** mode. Old cookie secrets can remain stored but are not loaded unless `YOUTUBE_AUTH_MODE=cookies` is explicitly set. Account-only/private/age-restricted content is outside the public downloader's supported access. An owner login should not become the shared credential for anonymous visitors.

The default client is `mweb`, using the installed HTTP PO-token plugin. Administrators can qualify a different comma-separated `YOUTUBE_PLAYER_CLIENTS` value against the pinned release. `POT_PORT` changes the private loopback listener if needed.

Optional `YTDLP_PROXY` accepts a supported HTTP(S)/SOCKS proxy URL. The same arguments are used for metadata and downloads; the plugin forwards yt-dlp's request proxy and token context to the local provider. Do not log credentials or generated tokens. Do not enable verbose token tracing on the public service. If evaluating a proxy later, qualify a consistent session route for token generation, extraction and media transfer rather than assuming rotation makes every request work. Proxy purchase/configuration is not part of this change.

The provider's upstream defaults print token values. Its output is therefore piped through an allowlist: only the public startup line, a value-free token-generation notice and generic error notices reach application logs. Downloader error diagnostics also suppress credential/token lines and proxy userinfo. Do not switch the provider back to inherited stdout/stderr.

## Capacity, recovery and errors

The backend accepts one upstream extraction/download at a time, with four waiting requests and a 30-second queue deadline. Metadata is cached for one hour. Stale-format and unavailable-video download failures invalidate that video's cached metadata. This is a small-instance capacity guard, not a durable worker queue.

Transfers and fragments have two retries with bounded exponential delays. Extraction retries remain disabled; explicit upstream rejection is not an application retry loop. Requests are spaced within yt-dlp, metadata has a 120-second deadline, and download preparation defaults to ten minutes and 512 MiB per output. Incomplete fragments are errors rather than silently accepted gaps.

One classifier handles both API responses and the cooldown guard. A pure private/deleted/unavailable-video error does not block unrelated visitors. Explicit HTTP 429 or bot-verification evidence takes precedence even when stderr also includes a generic “video unavailable” heading. Such rejection pauses new upstream work for two minutes and sends `Retry-After`; the next request after that interval may attempt again. The interval is not a promise that YouTube will recover.

Browser downloads use a hidden attachment frame. Errors are sent to the initiating page using a request ID and validated message origin/source, so a rejected download cannot replace the website with raw API JSON. Ordinary API clients continue receiving JSON. Large files are handled by the native download manager rather than buffered into browser JavaScript memory.

## Verification and limitations

`/health` returns HTTP 200 only when the pinned downloader, plugin, FFmpeg, JavaScript runtime and compatible local token service are ready. Its separate `upstream` snapshot records the last observed extraction/download result and cooldown. A ready local runtime does **not** prove that YouTube currently accepts the hosting network. Health probes never download videos or generate tokens.

Run `npm test` for offline regression checks, including real child-process lifecycle tests and HTTP download/error delivery. Run `npm run verify:downloads -- --base=https://tubeswift-kri3.onrender.com` for an explicit live smoke test. It uses a short public video, fetches metadata, downloads one MP4 and MP3, fully decodes both with FFmpeg, then deletes the temporary media. It consumes upstream traffic and must not be scheduled as a frequent health check. `--video=VIDEO_ID` may select another public video under 90 seconds.

When updating yt-dlp or the provider, update the official version, commit and checksums in the lock, rebuild, run offline checks, and qualify real downloads on the actual hosting network. Preserve the last qualified release for rollback. Tokens solve a required protocol step; they do not override HTTP 429, account restrictions, or a rejected datacenter route. If the installed runtime passes locally but Render still rejects known public videos, the remaining dependency is an independently qualified hosting/network route or managed download backend. Buying RAM or blindly buying a rotating proxy is not evidence of a fix.
