/* Shared helpers for every game: randomness, entries, colors, sound, effects and files. */
(() => {
  'use strict';
  const PW = (window.PW = window.PW || {});
  const TAU = Math.PI * 2;

  const $ = (id) => document.getElementById(id);
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  // Cryptographically strong float in [0, 1)
  function rand() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }

  // ---------- Entries ----------
  // An item is one entry in a list: { id, name, qty, start, mode }.
  //   qty   – how many are left (0 = off the board, still listed)
  //   start – the quantity it was set to, used by "Reset counts"
  //   mode  – 'count': one slice/bin labelled "Name ×qty"
  //           'split': qty separate slices/bins spread out
  let uid = 0;
  const newId = () => `i${(uid++).toString(36)}`;
  const clampQty = (n) => Math.max(0, Math.min(999, Math.floor(+n) || 0));
  const makeItem = (name, qty = 1, mode = 'count') => {
    const q = clampQty(qty);
    return { id: newId(), name, qty: q, start: q, mode: mode === 'split' ? 'split' : 'count' };
  };
  const itemsFromText = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => makeItem(l.slice(0, 120)));
  const compactItems = (items) => items.map((i) => [i.name, i.qty, i.start, i.mode]);

  function sanitizeItems(arr) {
    if (!Array.isArray(arr)) return null;
    return arr
      .map((x) => (Array.isArray(x) ? { name: x[0], qty: x[1], start: x[2], mode: x[3] } : x))
      .filter((x) => x && typeof x.name === 'string' && x.name.trim())
      .map((x) => {
        const qty = clampQty(x.qty ?? 1);
        return { id: newId(), name: x.name.trim().slice(0, 120), qty, start: Math.max(qty, clampQty(x.start ?? qty)), mode: x.mode === 'split' ? 'split' : 'count' };
      });
  }

  // One entry per slice/bin. A 'split' item contributes qty units; each item's copies are
  // offset by its list position so they spread evenly around the wheel or along the bins.
  function buildUnits(items) {
    const live = items.filter((it) => it.qty > 0);
    const units = [];
    live.forEach((item, i) => {
      const offset = (i + 0.5) / live.length;
      const copies = item.mode === 'split' ? item.qty : 1;
      for (let j = 0; j < copies; j++) units.push({ item, key: (j + offset) / copies });
    });
    return units.sort((a, b) => a.key - b.key).map((u) => u.item);
  }
  const showsCount = (it) => it.mode === 'count' && (it.start > 1 || it.qty > 1);
  const suffixFor = (it) => (showsCount(it) ? ` ×${it.qty}` : '');

  // ---------- Colors ----------
  const PALETTES = {
    vivid:  ['#E5484D', '#F76B15', '#FFC53D', '#30A46C', '#12A594', '#0090FF', '#6E56CF', '#D6409F'],
    pastel: ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'],
    ocean:  ['#03045E', '#0077B6', '#00B4D8', '#48CAE4', '#90E0EF', '#023E8A'],
    sunset: ['#F94144', '#F3722C', '#F8961E', '#F9C74F', '#90BE6D', '#43AA8B', '#577590'],
    forest: ['#1B4332', '#2D6A4F', '#40916C', '#52B788', '#95D5B2', '#D8F3DC'],
    candy:  ['#FF70A6', '#FF9770', '#FFD670', '#E9FF70', '#70D6FF', '#B388EB'],
    mono:   ['#1F2937', '#374151', '#4B5563', '#6B7280', '#9CA3AF'],
    gold:   ['#B8860B', '#1C1C1C', '#DAA520', '#2E2E2E'],
  };
  function paletteColors(state) {
    if (state.palette === 'custom') {
      const list = state.customColors.match(/#(?:[0-9a-f]{3}){1,2}\b/gi) || [];
      if (list.length) return list;
    }
    return PALETTES[state.palette] || PALETTES.vivid;
  }
  // Cycle the palette, avoiding a last slice that matches the first one
  function colorAt(colors, i, n) {
    let c = colors[i % colors.length];
    if (i === n - 1 && i > 0 && colors.length > 2 && c === colors[0]) c = colors[(i + 1) % colors.length];
    return c;
  }
  function luminance(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const textOn = (hex) => (luminance(hex) > 0.4 ? '#14171c' : '#ffffff');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Truncate with an ellipsis to fit maxW using the context's current font
  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const chars = Array.from(text);
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(chars.slice(0, mid).join('') + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return chars.slice(0, lo).join('') + '…';
  }

  const imageReady = (img) => !!(img && img.complete && img.naturalWidth);

  // Draws an image to cover a circle of radius r centred on (x, y)
  function drawCircleImage(ctx, img, x, y, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    const k = Math.max((r * 2) / img.naturalWidth, (r * 2) / img.naturalHeight);
    ctx.drawImage(img, x - img.naturalWidth * k / 2, y - img.naturalHeight * k / 2, img.naturalWidth * k, img.naturalHeight * k);
    ctx.restore();
  }

  // ---------- Sound (generated, no files) ----------
  function createSound(isOn) {
    let audio = null;
    function unlock() {
      if (!audio) audio = safe(() => new (window.AudioContext || window.webkitAudioContext)(), null);
      if (audio && audio.state === 'suspended') audio.resume();
      return audio;
    }
    function tick(pitch = 1) {
      if (!isOn()) return;
      const a = unlock(); if (!a) return;
      const t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1500 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(600 * pitch, t + 0.03);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.06);
    }
    function fanfare() {
      if (!isOn()) return;
      const a = unlock(); if (!a) return;
      const t0 = a.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t = t0 + i * 0.11;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'square'; o.frequency.value = f;
        const dur = i === 3 ? 0.6 : 0.16;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
      });
    }
    return { unlock, tick, fanfare };
  }

  // ---------- Confetti ----------
  let confettiRun = 0;
  function confetti(colors) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('confetti'), cc = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const parts = Array.from({ length: 180 }, () => ({
      x: cv.width * (0.2 + 0.6 * Math.random()), y: cv.height * 0.35,
      vx: (Math.random() - 0.5) * 22 * dpr, vy: (-Math.random() * 18 - 6) * dpr,
      w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
      r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const run = ++confettiRun;
    const start = performance.now();
    (function step(now) {
      if (run !== confettiRun) return;
      const el = now - start;
      cc.clearRect(0, 0, cv.width, cv.height);
      cc.globalAlpha = Math.max(0, 1 - Math.max(0, el - 2200) / 1000);
      for (const p of parts) {
        p.vy += 0.5 * dpr; p.vx *= 0.99; p.vy *= 0.99;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        cc.save(); cc.translate(p.x, p.y); cc.rotate(p.r);
        cc.fillStyle = p.c; cc.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        cc.restore();
      }
      if (el < 3200) requestAnimationFrame(step); else cc.clearRect(0, 0, cv.width, cv.height);
    })(start);
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { try { window.prompt('Copy this:', text); } catch { toast("Couldn't access the clipboard"); } }
  }
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setSeg(groupId, value) {
    document.querySelectorAll(`#${groupId} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === value)));
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  // Reads an image file and scales it down to at most 400px, as a PNG data URL
  async function shrinkImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = reject;
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
    const img = await loadImage(dataUrl);
    const k = Math.min(1, 400 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  // URL-safe base64 JSON, used for share links
  function encodeJSON(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeJSON(str) {
    return safe(() => {
      const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    }, null);
  }

  PW.util = {
    TAU, $, safe, rand,
    clampQty, makeItem, itemsFromText, compactItems, sanitizeItems, buildUnits, showsCount, suffixFor,
    PALETTES, paletteColors, colorAt, textOn, cssVar, fitText, imageReady, drawCircleImage,
    createSound, confetti, toast, copy, download, setSeg, loadImage, shrinkImage, encodeJSON, decodeJSON,
  };
})();
