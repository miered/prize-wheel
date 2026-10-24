/* Plinko: numbered drop slots on top, a triangle of pegs, prize bins below.
   Every peg is a fair left/right coin flip from the crypto RNG, so the chip tends to land
   near the slot it started from and far bins are rarer. One slot sits above each bin. */
(() => {
  'use strict';
  const PW = window.PW;
  const U = PW.util;
  const TAU = Math.PI * 2;
  const MAX_BINS = 24;                                   // the most that still read well on a 1366×768 laptop
  const SPEEDS = { slow: 240, normal: 160, fast: 95 };   // ms per peg row
  const FLASH_MS = 220;

  // Even number of peg rows, so a chip starting above a bin always ends in a bin.
  const rowsFor = (B) => (B <= 1 ? 2 : Math.min(14, Math.max(6, B + (B % 2))));

  // app: { state, sound, colors(), logo(spot), headerInfo(), lock(on), closeDialog(), result(r) }
  PW.createPlinko = (app) => {
    const canvas = U.$('plinko'), ctx = canvas.getContext('2d');
    const slotInput = U.$('slotInput'), viewerInput = U.$('viewerInput'), dropBtn = U.$('dropBtn');
    let bins = [];        // [{ item, color, suffix }]
    let sig = '';         // bin layout signature; the resting chip clears when it changes
    let geo = null;       // layout in CSS pixels
    let busy = false;
    let chip = null;      // { x: bin column, y: px } while falling; { x, rest: true } once settled
    let hover = -1;       // slot under the mouse
    let litBin = -1;      // bin that just won
    const flashes = new Map();   // "row:x" -> time the peg was hit

    function rebuild() {
      const units = U.buildUnits(app.state.plinkoItems);
      const colors = app.colors();
      bins = units.map((item, i) => ({ item, color: U.colorAt(colors, i, units.length), suffix: U.suffixFor(item) }));
      const next = units.map((it) => it.id).join(',');
      if (next !== sig && !busy) { chip = null; litBin = -1; }
      sig = next;
      slotInput.max = Math.max(1, bins.length);
      slotInput.placeholder = bins.length ? `1–${bins.length}` : '–';
      dropBtn.disabled = busy || !playable();
      redraw();
    }
    const playable = () => bins.length > 0 && bins.length <= MAX_BINS;

    // ---------- Layout ----------
    function layout() {
      const rect = canvas.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      if (!W || !H) { geo = null; return; }
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      }
      const B = Math.max(1, Math.min(bins.length, MAX_BINS));
      const R = rowsFor(B);
      const header = app.headerInfo();
      const pad = 14;
      const headH = header ? 46 : 0;
      // Height in units of one bin width: slots, gap, peg rows, gap, bins
      const vu = 1.0 + 0.6 + (R - 1) * 0.82 + 0.7 + 2.4 + 0.3;
      const u = Math.max(6, Math.min(96, (W - pad * 2) / (B + 0.7), (H - pad * 2 - headH) / vu));
      const boardH = vu * u;
      const top = pad + headH + Math.max(0, (H - pad * 2 - headH - boardH) / 2);
      const pegTop = top + u * 1.6;
      const rowH = u * 0.82;
      const binTop = pegTop + (R - 1) * rowH + u * 0.7;
      geo = {
        W, H, dpr, B, R, u, header, headH, pad, top, pegTop, rowH, binTop,
        left: (W - u * B) / 2, slotY: top + u * 0.5, binH: u * 2.4,
        pegR: Math.max(2, u * 0.085), chipR: u * 0.3,
      };
    }
    const px = (x) => geo.left + (x + 0.5) * geo.u;
    const restY = () => geo.binTop + geo.chipR + geo.u * 0.12;
    const rowY = (r) => geo.pegTop + r * geo.rowH;
    const pegsInRow = (r) => {
      const xs = [];
      if (r % 2 === 0) for (let x = 0; x < geo.B; x++) xs.push(x);
      else for (let x = 0.5; x < geo.B - 1; x++) xs.push(x);
      return xs;
    };

    // ---------- Drawing ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    }

    function draw(now = performance.now()) {
      if (!geo) return;
      const { W, H, dpr, B, u } = geo;
      const accent = U.cssVar('--accent'), text = U.cssVar('--text'), muted = U.cssVar('--muted');
      const surface = U.cssVar('--surface'), surface2 = U.cssVar('--surface-2'), border = U.cssVar('--border');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Header: logo + channel name (or wheel title)
      if (geo.header) {
        const { img, text: label } = geo.header;
        const hy = geo.top - geo.headH / 2 - 6;   // sits just above the board
        ctx.font = `700 20px system-ui, -apple-system, "Segoe UI", sans-serif`;
        const name = U.fitText(ctx, label || '', W - 120);
        const r = 17;
        const hasImg = U.imageReady(img);
        const w = ctx.measureText(name).width + (hasImg ? r * 2 + 10 : 0);
        let x = (W - w) / 2;
        if (hasImg) {
          U.drawCircleImage(ctx, img, x + r, hy, r);
          ctx.lineWidth = 2; ctx.strokeStyle = accent;
          ctx.beginPath(); ctx.arc(x + r, hy, r, 0, TAU); ctx.stroke();
          x += r * 2 + 10;
        }
        ctx.fillStyle = document.body.classList.contains('green') ? '#0b3d0b' : text;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(name, x, hy);
      }

      if (!bins.length || bins.length > MAX_BINS) {
        ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 18px system-ui, sans-serif`;
        const msg = bins.length
          ? [`${bins.length} bins is more than this board fits (max ${MAX_BINS}).`, 'Use “One bin with a count” or merge duplicates.']
          : ['Add some prizes →'];
        msg.forEach((m, i) => ctx.fillText(m, W / 2, H / 2 + (i - (msg.length - 1) / 2) * 28));
        return;
      }

      // Board panel
      const panelX = geo.left - u * 0.35, panelW = u * B + u * 0.7;
      const panelBottom = geo.binTop + geo.binH + u * 0.3;
      roundRect(panelX, geo.top - u * 0.15, panelW, panelBottom - geo.top + u * 0.15, u * 0.35);
      ctx.fillStyle = surface2; ctx.fill();

      // Drop slots
      const picked = parseInt(slotInput.value, 10) - 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < B; i++) {
        const on = i === hover || (i === picked && !busy);
        ctx.beginPath(); ctx.arc(px(i), geo.slotY, u * 0.38, 0, TAU);
        ctx.fillStyle = on ? accent : surface; ctx.fill();
        ctx.lineWidth = Math.max(1, u * 0.03); ctx.strokeStyle = on ? accent : border; ctx.stroke();
        ctx.fillStyle = on ? U.cssVar('--accent-text') : text;
        ctx.font = `800 ${Math.max(9, u * (i + 1 >= 10 ? 0.34 : 0.4))}px system-ui, sans-serif`;
        ctx.fillText(String(i + 1), px(i), geo.slotY + 1);
      }

      // Pegs
      for (let r = 0; r < geo.R; r++) {
        for (const x of pegsInRow(r)) {
          const hit = flashes.get(`${r}:${x}`);
          const age = hit === undefined ? Infinity : now - hit;
          const lit = age < FLASH_MS;
          ctx.beginPath(); ctx.arc(px(x), rowY(r), geo.pegR * (lit ? 1.7 - 0.7 * age / FLASH_MS : 1), 0, TAU);
          ctx.fillStyle = lit ? accent : muted; ctx.fill();
        }
      }

      // Bins
      const gap = Math.max(1.5, u * 0.05);
      for (let i = 0; i < B; i++) {
        const b = bins[i];
        const x = geo.left + i * u + gap, w = u - gap * 2;
        roundRect(x, geo.binTop, w, geo.binH, Math.min(8, u * 0.12));
        ctx.fillStyle = b.color; ctx.fill();
        if (i === litBin) {
          ctx.save();
          ctx.lineWidth = Math.max(3, u * 0.08); ctx.strokeStyle = accent;
          ctx.shadowColor = accent; ctx.shadowBlur = u * 0.4;
          ctx.stroke();
          ctx.restore();
        }
        drawBinLabel(b, i, w);
      }
      // Dividers rise slightly above the bins
      ctx.fillStyle = border;
      for (let i = 0; i <= B; i++) {
        const x = geo.left + i * u;
        ctx.fillRect(x - gap / 2, geo.binTop - u * 0.3, gap, u * 0.3);
      }

      // Chip
      if (chip) drawChip(px(chip.x), chip.rest ? restY() : chip.y, accent);
    }

    function drawBinLabel(b, i, w) {
      const u = geo.u;
      const label = b.item.name + b.suffix;
      ctx.fillStyle = U.textOn(b.color);
      let fs = Math.max(9, Math.min(17, u * 0.24));
      ctx.font = `650 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      // Fits across the bin → horizontal; otherwise read bottom-to-top
      if (ctx.measureText(label).width <= w - 8) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, px(i), geo.binTop + geo.binH * 0.62);
        return;
      }
      fs = Math.max(9, Math.min(17, w * 0.5));
      ctx.font = `650 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.save();
      ctx.translate(px(i), geo.binTop + geo.binH - 8);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      // Leave space for a chip resting at the top of this bin
      const room = geo.binH - 16 - (chip?.rest && chip.x === i ? geo.chipR * 2 : 0);
      ctx.fillText(U.fitText(ctx, b.item.name, room - ctx.measureText(b.suffix).width) + b.suffix, 0, 0);
      ctx.restore();
    }

    function drawChip(x, y, accent) {
      const r = geo.chipR;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = r * 0.6; ctx.shadowOffsetY = r * 0.15;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
      const logo = app.logo('plinkoChip');
      if (U.imageReady(logo)) {
        U.drawCircleImage(ctx, logo, x, y, r - 2);
      } else {
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, accent); g.addColorStop(1, accent);
        ctx.beginPath(); ctx.arc(x, y, r - 2, 0, TAU); ctx.fillStyle = g; ctx.fill();
      }
      ctx.lineWidth = Math.max(2, r * 0.14); ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.arc(x, y, r - 1, 0, TAU); ctx.stroke();
    }

    function redraw() { layout(); draw(); }

    // ---------- Dropping ----------
    function drop(slot) {
      if (busy) return;
      if (!playable()) { U.toast(bins.length ? `Too many bins. The max is ${MAX_BINS}.` : 'Add some prizes first'); return; }
      const B = bins.length;
      if (!(slot >= 0 && slot < B)) { U.toast(`Pick a slot from 1 to ${B}`); slotInput.focus(); return; }
      app.closeDialog();
      app.sound.unlock();
      busy = true; app.lock(true); dropBtn.disabled = true;
      litBin = -1; hover = -1;
      slotInput.value = slot + 1;
      const viewer = viewerInput.value.trim().slice(0, 60);
      layout();

      // Decide the whole path up front: one fair coin flip per peg row.
      // The side walls push a chip at the edge back inward.
      const R = geo.R;
      const xs = [slot];
      let x = slot;
      for (let r = 0; r < R; r++) {
        const options = [x - 0.5, x + 0.5].filter((v) => v >= 0 && v <= B - 1);
        if (options.length === 2) x = U.rand() < 0.5 ? options[0] : options[1];
        else if (options.length === 1) x = options[0];
        xs.push(x);
      }
      const binIdx = Math.round(x);

      // Keyframes: 0 = slot, k (1..R) = resting on peg row k-1, R+1 = settled in the bin.
      // Computed from the live layout so resizing mid-drop stays correct.
      const point = (k) => {
        if (k === 0) return { x: slot, y: geo.slotY };
        if (k <= R) return { x: xs[k - 1], y: rowY(k - 1) - geo.pegR - geo.chipR };
        return { x: xs[R], y: restY() };
      };
      const T = SPEEDS[app.state.dropSpeed] || SPEEDS.normal;
      const durs = Array.from({ length: R + 1 }, (_, k) => (k === 0 ? T * 1.3 : k === R ? T * 1.5 : T));
      let seg = 0, segStart = null;

      function arrive(k, now) {
        // Arriving at keyframe k (1..R) means hitting peg row k-1
        if (k >= 1 && k <= R) {
          const r = k - 1;
          if (pegsInRow(r).includes(xs[r])) {
            flashes.set(`${r}:${xs[r]}`, now);
            app.sound.tick(0.85 + Math.random() * 0.3);
          }
        } else if (k === R + 1) {
          app.sound.tick(0.5);
        }
      }

      function frame(now) {
        if (segStart === null) segStart = now;
        let t = (now - segStart) / durs[seg];
        while (t >= 1) {
          arrive(seg + 1, now);
          segStart += durs[seg];
          seg++;
          if (seg >= durs.length) { finish(); return; }
          t = (now - segStart) / durs[seg];
        }
        const a = point(seg), b = point(seg + 1);
        const hop = seg === 0 ? 0 : geo.rowH * 0.35;
        chip = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t * t - hop * Math.sin(Math.PI * t) };
        draw(now);
        requestAnimationFrame(frame);
      }

      function finish() {
        chip = { x: xs[R], rest: true };
        litBin = binIdx;
        busy = false;
        app.lock(false);
        dropBtn.disabled = !playable();
        draw();
        setTimeout(draw, FLASH_MS + 20);   // clear the last peg flash
        const won = bins[binIdx];
        viewerInput.value = '';
        app.result({ game: 'plinko', item: won.item, color: won.color, slot: slot + 1, viewer });
      }
      requestAnimationFrame(frame);
    }

    // Typing digits picks a slot; it drops once no further digit could make a valid slot.
    let digits = '', digitTimer = 0;
    function typeDigit(d) {
      if (busy) return;
      clearTimeout(digitTimer);
      digits = (digits + d).replace(/^0+/, '');
      if (!digits) return;
      slotInput.value = digits;
      draw();
      const n = parseInt(digits, 10);
      const fire = () => { const s = parseInt(digits, 10) - 1; digits = ''; drop(s); };
      if (n * 10 > bins.length) fire();
      else digitTimer = setTimeout(fire, 800);
    }

    // ---------- Input ----------
    function slotAt(e) {
      if (!geo || !playable()) return -1;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (Math.abs(y - geo.slotY) > geo.u * 0.55) return -1;
      const i = Math.floor((x - geo.left) / geo.u);
      return i >= 0 && i < geo.B ? i : -1;
    }
    canvas.addEventListener('mousemove', (e) => {
      const i = busy ? -1 : slotAt(e);
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
      if (i !== hover) { hover = i; draw(); }
    });
    canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; draw(); } });
    canvas.addEventListener('click', (e) => { const i = slotAt(e); if (i >= 0) drop(i); });
    U.$('dropForm').addEventListener('submit', (e) => { e.preventDefault(); drop(parseInt(slotInput.value, 10) - 1); });
    slotInput.addEventListener('input', () => draw());
    new ResizeObserver(redraw).observe(canvas);

    return {
      rebuild, draw: redraw, typeDigit,
      start: () => drop(parseInt(slotInput.value, 10) - 1),
      busy: () => busy,
      colorOf: (id) => bins.find((b) => b.item.id === id)?.color,
      MAX_BINS,
    };
  };
})();
