# YouTube request handling

The current checkout loads configured `YOUTUBE_COOKIES_BASE64`, `YOUTUBE_COOKIES`, or cookie files unless `YOUTUBE_AUTH_MODE=guest` is explicitly set. With no valid cookie source it uses a guest session. This changed after the earlier guest-default deployment; verify deployed configuration independently. Account-only, private, and age-restricted content is not guaranteed by the public download service.

Refreshing an account is not a remedy for a hosting-network HTTP 429 restriction. Follow the [competitor architecture research](competitor-architecture-research.md) for automatic token integration and route qualification; these remain proposed work.

The backend runs one extraction or download request at a time per Node process. Up to four requests can wait for up to 30 seconds. This protects the small instance from unbounded subprocess creation. It is a capacity safeguard, not a durable job queue or a scalable worker system.

On an upstream HTTP 429 or bot-verification rejection, the process pauses new extraction/download requests for two minutes. Waiting requests get a recoverable error, and responses include `Retry-After`. The next request after cooldown is allowed to probe the upstream again. Health checks remain available; restarting the app is not a fix for an upstream restriction.

A guest session removes one expiring credential dependency. It does not guarantee access from a datacenter network. If a known public video works locally but still receives HTTP 429 on Render in guest mode, qualify an independent download backend or supported network route before purchasing more CPU or memory. Do not repeatedly refresh the owner's account or repeatedly retry the rejected network.
