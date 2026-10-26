# TubeSwift Master Architecture & Scaling Plan

> **Last Updated:** October 26, 2026  
> **Status:** Phase 1 (Active Production - Month 1 Zero-Cost Launch)  
> **Live Site:** [https://www.tubeswift.app/](https://www.tubeswift.app/)  
> **Backend:** [https://tubeswift-kri3.onrender.com](https://tubeswift-kri3.onrender.com)  

---

## 1. Executive Summary & Core Strategy

### The Month 1 Decision: Stay Free vs. Upgrade
* **Recommendation:** **Stay on the Free Plan for Month 1.**
* **Why not pay Render $25/month right now?**
  * Render's $25/month plan only gives more RAM/CPU. **It does NOT stop YouTube from blocking datacenter IPs.**
  * Upgrading server specs without residential proxy routing is paying for idle hardware while still facing the same upstream YouTube anti-bot hurdles.
  * In Month 1, traffic is low. We can keep Render awake 24/7 for **$0** using an automated uptime monitor.

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
       ├── Secret Session: Netscape cookies from YOUTUBE_COOKIES_BASE64
       └── ffmpeg-static (Muxes separate 1080p video + audio streams on the fly)
       │
       ▼ (Mobile InnerTube API)
[ YouTube Video & Audio CDN ]
```

### Key Technical Safeguards In Place:
1. **Player Clients:** Configured with `web,mweb,web_embedded` with Node.js challenge solving (`--js-runtimes node --remote-components ejs:github`).
2. **Compact Cookies:** Filtered down from 575 KB to only the ~21 active YouTube cookies (~2.9 KB Base64) to strictly observe Render's 32 KB environment limit.
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
  * **Cold Start Prevention:** Free [UptimeRobot](https://uptimerobot.com) HTTP ping to `https://tubeswift-kri3.onrender.com/health` every 5 minutes (prevents the 15-minute idle sleep).
  * **Session Management:** Secondary throwaway Google account cookie refreshed as needed.

### 🟡 Phase 2: Early Growth (50 – 500 Downloads / Day)
* **Trigger:** Daily traffic grows consistently; YouTube starts throttling the single Render IP.
* **Budget:** **$10 – $30 / month**
* **Upgrade Path:**
  * **DO NOT** spend on big server RAM first. Spend on **Proxy Rotation**:
    * Integrate a low-cost rotating proxy (e.g. Webshare rotating proxies for ~$5-$10/mo) into `yt-dlp` using `--proxy`.
    * This routes download requests through residential/ISP IPs, permanently eliminating YouTube 429 datacenter IP blocks.
  * If Render memory hits 512 MB limits due to multiple simultaneous 1080p ffmpeg merges, upgrade Render to Starter ($7/mo) or standard compute ($25/mo).

### 🔴 Phase 3: Scale (> 1,000 Downloads / Day)
* **Trigger:** Site ranks on Google for target keywords; high concurrent download traffic.
* **Budget:** **$50 – $120 / month**
* **Upgrade Path:**
  * Move from single-server stream piping to a **Worker Queue (Redis / BullMQ)** on a dedicated VPS (Hetzner / DigitalOcean, $10-$20/mo).
  * Save converted MP4s temporarily to Cloudflare R2 ($0 egress bandwidth) and provide direct pre-signed download links to users.
  * This prevents the server network from saturating on large file deliveries.

---

## 4. Operational Emergency Runbook

### Issue A: YouTube shows "Sign in to confirm you're not a bot"
* **Cause:** The exported Google cookies expired or were rotated by Google.
* **Resolution (60 seconds):**
  1. Open Chrome on Mac, log into the throwaway Google account on YouTube.
  2. Run in terminal:
     ```bash
     ./yt-dlp_macos --cookies-from-browser chrome --cookies cookies_raw.txt "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --skip-download
     ```
  3. Filter to YouTube cookies and copy Base64 to clipboard:
     ```bash
     python3 -c "
     with open('cookies_raw.txt') as f: lines = f.readlines()
     yt = [l for l in lines if l.startswith('.youtube.com')]
     with open('cookies.txt', 'w') as f: f.write('# Netscape HTTP Cookie File\n\n' + ''.join(yt))
     " && rm cookies_raw.txt && base64 -i cookies.txt | pbcopy
     ```
  4. Paste into Render Dashboard ➔ **Environment** ➔ `YOUTUBE_COOKIES_BASE64` ➔ **Save Changes**.

### Issue B: First download takes 50+ seconds
* **Cause:** Render free instance went to sleep due to 15 minutes of inactivity.
* **Resolution:** Ensure UptimeRobot is active and pinging `https://tubeswift-kri3.onrender.com/health` every 5 minutes.

---

## 5. Google SEO & Ranking Focus for Month 1

1. **Indexation:** Ensure all landing pages (`/youtube-4k-downloader`, `/youtube-to-mp4`, `/youtube-shorts-downloader`, `/youtube-mp3-downloader`) are submitted in Google Search Console.
2. **PageSpeed:** Already optimized (Vercel static assets, lightweight pure CSS, zero heavy JS frameworks).
3. **Keyword Monitoring:** Track impressions on core phrases from `keyword-research.csv` (e.g., *"youtube video downloader 1080p"*, *"snap and save youtube"*).
