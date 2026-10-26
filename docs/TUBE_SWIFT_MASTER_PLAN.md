# TubeSwift Master Architecture & Scaling Plan

> **Last Updated:** October 26, 2026  
> **Status:** Public launch; upstream download reliability unresolved
> **Live Site:** [https://www.tubeswift.app/](https://www.tubeswift.app/)  
> **Backend:** [https://tubeswift-kri3.onrender.com](https://tubeswift-kri3.onrender.com)  

---

## 1. Executive Summary & Core Strategy

### The Month 1 Decision: Stay Free vs. Upgrade
* **Recommendation:** Qualify a working acquisition backend before choosing hosting capacity or buying proxy bandwidth. See the [competitor architecture research](competitor-architecture-research.md) for the evidence and implementation sequence.
* **Why not pay Render $25/month right now?**
  * Render's $25/month plan only gives more RAM/CPU. **It does NOT stop YouTube from blocking datacenter IPs.**
  * CPU/RAM capacity and upstream network access are separate problems. Residential routing is one possible component to qualify, not a mandatory or guaranteed cure.
  * An uptime monitor may affect idle shutdowns, but cannot guarantee availability. Render explicitly advises against Free instances for production: [Free limitations](https://render.com/docs/free).

---

## 2. Current Architecture Overview

```
[ User Browser ]
       │
       ▼ (HTTPS)
[ Vercel CDN (tubeswift.app) ]  <── Pure Static Frontend (HTML5, Vanilla CSS, JS)
       │
       ▼ (API Calls /api/info & /api/download)
[ Render Free Web Service (tubeswift-kri3.onrender.com) ]
       │
       ├── Express 5.x Server (Node.js)
       ├── yt-dlp (Latest Linux standalone release)
       ├── ejs:github + Node.js (Solves YouTube JavaScript challenges)
       ├── Optional configured Netscape session cookies (disabled by YOUTUBE_AUTH_MODE=guest)
       ├── In-process upstream concurrency guard/cooldown and metadata cache
       └── ffmpeg-static (Completes conversion/merging before serving a file)
       │
       ▼ (yt-dlp-selected YouTube clients)
[ YouTube Video & Audio CDN ]
```

### Key Technical Safeguards In Place:
1. **Player Clients:** yt-dlp selects clients; Node.js/EJS solves player JavaScript challenges. No automatic PO Token Provider is currently integrated.
2. **Cookies:** Configured cookies are loaded unless guest mode is set. Account sessions can expire or be rejected; they do not guarantee public-service availability.
3. **Decoupled Architecture:** Vercel serves the high-speed cached UI; Render handles only heavy extraction/conversion.
4. **Clean UI & Responsive Nav:** Single-line `white-space: nowrap` responsive navigation bar across all display resolutions.

---

## 3. The 3-Phase Roadmap

### 🟢 Phase 1: Month 1 Launch (Zero Cost, Validating Demand)
* **Budget:** **$0 / month**
* **Goal:** Verify real visitor volume, test search engine indexing, and gather error analytics without recurring overhead.
* **Infrastructure:**
  * **Frontend:** Vercel Hobby (Free, global CDN).
  * **Backend:** Render Free Web Service ($0).
  * **Health:** `/health` checks the Node process. No monitor installation is established by this plan, and process health does not verify downloads.
  * **Acquisition:** Qualify automatic PO tokens and the hosted network route. A manual account-cookie refresh is a diagnostic intervention, not a reliability architecture.

### 🟡 Phase 2: Early Growth (50 – 500 Downloads / Day)
* **Trigger:** Measured demand and tested acquisition requirements justify recurring costs. The hosted route has already received upstream rejections; this does not require large visitor volume.
* **Budget:** Undetermined until bytes per completed download, permitted routes, and supplier pricing are measured.
* **Upgrade Path:**
  * Qualify the maintained extractor/runtime/EJS and automatic PO Token Provider first. If the hosted network is still rejected, qualify an alternate route and preserve the required session/IP context throughout each job.
    * A proxy must explicitly support the target and media transfer, with measured bandwidth and a spending cap.
    * No proxy permanently eliminates YouTube blocks. The earlier claim in this document was incorrect. [Provider limitations](https://github.com/Brainicism/bgutil-ytdlp-pot-provider).
  * If Render memory hits 512 MB limits due to multiple simultaneous 1080p ffmpeg merges, upgrade Render to Starter ($7/mo) or standard compute ($25/mo).

### 🔴 Phase 3: Scale (> 1,000 Downloads / Day)
* **Trigger:** Site ranks on Google for target keywords; high concurrent download traffic.
* **Budget:** Measured compute, storage, transfer, and acquisition costs; no fixed total has been established.
* **Upgrade Path:**
  * Use durable worker jobs, bounded concurrency, and validated short-lived file storage with expiring delivery links. Qualify these before a production reliability claim, rather than waiting for 1,000 downloads/day.
  * Select storage and hosting only after checking current limits and pricing. Independent delivery reduces worker transfer load but cannot repair first-time acquisition failures.

---

## 4. Operational Emergency Runbook

### Issue A: YouTube shows "Sign in to confirm you're not a bot"
* **Possible causes:** Rejected network/IP, guest/account restrictions, or invalid session credentials. This message alone does not prove cookie expiry.
* **Resolution:** Inspect the underlying status and extractor diagnostics, respect the cooldown, and verify the token provider and network route. Refresh cookies only when evidence identifies an invalid account session. Do not export unrelated browser cookies or repeatedly retry a blocked route. See [operations](youtube-operations.md) and [research](competitor-architecture-research.md).

### Issue B: First download takes 50+ seconds
* **Cause:** Render free instance went to sleep due to 15 minutes of inactivity.
* **Resolution:** Confirm idle shutdown in logs. A production always-on worker removes this particular Free-tier limitation; it does not remove YouTube restrictions. Heartbeats do not guarantee availability.

---

## 5. Google SEO & Ranking Focus for Month 1

1. **Indexation:** Ensure all landing pages (`/youtube-4k-downloader`, `/youtube-to-mp4`, `/youtube-shorts-downloader`, `/youtube-mp3-downloader`) are submitted in Google Search Console.
2. **PageSpeed:** Already optimized (Vercel static assets, lightweight pure CSS, zero heavy JS frameworks).
3. **Keyword Monitoring:** Track impressions on core phrases from `keyword-research.csv` (e.g., *"youtube video downloader 1080p"*, *"snap and save youtube"*).
