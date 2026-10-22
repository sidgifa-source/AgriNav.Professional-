/* ═══════════════════════════════════════════════════════════════
   AgriNav Pro v9.4 — Offline Manager
   يتكامل مع التطبيق عبر window.OfflineManager / TileCacheManager / OfflineMapDialog
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══════════════════ OfflineManager ═══════════════════ */
  const OfflineManager = {
    sw: null,
    isOnline: navigator.onLine,
    updateReady: false,
    _listeners: {},
    _reloading: false,

    async init() {
      this._injectStyles();
      this._bindNetworkEvents();
      await this.registerSW();
      this._updateOnlineBadge();
    },

    async registerSW() {
      if (!('serviceWorker' in navigator)) {
        console.warn('[Offline] Service Worker not supported');
        this._showBanner('⚠️ المتصفح لا يدعم العمل دون اتصال', 'warn');
        return;
      }

      if (document.readyState !== 'complete') {
        await new Promise(r => window.addEventListener('load', r, { once: true }));
      }

      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        this.sw = reg;
        console.log('[Offline] SW registered, scope:', reg.scope);

        if (reg.waiting) {
          this._onUpdateReady(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this._onUpdateReady(newWorker);
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (this._reloading) return;
          this._reloading = true;
          window.location.reload();
        });

        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);

        navigator.serviceWorker.addEventListener('message', (e) => this._onSWMessage(e.data));
      } catch (err) {
        console.error('[Offline] SW registration failed:', err);
        this._showBanner('⚠️ تعذّر تفعيل العمل دون اتصال', 'warn');
      }
    },

    _onSWMessage(msg) {
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'SW_READY': console.log('[Offline] SW ready:', msg.version); break;
        case 'TILE_PROGRESS': this._emit('tile-progress', msg.payload); break;
        case 'TILE_COMPLETE': this._emit('tile-complete', msg.payload); break;
        case 'TILE_ABORTED': this._emit('tile-aborted', msg.payload); break;
        case 'TILE_ERROR': this._emit('tile-error', msg.payload); break;
        case 'CACHE_INFO': this._emit('cache-info', msg.payload); break;
        case 'TILES_CLEARED': this._emit('tiles-cleared'); break;
      }
    },

    _onUpdateReady(worker) {
      this.updateReady = true;
      this._showUpdateBanner(worker);
    },

    applyUpdate() {
      if (!this.sw || !this.sw.waiting) {
        window.location.reload();
        return;
      }
      this.sw.waiting.postMessage({ type: 'SKIP_WAITING' });
    },

    _bindNetworkEvents() {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this._updateOnlineBadge();
        this._showBanner('✅ تم استعادة الاتصال', 'success');
        if (this.sw) this.sw.update().catch(() => {});
      });
      window.addEventListener('offline', () => {
        this.isOnline = false;
        this._updateOnlineBadge();
        this._showBanner('📡 أنت غير متصل — التطبيق يعمل محلياً', 'warn');
      });
    },

    _updateOnlineBadge() {
      let badge = document.getElementById('agrinav-offline-badge');
      if (this.isOnline) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'agrinav-offline-badge';
        badge.style.cssText = `
          position: fixed; top: 80px; right: 12px; z-index: 99999;
          background: linear-gradient(135deg,#e65100,#ff9800);
          color: #fff; padding: 6px 12px; border-radius: 20px;
          font-family: 'Courier New', monospace; font-size: .75rem;
          font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,.4);
          animation: offlinePulse 2s infinite;
        `;
        badge.textContent = '📡 غير متصل';
        document.body.appendChild(badge);
      }
    },

    _showBanner(text, type) {
      let b = document.getElementById('agrinav-sw-banner');
      if (b) b.remove();
      b = document.createElement('div');
      b.id = 'agrinav-sw-banner';
      const colors = {
        success: 'linear-gradient(135deg,#1b5e20,#2e7d32)',
        warn: 'linear-gradient(135deg,#e65100,#ff9800)',
        info: 'linear-gradient(135deg,#0d47a1,#1976d2)',
        error: 'linear-gradient(135deg,#b71c1c,#d32f2f)'
      };
      b.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0;
        padding: 8px 16px; text-align: center;
        color: #fff; font-weight: bold; font-size: .85rem;
        background: ${colors[type] || colors.info};
        z-index: 99999; transform: translateY(-100%);
        transition: transform .3s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,.3);
      `;
      b.textContent = text;
      document.body.appendChild(b);
      requestAnimationFrame(() => b.style.transform = 'translateY(0)');
      if (type !== 'warn' || text.includes('غير متصل')) {
        setTimeout(() => {
          b.style.transform = 'translateY(-100%)';
          setTimeout(() => b.remove(), 350);
        }, 3500);
      }
    },

    _showUpdateBanner(worker) {
      let b = document.getElementById('agrinav-update-banner');
      if (b) return;
      b = document.createElement('div');
      b.id = 'agrinav-update-banner';
      b.style.cssText = `
        position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
        z-index: 99999; background: linear-gradient(135deg,#0d47a1,#1976d2);
        color: #fff; padding: 12px 18px; border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0,0,0,.5); font-size: .9rem;
        font-weight: bold; display: flex; align-items: center; gap: 12px;
        max-width: 90vw; direction: rtl;
      `;
      b.innerHTML = `
        <span>🔄 إصدار جديد متاح</span>
        <button id="agrinav-update-now" style="background:#ffd700;color:#0d47a1;border:none;padding:8px 16px;border-radius:8px;font-weight:bold;cursor:pointer;font-family:inherit;">تحديث الآن</button>
        <button id="agrinav-update-later" style="background:transparent;color:#fff;border:1px solid #fff;padding:6px 10px;border-radius:8px;cursor:pointer;font-family:inherit;">لاحقاً</button>
      `;
      document.body.appendChild(b);
      document.getElementById('agrinav-update-now').onclick = () => this.applyUpdate();
      document.getElementById('agrinav-update-later').onclick = () => b.remove();
    },

    on(event, cb) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(cb);
      return () => this.off(event, cb);
    },
    off(event, cb) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(f => f !== cb);
      }
    },
    _emit(event, data) {
      (this._listeners[event] || []).forEach(cb => {
        try { cb(data); } catch (e) { console.error('[Offline] listener error:', e); }
      });
    },

    _injectStyles() {
      if (document.getElementById('offline-manager-styles')) return;
      const s = document.createElement('style');
      s.id = 'offline-manager-styles';
      s.textContent = `
        @keyframes offlinePulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50% { opacity: .75; transform: scale(1.03); }
        }
        #agrinav-tile-modal-overlay {
          position: fixed; inset: 0; z-index: 99999;
          background: rgba(0,0,0,.85); backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        #agrinav-tile-modal {
          background: linear-gradient(135deg, #1a2332, #0f1419);
          color: #fff; padding: 24px; border-radius: 20px;
          width: 100%; max-width: 520px;
          box-shadow: 0 20px 60px rgba(0,0,0,.6);
          border: 2px solid #00bcd4; direction: rtl;
          font-family: 'Segoe UI', Tahoma, sans-serif;
          max-height: 90vh; overflow-y: auto;
        }
        #agrinav-tile-modal h2 {
          color: #00bcd4; margin-bottom: 16px; font-size: 1.2rem;
          display: flex; align-items: center; gap: 8px;
        }
        #agrinav-tile-modal label {
          display: block; margin: 12px 0 6px; font-weight: bold;
          color: #ffd700; font-size: .85rem;
        }
        #agrinav-tile-modal select,
        #agrinav-tile-modal input {
          width: 100%; padding: 10px; border-radius: 10px;
          border: 2px solid #00bcd4; background: #0a1418;
          color: #fff; font-size: .95rem; font-family: inherit;
        }
        #agrinav-tile-modal .agrinav-actions {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 10px; margin-top: 20px;
        }
        #agrinav-tile-modal button {
          padding: 12px; border: none; border-radius: 10px;
          font-weight: bold; font-size: .9rem; cursor: pointer;
          font-family: inherit; transition: transform .15s;
        }
        #agrinav-tile-modal button:active { transform: scale(.97); }
        #agrinav-tile-modal button.primary { background: #2e7d32; color: #fff; }
        #agrinav-tile-modal button.danger { background: #d32f2f; color: #fff; }
        #agrinav-tile-modal button.ghost { background: #444; color: #fff; }
        #agrinav-tile-modal button:disabled { opacity: .5; cursor: not-allowed; }
        .agrinav-progress-bar {
          height: 16px; background: #222; border-radius: 8px;
          overflow: hidden; margin: 12px 0; border: 1px solid #00bcd4;
        }
        .agrinav-progress-fill {
          height: 100%; background: linear-gradient(90deg,#f44336,#ffc107,#4caf50);
          transition: width .3s; width: 0%;
        }
        .agrinav-info-row {
          display: flex; justify-content: space-between;
          padding: 6px 0; font-size: .8rem;
          border-bottom: 1px solid rgba(0,188,212,.2);
        }
        .agrinav-info-row span:last-child { color: #00e5ff; font-weight: bold; font-family: 'Courier New', monospace; }
      `;
      document.head.appendChild(s);
    }
  };

  /* ═══════════════════ TileCacheManager ═══════════════════ */
  const TileCacheManager = {
    templates: {
      osm: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      topo: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png'
    },

    latLngToTile(lat, lng, z) {
      const n = Math.pow(2, z);
      const x = Math.floor((lng + 180) / 360 * n);
      const latRad = lat * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      return { x, y, z };
    },

    urlsForPolygon(polygonLatLngs, minZoom, maxZoom, template) {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      polygonLatLngs.forEach(p => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      });

      const urls = [];
      const seen = new Set();

      for (let z = minZoom; z <= maxZoom; z++) {
        const nw = this.latLngToTile(maxLat, minLng, z);
        const se = this.latLngToTile(minLat, maxLng, z);
        const minX = Math.min(nw.x, se.x);
        const maxX = Math.max(nw.x, se.x);
        const minY = Math.min(nw.y, se.y);
        const maxY = Math.max(nw.y, se.y);

        const count = (maxX - minX + 1) * (maxY - minY + 1);
        if (count > 50000) {
          console.warn(`[TileCache] Too many tiles at z=${z} (${count}), skipping`);
          continue;
        }

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
            if (!seen.has(url)) { seen.add(url); urls.push(url); }
          }
        }
      }

      return urls;
    },

    estimateCount(polygonLatLngs, minZoom, maxZoom) {
      return this.urlsForPolygon(polygonLatLngs, minZoom, maxZoom, this.templates.osm).length;
    },

    async cache(polygonLatLngs, minZoom, maxZoom, templateKey) {
      if (!navigator.serviceWorker.controller) {
        throw new Error('Service Worker غير مفعّل. أعد تحميل الصفحة.');
      }
      const template = this.templates[templateKey] || this.templates.osm;
      const urls = this.urlsForPolygon(polygonLatLngs, minZoom, maxZoom, template);
      if (urls.length === 0) throw new Error('لا توجد بلاطات للتحميل');
      if (urls.length > 20000) throw new Error(`عدد البلاطات كبير جداً (${urls.length}). قلّل النطاق.`);

      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_TILES',
        payload: { urls }
      });
      return { total: urls.length };
    },

    abort() {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'ABORT_CACHE_TILES' });
      }
    },

    async getInfo() {
      return new Promise((resolve, reject) => {
        if (!navigator.serviceWorker.controller) return reject(new Error('No SW'));
        const timer = setTimeout(() => reject(new Error('Timeout')), 8000);
        const handler = (e) => {
          if (e.data && e.data.type === 'CACHE_INFO') {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener('message', handler);
            resolve(e.data.payload);
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_INFO' });
      });
    },

    async clear() {
      return new Promise((resolve, reject) => {
        if (!navigator.serviceWorker.controller) return reject(new Error('No SW'));
        const timer = setTimeout(() => reject(new Error('Timeout')), 8000);
        const handler = (e) => {
          if (e.data && e.data.type === 'TILES_CLEARED') {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener('message', handler);
            resolve();
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_TILES' });
      });
    }
  };

  /* ═══════════════════ OfflineMapDialog ═══════════════════ */
  const OfflineMapDialog = {
    open(polygonLatLngs) {
      if (!polygonLatLngs || polygonLatLngs.length < 3) {
        alert('⚠️ يجب رسم مضلع أولاً');
        return;
      }
      this._poly = polygonLatLngs;
      this._render();
    },

    _render() {
      const old = document.getElementById('agrinav-tile-modal-overlay');
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = 'agrinav-tile-modal-overlay';
      overlay.innerHTML = `
        <div id="agrinav-tile-modal">
          <h2>🗺️ تحميل خرائط للعمل دون اتصال</h2>
          <p style="color:#9aa0a6;font-size:.8rem;line-height:1.6;">حمّل بلاطات المنطقة الحالية ليتمكن التطبيق من عرض الخريطة دون إنترنت.</p>

          <label>نوع الخريطة</label>
          <select id="agrinav-layer-select">
            <option value="osm">🗺️ الطرق الأساسية (OSM)</option>
            <option value="topo">⛰️ التضاريس (OpenTopoMap)</option>
            <option value="satellite">🛰️ القمر الصناعي (ArcGIS)</option>
          </select>

          <label>مستوى التفاصيل (Zoom)</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <span style="font-size:.7rem;color:#9aa0a6;">من</span>
              <select id="agrinav-zoom-min">
                ${[10,11,12,13,14,15,16].map(z => `<option value="${z}" ${z === 13 ? 'selected' : ''}>${z}</option>`).join('')}
              </select>
            </div>
            <div>
              <span style="font-size:.7rem;color:#9aa0a6;">إلى</span>
              <select id="agrinav-zoom-max">
                ${[14,15,16,17,18,19].map(z => `<option value="${z}" ${z === 17 ? 'selected' : ''}>${z}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="margin-top:14px;padding:12px;background:rgba(0,188,212,.1);border-radius:10px;border:1px solid rgba(0,188,212,.3);">
            <div class="agrinav-info-row"><span>📊 عدد البلاطات المتوقّع</span><span id="agrinav-tile-count">—</span></div>
            <div class="agrinav-info-row"><span>💾 الحجم التقريبي</span><span id="agrinav-tile-size">—</span></div>
            <div class="agrinav-info-row"><span>💽 المخزَّن حالياً</span><span id="agrinav-cache-info">—</span></div>
          </div>

          <div id="agrinav-progress-wrap" style="display:none;margin-top:14px;">
            <div class="agrinav-progress-bar"><div class="agrinav-progress-fill" id="agrinav-progress-fill"></div></div>
            <div class="agrinav-info-row"><span>📥 التقدّم</span><span id="agrinav-progress-text">0 / 0</span></div>
            <div class="agrinav-info-row"><span>⏱️ الوقت المتبقي</span><span id="agrinav-eta">—</span></div>
            <div class="agrinav-info-row"><span>📦 تم تحميلها</span><span id="agrinav-done-count">0</span></div>
          </div>

          <div class="agrinav-actions">
            <button class="primary" id="agrinav-download-btn">📥 بدء التحميل</button>
            <button class="ghost" id="agrinav-close-btn">إغلاق</button>
          </div>
          <button class="danger" id="agrinav-clear-tiles-btn" style="margin-top:10px;width:100%;">🗑️ مسح البلاطات المخزَّنة</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const $ = id => document.getElementById(id);

      $('agrinav-layer-select').addEventListener('change', () => this._updateEstimate());
      $('agrinav-zoom-min').addEventListener('change', () => this._updateEstimate());
      $('agrinav-zoom-max').addEventListener('change', () => this._updateEstimate());
      $('agrinav-close-btn').onclick = () => overlay.remove();
      $('agrinav-download-btn').onclick = () => this._startDownload();
      $('agrinav-clear-tiles-btn').onclick = () => this._clearTiles();

      this._updateEstimate();
      this._loadCacheInfo();
    },

    _getConfig() {
      return {
        layer: document.getElementById('agrinav-layer-select').value,
        minZoom: parseInt(document.getElementById('agrinav-zoom-min').value),
        maxZoom: parseInt(document.getElementById('agrinav-zoom-max').value)
      };
    },

    _updateEstimate() {
      const { minZoom, maxZoom } = this._getConfig();
      if (minZoom > maxZoom) {
        document.getElementById('agrinav-tile-count').textContent = '❌ نطاق خاطئ';
        document.getElementById('agrinav-tile-size').textContent = '—';
        return;
      }
      const count = TileCacheManager.estimateCount(this._poly, minZoom, maxZoom);
      const sizeMB = (count * 20000 / 1024 / 1024).toFixed(2);
      document.getElementById('agrinav-tile-count').textContent = count.toLocaleString();
      document.getElementById('agrinav-tile-size').textContent = sizeMB + ' MB';
    },

    async _loadCacheInfo() {
      try {
        const info = await TileCacheManager.getInfo();
        document.getElementById('agrinav-cache-info').textContent =
          `${info.tilesCount.toLocaleString()} بلاطة (${info.tilesSizeMB} MB)`;
      } catch (e) {
        document.getElementById('agrinav-cache-info').textContent = '—';
      }
    },

    async _startDownload() {
      const { layer, minZoom, maxZoom } = this._getConfig();
      if (minZoom > maxZoom) {
        alert('❌ مستوى Zoom غير صالح');
        return;
      }

      const btn = document.getElementById('agrinav-download-btn');
      const progressWrap = document.getElementById('agrinav-progress-wrap');
      const progressFill = document.getElementById('agrinav-progress-fill');
      const progressText = document.getElementById('agrinav-progress-text');
      const etaText = document.getElementById('agrinav-eta');
      const doneText = document.getElementById('agrinav-done-count');

      btn.disabled = true;
      btn.textContent = '⏸️ جاري التحميل...';
      progressWrap.style.display = 'block';

      const onProgress = (p) => {
        const pct = (p.done / p.total) * 100;
        progressFill.style.width = pct.toFixed(1) + '%';
        progressText.textContent = `${p.done} / ${p.total} (${pct.toFixed(1)}%)`;
        doneText.textContent = `${p.done} (فشل: ${p.failed})`;
        etaText.textContent = p.eta > 0 ? `~${p.eta} ثانية` : '—';
      };

      const onComplete = (res) => {
        OfflineManager.off('tile-progress', onProgress);
        OfflineManager.off('tile-complete', onComplete);
        OfflineManager.off('tile-aborted', onAbort);
        progressFill.style.width = '100%';
        btn.disabled = false;
        btn.textContent = '✅ اكتمل التحميل';
        progressText.textContent = `✅ ${res.done} / ${res.total} (${res.elapsed} ثانية)`;
        etaText.textContent = '—';
        this._loadCacheInfo();
        setTimeout(() => { btn.textContent = '📥 تحميل مرة أخرى'; }, 2500);
      };

      const onAbort = (res) => {
        OfflineManager.off('tile-progress', onProgress);
        OfflineManager.off('tile-complete', onComplete);
        OfflineManager.off('tile-aborted', onAbort);
        btn.disabled = false;
        btn.textContent = '📥 استئناف';
        progressText.textContent = `⏸️ متوقف عند ${res.done} / ${res.total}`;
      };

      OfflineManager.on('tile-progress', onProgress);
      OfflineManager.on('tile-complete', onComplete);
      OfflineManager.on('tile-aborted', onAbort);

      try {
        await TileCacheManager.cache(this._poly, minZoom, maxZoom, layer);
      } catch (err) {
        alert('❌ ' + err.message);
        btn.disabled = false;
        btn.textContent = '📥 بدء التحميل';
      }
    },

    async _clearTiles() {
      if (!confirm('🗑️ حذف كل البلاطات المخزَّنة؟')) return;
      try {
        await TileCacheManager.clear();
        alert('✅ تم مسح البلاطات');
        this._loadCacheInfo();
      } catch (e) {
        alert('❌ ' + e.message);
      }
    }
  };

  /* ═══════════════════ Exposure ═══════════════════ */
  window.OfflineManager = OfflineManager;
  window.TileCacheManager = TileCacheManager;
  window.OfflineMapDialog = OfflineMapDialog;

  /* ═══════════════════ Auto-init ═══════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => OfflineManager.init());
  } else {
    OfflineManager.init();
  }
})();