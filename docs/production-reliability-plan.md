# TubeSwift production reliability plan

Reviewed: 26 October 2026 (Asia/Dhaka).

The [competitor architecture research](competitor-architecture-research.md) contains the current acquisition recommendation and source-backed findings. This remains a proposal, not a production migration record.

## Current state

- Public frontend: https://www.tubeswift.app/.
- Download backend: a single Render Free web service (0.1 CPU, 512 MB RAM).
- Current checkout loads configured account cookies unless `YOUTUBE_AUTH_MODE=guest`. Verify deployed settings independently; configured credentials are not a durable public-service dependency.
- Real MP4 and MP3 downloads and 18 automated tests passed after a session refresh. This establishes that the repaired paths work; it is not a production load or availability test.
- Requests launch yt-dlp behind a bounded in-process concurrency guard/cooldown. Metadata has a bounded in-memory cache. There is still no durable job queue, qualified independent download backend, or download success monitoring.
- `/health` checks the Node process only. It does not establish that YouTube extraction, conversion, and file delivery work.
- Installation downloads the latest yt-dlp release. A redeploy can therefore change an external dependency without a separate qualification run.

## Important distinction

Paid hosting removes idle shutdowns and provides more resources. It does not prevent YouTube from rejecting an account session or a hosting network. Queues, caching, and friendlier errors also cannot repair a rejected upstream session by themselves.

There is no permanent cookie value. A managed provider must also be tested: a paid API may use the same extractor internally. An actual redundant route must not share the same failing session or infrastructure. No provider has been selected or qualified yet.

## Recommended launch sequence

1. Qualify acquisition with a maintained yt-dlp/runtime/EJS set and an automatic PO Token Provider. Test real file delivery on the hosted route. If that route is still rejected, qualify an alternative with matching session/network context. Choose always-on worker capacity from measured load; do not assume a $25 hosting upgrade resolves extraction.
2. Move downloads into jobs. Store job state in a durable queue, limit concurrent extraction/conversion, coalesce duplicate requests, and give visitors an honest queued/preparing/ready status. A restart should not silently lose an accepted request.
3. Resolve the acquisition dependency. Evaluate an actively maintained extraction integration and, if justified, a separate managed backend. Test real file delivery, required quality, session/IP restrictions, costs, permitted use, limits, and support terms before purchasing or integrating. Avoid depending on the owner's personal browser session for anonymous public traffic.
4. Store completed files privately for a short, bounded period, with automatic deletion and expiring delivery links. Do not share private or account-restricted results between visitors. Use short-lived metadata caching and refresh stale format information.
5. Classify failures. Retry transient network errors within a bound; do not repeatedly retry unavailable videos or rejected sessions. Temporarily stop sending requests to a failing backend and use a genuinely independent fallback only when available. Keep failed requests on the website so users can recover.
6. Protect capacity and costs. Apply per-client request limits, bounded queues, maximum video duration/file size, disk quotas, and a monthly usage budget. Return clear limits instead of accepting work the service cannot finish.
7. Measure the complete product path. Track successful eligible downloads, error reasons, queue time, conversion time, delivered bytes, and resource usage. Test extraction plus a small real audio/video download; a process heartbeat alone is insufficient. Schedule alerts only after choosing the monitoring service and recipient.
8. Qualify releases. Pin a tested downloader/runtime/component set, run representative public video/Shorts/audio/merge tests and a small concurrency test, then deploy with rollback available. Test new upstream releases before promotion; pinning forever would also break compatibility.

## Budget planning

- The Render dashboard previously showed $7 and $25 monthly service compute options. These are capacity options, not verified total costs or fixes for upstream rejection.
- Queue, storage, transfer, monitoring, and any external download backend are additional. Their costs have not been quoted or approved.
- No total monthly estimate is established until a working acquisition route and transferred bytes per completed job have been measured.
- Example delivery volume: 100 downloads/day at 50 MB each is about 150 GB/month. At 1,000/day it is about 1.5 TB/month. Actual volume must be measured; proxying media may incur separate transfer charges.
- Do not purchase a provider or upgrade hosting until the exact charge and scope are approved.

## Launch acceptance checks

- Test a representative collection of eligible public videos, Shorts, audio outputs, and separate-stream MP4 merges on the deployed infrastructure.
- Measure file integrity, correct streams/codecs, completion rate, concurrent load, restart recovery, disk cleanup, and failure recovery.
- Track unavailable/private/region-restricted content separately from service failures; those videos cannot be promised as downloadable.
- Establish availability and success-rate targets after baseline measurements. No percentage guarantee is made by this plan.

## Search visibility

Download failures can harm visitor trust, but they do not establish an automatic Google ranking penalty. Google documents multiple ranking considerations and page-experience signals. Reliability and search quality should be measured separately.

## References

- Render Free limitations: https://render.com/docs/free
- Current service compute choices: https://dashboard.render.com/web/srv-dbf6kvdg1s2s73elu3s0/compute
- Render workers and queues: https://render.com/docs/background-workers
- Render bandwidth: https://render.com/docs/outbound-bandwidth
- yt-dlp YouTube session guidance: https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies
- yt-dlp token guidance: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- Google page experience: https://developers.google.com/search/docs/appearance/page-experience

This document is a proposal. The production architecture changes, paid hosting upgrade, external provider, and monitoring described here have not been implemented or purchased.
