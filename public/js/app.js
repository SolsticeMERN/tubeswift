/**
 * TubeSwift Frontend Application Engine
 * Handles Clipboard API, Stream Fetching, Format Tabs, Audio Preview & QR Code Sharing
 */

document.addEventListener('DOMContentLoaded', () => {
  // Option B: Dynamic API Base for Decoupled Frontend (Cloudflare Pages / Vercel) & Backend (Render)
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isRenderDirect = window.location.hostname.includes('onrender.com');
  const API_BASE = (isLocal || isRenderDirect) ? '' : 'https://tubeswift-kri3.onrender.com';

  // Silent warm-up ping to wake up backend immediately on page load
  if (API_BASE) {
    fetch(`${API_BASE}/health`).catch(() => {});
  }

  // Elements
  const urlInput = document.getElementById('urlInput');
  const btnPaste = document.getElementById('btnPaste');
  const btnFetch = document.getElementById('btnFetch');
  const statusContainer = document.getElementById('statusContainer');
  const statusText = document.getElementById('statusText');
  const alertBox = document.getElementById('alertBox');
  const alertMessage = document.getElementById('alertMessage');
  const resultCard = document.getElementById('resultCard');
  const historySection = document.getElementById('historySection');
  const historyList = document.getElementById('historyList');
  const themeToggle = document.getElementById('themeToggle');

  // Video Display Elements
  const resThumbnail = document.getElementById('resThumbnail');
  const resDuration = document.getElementById('resDuration');
  const resTitle = document.getElementById('resTitle');
  const resAuthor = document.getElementById('resAuthor');
  const resViews = document.getElementById('resViews');

  // Quality Dropdown Elements (Competitor SnapYT Match)
  const qualitySelect = document.getElementById('qualitySelect');
  const btnDownloadSelected = document.getElementById('btnDownloadSelected');
  const selectedLabel = document.getElementById('selectedLabel');
  const selectedSize = document.getElementById('selectedSize');
  const optionsCountBadge = document.getElementById('optionsCountBadge');

  // 4 Categorized Tabs & Containers
  const tabReady = document.getElementById('tabReady');
  const tabVideoHigh = document.getElementById('tabVideoHigh');
  const tabMp3 = document.getElementById('tabMp3');
  const tabAudioOnly = document.getElementById('tabAudioOnly');

  const countReady = document.getElementById('countReady');
  const countVideoHigh = document.getElementById('countVideoHigh');
  const countMp3 = document.getElementById('countMp3');
  const countAudioOnly = document.getElementById('countAudioOnly');

  const readyFormatList = document.getElementById('readyFormatList');
  const videoHighFormatList = document.getElementById('videoHighFormatList');
  const mp3FormatList = document.getElementById('mp3FormatList');
  const nativeAudioFormatList = document.getElementById('nativeAudioFormatList');

  // Legacy fallback containers (if present)
  const videoFormatList = document.getElementById('videoFormatList');
  const audioFormatList = document.getElementById('audioFormatList');
  const tabVideo = document.getElementById('tabVideo');
  const tabAudio = document.getElementById('tabAudio');

  // QR Modal Elements
  const qrModal = document.getElementById('qrModal');
  const btnQrTrigger = document.getElementById('btnQrTrigger');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const qrContainer = document.getElementById('qrContainer');
  const btnCopyShareLink = document.getElementById('btnCopyShareLink');

  let currentVideoData = null;

  // Initialize Theme
  const savedTheme = localStorage.getItem('tubeswift_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('tubeswift_theme', nextTheme);
      updateThemeIcon(nextTheme);
    });
  }

  function updateThemeIcon(theme) {
    if (!themeToggle) return;
    themeToggle.innerHTML = theme === 'dark' 
      ? `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>`
      : `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`;
  }

  // Toast System
  function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="18" height="18" fill="none" stroke="${type === 'error' ? '#ef4444' : '#10b981'}" stroke-width="2" viewBox="0 0 24 24">
        ${type === 'error' 
          ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>' 
          : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>'}
      </svg>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // Quick Clipboard Paste Button
  if (btnPaste) {
    btnPaste.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          showToast('Clipboard access not supported in this browser.', 'error');
          urlInput.focus();
          return;
        }
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          urlInput.value = text.trim();
          showToast('Pasted link from clipboard!');
          handleFetch();
        } else {
          showToast('Clipboard is empty!', 'error');
        }
      } catch (err) {
        showToast('Please paste manually (Ctrl+V / Cmd+V)', 'info');
        urlInput.focus();
      }
    });
  }

  // Trigger on enter key
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleFetch();
      }
    });
  }

  if (btnFetch) {
    btnFetch.addEventListener('click', handleFetch);
  }

  // Tab Switching Setup: 4 Categories
  function switchTab(activeBtn, activeList) {
    [tabReady, tabVideoHigh, tabMp3, tabAudioOnly].forEach(btn => {
      if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });
    [readyFormatList, videoHighFormatList, mp3FormatList, nativeAudioFormatList].forEach(list => {
      if (list) list.style.display = 'none';
    });

    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
    }
    if (activeList) {
      activeList.style.display = 'flex';
    }
  }

  if (tabReady) tabReady.addEventListener('click', () => switchTab(tabReady, readyFormatList));
  if (tabVideoHigh) tabVideoHigh.addEventListener('click', () => switchTab(tabVideoHigh, videoHighFormatList));
  if (tabMp3) tabMp3.addEventListener('click', () => switchTab(tabMp3, mp3FormatList));
  if (tabAudioOnly) tabAudioOnly.addEventListener('click', () => switchTab(tabAudioOnly, nativeAudioFormatList));

  // Legacy tab switcher support
  if (tabVideo && tabAudio) {
    tabVideo.addEventListener('click', () => {
      tabVideo.classList.add('active');
      tabAudio.classList.remove('active');
      if (videoFormatList) videoFormatList.style.display = 'flex';
      if (audioFormatList) audioFormatList.style.display = 'none';
    });
    tabAudio.addEventListener('click', () => {
      tabAudio.classList.add('active');
      tabVideo.classList.remove('active');
      if (audioFormatList) audioFormatList.style.display = 'flex';
      if (videoFormatList) videoFormatList.style.display = 'none';
    });
  }

  // Fetch Video Process
  async function handleFetch() {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showError('Please paste a YouTube video or Shorts link first.');
      urlInput.focus();
      return;
    }

    hideError();
    resultCard.style.display = 'none';
    statusContainer.style.display = 'block';
    btnFetch.disabled = true;
    statusText.textContent = 'Connecting to media server...';

    // Micro-status updates
    const t1 = setTimeout(() => {
      statusText.textContent = 'Checking available video and audio formats...';
    }, 1200);

    const t2 = setTimeout(() => {
      statusText.textContent = 'Finalizing download endpoints...';
    }, 2800);

    try {
      const response = await fetch(`${API_BASE}/api/info?url=${encodeURIComponent(rawUrl)}`);
      clearTimeout(t1);
      clearTimeout(t2);

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Failed to analyze video.');
      }

      currentVideoData = resData.data;
      currentVideoData.originalUrl = rawUrl;

      renderVideoResult(currentVideoData);
      saveToHistory(currentVideoData);
      statusContainer.style.display = 'none';
      btnFetch.disabled = false;

      // Smooth scroll to result
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      showToast(`${currentVideoData.totalOptionsCount} download options loaded.`);

    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      statusContainer.style.display = 'none';
      btnFetch.disabled = false;
      showError(err.message || 'Error communicating with downloader engine.');
    }
  }

  // Create a format table row element
  function createFormatRow(fmt, data) {
    const row = document.createElement('div');
    row.className = 'format-row';

    let badgeClass = '';
    const q = fmt.quality || '';
    if (q.includes('4K') || q.includes('2160')) badgeClass = 'badge-4k';
    else if (q.includes('2K') || q.includes('1440')) badgeClass = 'badge-2k';
    else if (q.includes('1080')) badgeClass = 'badge-1080p';
    else if (q.includes('720')) badgeClass = 'badge-720p';
    else if (fmt.category === 'mp3') badgeClass = 'badge-mp3';
    else if (fmt.category === 'audio_only') badgeClass = 'badge-native-audio';

    const isAudio = fmt.category === 'mp3' || fmt.category === 'audio_only';
    let btnText = 'Download';
    if (fmt.category === 'mp3') btnText = 'Download MP3';
    else if (fmt.category === 'audio_only') btnText = 'Download Audio';

    row.innerHTML = `
      <div class="format-detail">
        <span class="quality-badge ${badgeClass}">${fmt.quality}</span>
        <span style="font-size:0.9rem; color: var(--text-main); font-weight:600;">${fmt.label || fmt.ext.toUpperCase()}</span>
        ${fmt.resolution ? `<span style="font-size:0.8rem; color: var(--text-muted);">${fmt.resolution}</span>` : ''}
      </div>
      <div class="format-size">${fmt.size || 'Calculated'}</div>
      <div>
        <button class="btn-download-stream ${isAudio ? 'audio-btn' : ''}" 
                data-url="${encodeURIComponent(data.originalUrl)}" 
                data-format="${fmt.format_id}" 
                data-ext="${fmt.ext || 'mp4'}" 
                data-title="${encodeURIComponent(data.title)}"
                data-category="${fmt.category || 'video'}"
                data-quality="${fmt.bitrate || fmt.quality || ''}"
                data-height="${fmt.height || ''}">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3"></path></svg>
          ${btnText}
        </button>
      </div>
    `;
    return row;
  }

  // Render Video Information & Populate Dropdown + All Tables
  function renderVideoResult(data) {
    resThumbnail.src = data.thumbnail;
    resDuration.textContent = data.durationFormatted || 'HD';
    resTitle.textContent = data.title;
    resAuthor.textContent = data.author;
    if (data.authorUrl) {
      resAuthor.href = data.authorUrl;
    }
    resViews.textContent = data.views ? `${data.views} views` : 'Public Stream';

    // 1. POPULATE THE QUALITY SELECTOR DROPDOWN (SnapYT Competitor Match)
    if (qualitySelect) {
      qualitySelect.innerHTML = '';

      // Optgroup 1: Video + Audio Ready
      if (data.readyFormats && data.readyFormats.length > 0) {
        const og1 = document.createElement('optgroup');
        og1.label = '🎬 Video + Audio (Ready to Download)';
        data.readyFormats.forEach(fmt => {
          const opt = document.createElement('option');
          opt.value = fmt.id;
          opt.textContent = `${fmt.label} · ${fmt.size}`;
          opt.setAttribute('data-url', data.originalUrl);
          opt.setAttribute('data-format', fmt.format_id);
          opt.setAttribute('data-ext', fmt.ext);
          opt.setAttribute('data-title', data.title);
          opt.setAttribute('data-category', fmt.category || 'ready');
          opt.setAttribute('data-quality', fmt.quality);
          opt.setAttribute('data-size', fmt.size);
          opt.setAttribute('data-label', fmt.label);
          if (fmt.height) opt.setAttribute('data-height', fmt.height);
          if (fmt.isRecommended && fmt.quality.includes('360p')) {
            opt.selected = true;
          }
          og1.appendChild(opt);
        });
        qualitySelect.appendChild(og1);
      }

      // Optgroup 2: Higher Quality Video
      if (data.highQualityFormats && data.highQualityFormats.length > 0) {
        const og2 = document.createElement('optgroup');
        og2.label = '📦 Higher Quality Video — Combine with audio for sound';
        data.highQualityFormats.forEach(fmt => {
          const opt = document.createElement('option');
          opt.value = fmt.id;
          opt.textContent = `${fmt.label} · ${fmt.size}`;
          opt.setAttribute('data-url', data.originalUrl);
          opt.setAttribute('data-format', fmt.format_id);
          opt.setAttribute('data-ext', fmt.ext);
          opt.setAttribute('data-title', data.title);
          opt.setAttribute('data-category', fmt.category || 'video_high');
          opt.setAttribute('data-quality', fmt.quality);
          opt.setAttribute('data-size', fmt.size);
          opt.setAttribute('data-label', fmt.label);
          if (fmt.height) opt.setAttribute('data-height', fmt.height);
          og2.appendChild(opt);
        });
        qualitySelect.appendChild(og2);
      }

      // Optgroup 3: MP3
      if (data.mp3Formats && data.mp3Formats.length > 0) {
        const og3 = document.createElement('optgroup');
        og3.label = '🎵 MP3';
        data.mp3Formats.forEach(fmt => {
          const opt = document.createElement('option');
          opt.value = fmt.id;
          opt.textContent = `${fmt.label} · ${fmt.size}`;
          opt.setAttribute('data-url', data.originalUrl);
          opt.setAttribute('data-format', fmt.format_id);
          opt.setAttribute('data-ext', fmt.ext);
          opt.setAttribute('data-title', data.title);
          opt.setAttribute('data-category', 'mp3');
          opt.setAttribute('data-quality', fmt.bitrate || fmt.quality);
          opt.setAttribute('data-size', fmt.size);
          opt.setAttribute('data-label', fmt.label);
          og3.appendChild(opt);
        });
        qualitySelect.appendChild(og3);
      }

      // Optgroup 4: Audio Only
      if (data.nativeAudioFormats && data.nativeAudioFormats.length > 0) {
        const og4 = document.createElement('optgroup');
        og4.label = '🎧 Audio Only';
        data.nativeAudioFormats.forEach(fmt => {
          const opt = document.createElement('option');
          opt.value = fmt.id;
          opt.textContent = `${fmt.label} · ${fmt.size}`;
          opt.setAttribute('data-url', data.originalUrl);
          opt.setAttribute('data-format', fmt.format_id);
          opt.setAttribute('data-ext', fmt.ext);
          opt.setAttribute('data-title', data.title);
          opt.setAttribute('data-category', 'audio_only');
          opt.setAttribute('data-quality', fmt.quality);
          opt.setAttribute('data-size', fmt.size);
          opt.setAttribute('data-label', fmt.label);
          og4.appendChild(opt);
        });
        qualitySelect.appendChild(og4);
      }

      // Update dropdown selection summary
      function updateDropdownSummary() {
        const sel = qualitySelect.options[qualitySelect.selectedIndex];
        if (!sel) return;
        const lbl = sel.getAttribute('data-label') || sel.textContent;
        const sz = sel.getAttribute('data-size') || '';
        const cat = sel.getAttribute('data-category') || '';

        if (selectedLabel) selectedLabel.textContent = lbl;
        if (selectedSize) selectedSize.textContent = sz;

        if (btnDownloadSelected) {
          const btnSpan = btnDownloadSelected.querySelector('span');
          if (btnSpan) {
            if (cat === 'mp3') btnSpan.textContent = 'Download MP3';
            else if (cat === 'audio_only') btnSpan.textContent = 'Download Audio';
            else btnSpan.textContent = 'Download Video';
          }
        }
      }

      qualitySelect.onchange = updateDropdownSummary;
      updateDropdownSummary();

      // Download Selected button handler
      if (btnDownloadSelected) {
        btnDownloadSelected.onclick = () => {
          const sel = qualitySelect.options[qualitySelect.selectedIndex];
          if (!sel) return;
          const u = sel.getAttribute('data-url');
          const f = sel.getAttribute('data-format');
          const ext = sel.getAttribute('data-ext');
          const t = sel.getAttribute('data-title');
          const cat = sel.getAttribute('data-category');
          const q = sel.getAttribute('data-quality');
          const h = sel.getAttribute('data-height');
          triggerDownload(u, f, ext, t, btnDownloadSelected, cat, q, h);
        };
      }
    }

    // 2. POPULATE THE 4 CATEGORY TABLES
    if (readyFormatList) {
      readyFormatList.innerHTML = '';
      (data.readyFormats || []).forEach(fmt => readyFormatList.appendChild(createFormatRow(fmt, data)));
    }

    if (videoHighFormatList) {
      videoHighFormatList.innerHTML = '';
      (data.highQualityFormats || []).forEach(fmt => videoHighFormatList.appendChild(createFormatRow(fmt, data)));
    }

    if (mp3FormatList) {
      mp3FormatList.innerHTML = '';
      (data.mp3Formats || []).forEach(fmt => mp3FormatList.appendChild(createFormatRow(fmt, data)));
    }

    if (nativeAudioFormatList) {
      nativeAudioFormatList.innerHTML = '';
      (data.nativeAudioFormats || []).forEach(fmt => nativeAudioFormatList.appendChild(createFormatRow(fmt, data)));
    }

    // Update Tab Counters
    if (countReady) countReady.textContent = data.readyFormats ? data.readyFormats.length : 3;
    if (countVideoHigh) countVideoHigh.textContent = data.highQualityFormats ? data.highQualityFormats.length : 19;
    if (countMp3) countMp3.textContent = data.mp3Formats ? data.mp3Formats.length : 4;
    if (countAudioOnly) countAudioOnly.textContent = data.nativeAudioFormats ? data.nativeAudioFormats.length : 4;
    if (optionsCountBadge) optionsCountBadge.textContent = `${data.totalOptionsCount || 30} Formats Available`;

    // Reset tabs to Ready to Download
    if (tabReady && readyFormatList) {
      switchTab(tabReady, readyFormatList);
    }

    // Legacy Fallback Elements (if present on shorts/mp3 pages)
    if (videoFormatList) {
      videoFormatList.innerHTML = '';
      const allVideo = [...(data.readyFormats || []), ...(data.highQualityFormats || [])];
      allVideo.forEach(fmt => videoFormatList.appendChild(createFormatRow(fmt, data)));
    }
    if (audioFormatList) {
      audioFormatList.innerHTML = '';
      const allAudio = [...(data.mp3Formats || []), ...(data.nativeAudioFormats || [])];
      allAudio.forEach(fmt => audioFormatList.appendChild(createFormatRow(fmt, data)));
    }

    // Attach stream click listeners to all rows
    document.querySelectorAll('.btn-download-stream').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = decodeURIComponent(btn.getAttribute('data-url'));
        const f = btn.getAttribute('data-format');
        const ext = btn.getAttribute('data-ext');
        const title = decodeURIComponent(btn.getAttribute('data-title'));
        const cat = btn.getAttribute('data-category');
        const q = btn.getAttribute('data-quality');
        const h = btn.getAttribute('data-height');
        triggerDownload(u, f, ext, title, btn, cat, q, h);
      });
    });

    resultCard.style.display = 'block';
  }

  // Trigger Native Browser Download
  function triggerDownload(url, format, ext, title, btnElement, category = '', quality = '', height = '') {
    const originalText = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = `
      <svg class="spin-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
      Starting...
    `;

    const cleanExt = (ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanName = (title || 'TubeSwift_Video')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 50) || 'video';

    // Explicit path ending with .mp4 / .mp3 so browsers always save with correct file extension
    let downloadUrl = `${API_BASE}/api/download/${encodeURIComponent(cleanName)}.${cleanExt}?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}&ext=${encodeURIComponent(cleanExt)}&title=${encodeURIComponent(title)}`;
    if (category) downloadUrl += `&category=${encodeURIComponent(category)}`;
    if (quality) downloadUrl += `&quality=${encodeURIComponent(quality)}`;
    if (height) downloadUrl += `&height=${encodeURIComponent(height)}`;
    
    showToast(`Download started: ${title.substring(0, 30)}...`);

    // Direct browser navigation: Since the server sends Content-Disposition: attachment,
    // the page is never replaced, and the browser's native download manager starts immediately.
    window.location.href = downloadUrl;

    setTimeout(() => {
      btnElement.disabled = false;
      btnElement.innerHTML = originalText;
    }, 4000);
  }

  // Save to Local History
  function saveToHistory(item) {
    try {
      let history = JSON.parse(localStorage.getItem('tubeswift_history') || '[]');
      // Filter out duplicate IDs
      history = history.filter(h => h.id !== item.id);
      history.unshift({
        id: item.id,
        title: item.title,
        thumbnail: item.thumbnail,
        url: item.originalUrl,
        timestamp: Date.now()
      });
      // Keep only top 6
      history = history.slice(0, 6);
      localStorage.setItem('tubeswift_history', JSON.stringify(history));
      loadHistory();
    } catch (e) {}
  }

  // Load and Render History
  function loadHistory() {
    if (!historySection || !historyList) return;
    try {
      const history = JSON.parse(localStorage.getItem('tubeswift_history') || '[]');
      if (history.length === 0) {
        historySection.style.display = 'none';
        return;
      }
      historySection.style.display = 'block';
      historyList.innerHTML = '';

      history.forEach(h => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
          <img class="history-thumb" src="${h.thumbnail}" alt="Thumbnail" loading="lazy">
          <div class="history-card-title">${h.title}</div>
        `;
        card.addEventListener('click', () => {
          urlInput.value = h.url;
          handleFetch();
        });
        historyList.appendChild(card);
      });
    } catch (e) {}
  }

  const btnClearHistory = document.getElementById('btnClearHistory');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      localStorage.removeItem('tubeswift_history');
      loadHistory();
      showToast('History cleared.');
    });
  }

  loadHistory();

  // QR Code Modal for Mobile Transfer
  if (btnQrTrigger && qrModal && btnCloseModal) {
    btnQrTrigger.addEventListener('click', () => {
      if (!currentVideoData) return;
      qrModal.style.display = 'flex';
      renderQr(currentVideoData.originalUrl);
    });

    btnCloseModal.addEventListener('click', () => {
      qrModal.style.display = 'none';
    });

    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.style.display = 'none';
    });
  }

  function renderQr(url) {
    if (!qrContainer) return;
    // Uses Google Chart / QR API for high-resolution instant QR generation
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
    qrContainer.innerHTML = `<img src="${qrUrl}" alt="Scan QR code with your phone camera" width="220" height="220" style="display:block; border-radius:8px;">`;
  }

  if (btnCopyShareLink) {
    btnCopyShareLink.addEventListener('click', () => {
      if (!currentVideoData) return;
      navigator.clipboard.writeText(currentVideoData.originalUrl);
      showToast('Video link copied to clipboard!');
    });
  }

  // FAQ Accordion
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    if (questionBtn) {
      questionBtn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        // Close others
        faqItems.forEach(i => i.classList.remove('open'));
        if (!isOpen) {
          item.classList.add('open');
        }
      });
    }
  });

  // Helpers
  function showError(msg) {
    if (alertBox && alertMessage) {
      alertMessage.textContent = msg;
      alertBox.style.display = 'flex';
    }
  }

  function hideError() {
    if (alertBox) {
      alertBox.style.display = 'none';
    }
  }
});
