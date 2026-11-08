/* Plinko: numbered drop slots on top, a tall field of pegs that scrolls as the chip falls,
   and prize bins pinned to the bottom. Every normal peg is a fair left/right coin flip from
   the crypto RNG. Glowing twist pegs (see TWISTS) shake up the drop. One slot sits above each bin.

   A drop is fully simulated up front (every coin flip and twist), producing timed keyframes
   for each chip plus a list of board events. The animation then just plays that back. */
(() => {
  'use strict';
  const PW = window.PW;
  const U = PW.util;
  const TAU = Math.PI * 2;
  const MAX_BINS = 24;                                   // the most that still read well on a 1366×768 laptop
  const ROWS = 28;                                       // even, so a chip starting above a bin ends in a bin
  const SPEEDS = { slow: 260, normal: 185, fast: 110 };  // ms per peg row
  const FLASH_MS = 220;
  const MAX_TWISTS_PER_DROP = 3;
  const SLOWMO_RATE = 0.4;
  const HOLD_MS = 2600;                                  // after landing, before the board resets
  const FIRST_TWIST_ROW = 2, LAST_TWIST_ROW = ROWS - 4;

  const TWISTS = {
    shuffle: { icon: '🔀', label: 'Shuffle', color: '#0090FF', group: 'Prize twists', desc: 'All prizes reshuffle for this drop' },
    swap: { icon: '🔁', label: 'Swap', color: '#12A594', group: 'Prize twists', desc: 'Two prizes trade bins' },
    bomb: { icon: '💣', label: 'Bomb', color: '#E5484D', group: 'Prize twists', desc: 'A bin is blown out; chips roll to a neighbor' },
    mystery: { icon: '❓', label: 'Mystery', color: '#6E56CF', group: 'Prize twists', desc: 'Prize labels hide until landing' },
    bumper: { icon: '🚀', label: 'Bumper', color: '#F76B15', group: 'Chip twists', desc: 'Launches the chip back up 3 rows' },
    portal: { icon: '🌀', label: 'Portal', color: '#8E4EC6', group: 'Chip twists', desc: 'Warps the chip to a random column' },
    gust: { icon: '💨', label: 'Gust', color: '#3E63DD', group: 'Chip twists', desc: 'Wind pushes the chip 1–2 columns' },
    split: { icon: '✂️', label: 'Split', color: '#D6409F', group: 'Chip twists', desc: 'Chip splits in two; both prizes are won' },
    double: { icon: '×2', label: 'Double', color: '#30A46C', group: 'Reward twists', desc: 'Win 2 of the prize you land on' },
    golden: { icon: '⭐', label: 'Golden', color: '#FFB224', group: 'Reward twists', desc: 'Also wins the Golden bonus' },
    slowmo: { icon: '🐢', label: 'Slow-mo', color: '#46A758', group: 'Reward twists', desc: 'Rest of the drop in slow motion' },
    redrop: { icon: '↩️', label: 'Re-drop', color: '#AB4ABA', group: 'Reward twists', desc: 'Chip jumps back to a random top slot' },
  };
  PW.TWISTS = TWISTS;

  // Peg columns in a row: even rows sit above bins, odd rows sit between them.
  const pegXs = (r, B) => {
    const xs = [];
    if (r % 2 === 0) for (let x = 0; x < B; x++) xs.push(x);
    else for (let x = 0.5; x < B - 1; x++) xs.push(x);
    return xs;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // app: { state, sound, colors(), logo(spot), headerInfo(), lock(on), closeDialog(), result(r) }
  PW.createPlinko = (app) => {
    const canvas = U.$('plinko'), ctx = canvas.getContext('2d');
    const slotInput = U.$('slotInput'), viewerInput = U.$('viewerInput'), dropBtn = U.$('dropBtn');
    const banner = U.$('twistBanner');

    let bins = [];          // [{ item, color, suffix }] in list order
    let sig = '';           // bin layout signature; the board resets when it changes
    let geo = null;         // layout in CSS pixels
    let camY = 0, camGoal = 0;   // how far the peg field is scrolled
    let hover = -1;         // slot under the mouse

    // Board state for the current drop; resetBoard() puts it back
    let order = [];         // order[pos] = which bin's prize sits at that position
    let disp = [];          // disp[bin] = drawn position, animated during shuffles
    let tween = null;
    let bombed = new Set(); // positions blown out
    let mystery = false;
    let lit = new Set();    // positions that won
    let resting = [];       // [{ pos, golden }] chips settled in bins
    const twistPegs = new Map();   // "row:x" -> { type, used }
    let exhausted = false;  // max twists reached this drop
    const flashes = new Map();     // "row:x" -> time the peg was hit
    let play = null;        // the drop being animated
    let resetTimer = 0;
    let raf = 0, lastFrame = 0;

    const playable = () => bins.length > 0 && bins.length <= MAX_BINS;

    // ---------- Board state ----------
    function rollTwists() {
      twistPegs.clear();
      exhausted = false;
      const B = bins.length;
      if (B < 2 || !playable()) return;
      const s = app.state;
      const types = Object.keys(TWISTS).filter((k) => s.twistOn[k] !== false
        && !(k === 'bomb' && B < 3)
        && !(k === 'golden' && !(s.goldenQty > 0 && s.goldenName.trim())));
      if (!types.length) return;
      const spots = [];
      for (let r = FIRST_TWIST_ROW; r <= LAST_TWIST_ROW; r++) for (const x of pegXs(r, B)) spots.push(`${r}:${x}`);
      const n = Math.min(s.twistCount, spots.length);
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(U.rand() * (spots.length - i));
        [spots[i], spots[j]] = [spots[j], spots[i]];
        twistPegs.set(spots[i], { type: types[Math.floor(U.rand() * types.length)], used: false });
      }
    }

    function resetBoard() {
      clearTimeout(resetTimer);
      order = bins.map((_, i) => i);
      disp = order.slice();
      tween = null;
      bombed = new Set();
      mystery = false;
      lit = new Set();
      resting = [];
      rollTwists();
      camGoal = 0;
      kick();
    }

    function setOrder(next) {
      const to = [];
      next.forEach((bin, pos) => { to[bin] = pos; });
      tween = { from: disp.slice(), to, t0: performance.now() };
      order = next;
    }

    function rebuild() {
      const units = U.buildUnits(app.state.items, 'plinko');
      const colors = app.colors();
      bins = units.map((item, i) => ({ item, color: U.colorAt(colors, i, units.length), suffix: U.suffixFor(item, 'plinko') }));
      const next = units.map((it) => it.id).join(',');
      if (!play && (next !== sig || order.length !== bins.length)) { sig = next; resetBoard(); }
      slotInput.max = Math.max(1, bins.length);
      slotInput.placeholder = bins.length ? `1–${bins.length}` : '–';
      dropBtn.disabled = !!play || !playable();
      redraw();
    }

    // ---------- Layout ----------
    // The peg field is a tall strip ("world" coordinates, 0 = its top) seen through a window
    // between the header and the pinned bins. camY is how far that window has scrolled down.
    function layout() {
      const rect = canvas.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      if (!W || !H) { geo = null; return; }
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      }
      const B = clamp(bins.length, 1, MAX_BINS);
      const header = app.headerInfo();
      const pad = 14, railW = 14;
      const headH = header ? 46 : 0;
      const top0 = pad + headH;
      // Sized by width, but always leave room for the bins plus a few rows of pegs
      const u = Math.max(6, Math.min(96, (W - pad * 2 - railW * 2) / (B + 0.7), (H - top0 - pad) / 9));
      const binH = u * 2.2;
      const binTop = H - pad - binH;
      const rowH = u * 0.82;
      const F = u * 1.6 + (ROWS - 1) * rowH + u * 0.7;   // field height: slots, pegs, gap above the bins
      const V = binTop - top0;                            // visible height of the field
      geo = {
        W, H, dpr, B, u, header, headH, pad, top0, rowH, F, V, binH, binTop,
        offset: Math.max(0, V - F), camMax: Math.max(0, F - V),
        left: (W - u * B) / 2, pegR: Math.max(2, u * 0.085), chipR: u * 0.3,
      };
      camY = clamp(camY, 0, geo.camMax);
      camGoal = clamp(camGoal, 0, geo.camMax);
    }
    const colX = (x) => geo.left + (x + 0.5) * geo.u;
    const sy = (wy) => geo.top0 + geo.offset + wy - camY;     // world y → screen y
    const slotWY = () => geo.u * 0.5;
    const pegWY = (r) => geo.u * 1.6 + r * geo.rowH;
    const contactWY = (r) => pegWY(r) - geo.pegR - geo.chipR; // chip resting on top of a peg
    const restSY = () => geo.binTop + geo.chipR + geo.u * 0.12; // chip settled in a bin (screen)

    // ---------- Drawing ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    }

    function draw(now = performance.now()) {
      if (!geo) return;
      const { W, H, dpr, B, u } = geo;
      const c = {
        accent: U.cssVar('--accent'), text: U.cssVar('--text'), muted: U.cssVar('--muted'),
        surface: U.cssVar('--surface'), surface2: U.cssVar('--surface-2'), border: U.cssVar('--border'),
      };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (!playable()) {
        drawHeader(c);
        ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '600 18px system-ui, sans-serif';
        const msg = bins.length
          ? [`${bins.length} bins is more than this board fits (max ${MAX_BINS}).`, 'Untick some entries for Plinko, use “One bin with a count”,', 'or merge duplicates.']
          : ['Add some prizes →'];
        msg.forEach((m, i) => ctx.fillText(m, W / 2, H / 2 + (i - (msg.length - 1) / 2) * 28));
        return;
      }

      // Board panel behind everything
      const panelX = geo.left - u * 0.35, panelW = u * B + u * 0.7;
      roundRect(panelX, geo.top0 - u * 0.15, panelW, H - geo.pad * 0.5 - (geo.top0 - u * 0.15), u * 0.35);
      ctx.fillStyle = c.surface2; ctx.fill();

      // Scrolling field, clipped between the header and the bins
      ctx.save();
      ctx.beginPath(); ctx.rect(0, geo.top0 - u * 0.15, W, geo.binTop - geo.top0 + u * 0.15); ctx.clip();
      drawSlots(c);
      drawPegs(c, now);
      ctx.restore();

      drawBins(c);

      // Chips can fall into the bins, so they're clipped below the header only
      ctx.save();
      ctx.beginPath(); ctx.rect(0, geo.top0 - u * 0.15, W, H); ctx.clip();
      for (const r of resting) drawChip(colX(r.pos), restSY(), 1, r.golden, c.accent);
      if (play) for (const ch of play.chips) if (ch.view) drawChip(ch.view.x, ch.view.y, ch.view.alpha, ch.view.golden, c.accent);
      ctx.restore();

      drawRail(c);
      drawHeader(c);
    }

    function drawHeader(c) {
      if (!geo.header) return;
      const { img, text: label } = geo.header;
      const hy = geo.pad + geo.headH / 2 - 4;
      ctx.font = '700 20px system-ui, -apple-system, "Segoe UI", sans-serif';
      const name = U.fitText(ctx, label || '', geo.W - 120);
      const r = 17;
      const hasImg = U.imageReady(img);
      const w = ctx.measureText(name).width + (hasImg ? r * 2 + 10 : 0);
      let x = (geo.W - w) / 2;
      if (hasImg) {
        U.drawCircleImage(ctx, img, x + r, hy, r);
        ctx.lineWidth = 2; ctx.strokeStyle = c.accent;
        ctx.beginPath(); ctx.arc(x + r, hy, r, 0, TAU); ctx.stroke();
        x += r * 2 + 10;
      }
      ctx.fillStyle = document.body.classList.contains('green') ? '#0b3d0b' : c.text;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(name, x, hy);
    }

    function drawSlots(c) {
      const { B, u } = geo;
      const y = sy(slotWY());
      if (y < geo.top0 - u) return;
      const picked = parseInt(slotInput.value, 10) - 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < B; i++) {
        const on = i === hover || (i === picked && !play);
        ctx.beginPath(); ctx.arc(colX(i), y, u * 0.38, 0, TAU);
        ctx.fillStyle = on ? c.accent : c.surface; ctx.fill();
        ctx.lineWidth = Math.max(1, u * 0.03); ctx.strokeStyle = on ? c.accent : c.border; ctx.stroke();
        ctx.fillStyle = on ? U.cssVar('--accent-text') : c.text;
        ctx.font = `800 ${Math.max(9, u * (i + 1 >= 10 ? 0.34 : 0.4))}px system-ui, sans-serif`;
        ctx.fillText(String(i + 1), colX(i), y + 1);
      }
    }

    function drawPegs(c, now) {
      const { B, u } = geo;
      for (let r = 0; r < ROWS; r++) {
        const y = sy(pegWY(r));
        if (y < geo.top0 - u || y > geo.binTop + u) continue;
        for (const x of pegXs(r, B)) {
          const id = `${r}:${x}`;
          const tw = twistPegs.get(id);
          const hit = flashes.get(id);
          const age = hit === undefined ? Infinity : now - hit;
          const lit = age < FLASH_MS;
          if (tw) {
            const t = TWISTS[tw.type];
            const dim = tw.used || exhausted;
            const R = Math.max(geo.pegR * 2.6, u * 0.27) * (lit ? 1.25 : 1);
            ctx.save();
            ctx.globalAlpha = dim ? 0.28 : 1;
            if (!dim) { ctx.shadowColor = t.color; ctx.shadowBlur = u * 0.35; }
            ctx.beginPath(); ctx.arc(colX(x), y, R, 0, TAU);
            ctx.fillStyle = t.color; ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = Math.max(1.5, u * 0.035); ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `800 ${R * (/\p{Extended_Pictographic}/u.test(t.icon) ? 1.25 : 1.0)}px system-ui, "Segoe UI Emoji", sans-serif`;
            ctx.fillText(t.icon, colX(x), y + R * 0.05);
            ctx.restore();
            continue;
          }
          ctx.beginPath(); ctx.arc(colX(x), y, geo.pegR * (lit ? 1.7 - 0.7 * age / FLASH_MS : 1), 0, TAU);
          ctx.fillStyle = lit ? c.accent : c.muted; ctx.fill();
        }
      }
    }

    function drawBins(c) {
      const { B, u } = geo;
      const gap = Math.max(1.5, u * 0.05);
      for (let bi = 0; bi < B; bi++) {
        const b = bins[bi];
        const pos = disp[bi] ?? bi;
        const x = geo.left + pos * u + gap, w = u - gap * 2;
        roundRect(x, geo.binTop, w, geo.binH, Math.min(8, u * 0.12));
        ctx.fillStyle = b.color; ctx.fill();
        drawBinLabel(b, x + w / 2, w, resting.some((r) => r.pos === Math.round(pos)));
      }
      for (const pos of bombed) {
        const x = geo.left + pos * u + gap, w = u - gap * 2;
        roundRect(x, geo.binTop, w, geo.binH, Math.min(8, u * 0.12));
        ctx.fillStyle = 'rgba(20,20,24,.82)'; ctx.fill();
        ctx.font = `${Math.min(w * 0.7, 30)}px "Segoe UI Emoji", system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💥', x + w / 2, geo.binTop + geo.binH * 0.5);
      }
      for (const pos of lit) {
        const x = geo.left + pos * u + gap, w = u - gap * 2;
        roundRect(x, geo.binTop, w, geo.binH, Math.min(8, u * 0.12));
        ctx.save();
        ctx.lineWidth = Math.max(3, u * 0.08); ctx.strokeStyle = c.accent;
        ctx.shadowColor = c.accent; ctx.shadowBlur = u * 0.4;
        ctx.stroke();
        ctx.restore();
      }
      // Dividers rise slightly above the bins
      ctx.fillStyle = c.border;
      for (let i = 0; i <= B; i++) ctx.fillRect(geo.left + i * u - gap / 2, geo.binTop - u * 0.3, gap, u * 0.3);
    }

    function drawBinLabel(b, cx, w, hasChip) {
      const u = geo.u;
      ctx.fillStyle = U.textOn(b.color);
      if (mystery) {
        ctx.font = `800 ${Math.min(w * 0.7, 34)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, geo.binTop + geo.binH * 0.6);
        return;
      }
      const label = b.item.name + b.suffix;
      let fs = Math.max(9, Math.min(17, u * 0.24));
      ctx.font = `650 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      // Fits across the bin → horizontal; otherwise read bottom-to-top
      if (ctx.measureText(label).width <= w - 8) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, geo.binTop + geo.binH * 0.62);
        return;
      }
      fs = Math.max(9, Math.min(17, w * 0.5));
      ctx.font = `650 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.save();
      ctx.translate(cx, geo.binTop + geo.binH - 8);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const room = geo.binH - 16 - (hasChip ? geo.chipR * 2 : 0);   // leave space for a chip resting at the top
      ctx.fillText(U.fitText(ctx, b.item.name, room - ctx.measureText(b.suffix).width) + b.suffix, 0, 0);
      ctx.restore();
    }

    function drawChip(x, y, alpha, golden, accent) {
      const r = geo.chipR;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = golden ? '#ffcc33' : 'rgba(0,0,0,.35)';
      ctx.shadowBlur = golden ? r * 1.2 : r * 0.6; ctx.shadowOffsetY = golden ? 0 : r * 0.15;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const logo = app.logo('plinkoChip');
      const ring = golden ? '#f5b400' : accent;
      if (U.imageReady(logo)) {
        U.drawCircleImage(ctx, logo, x, y, r - 2);
      } else {
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, golden ? '#ffd84d' : accent); g.addColorStop(1, golden ? '#e09a00' : accent);
        ctx.beginPath(); ctx.arc(x, y, r - 2, 0, TAU); ctx.fillStyle = g; ctx.fill();
      }
      ctx.lineWidth = Math.max(2, r * (golden ? 0.22 : 0.14)); ctx.strokeStyle = ring;
      ctx.beginPath(); ctx.arc(x, y, r - 1, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // Slim scrollbar showing where the view is, plus a marker for each falling chip
    function drawRail(c) {
      if (geo.camMax <= 0) return;
      const x = Math.min(geo.W - 8, geo.left + geo.B * geo.u + geo.u * 0.35 + 8);
      const top = geo.top0, h = geo.binTop - geo.top0;
      roundRect(x - 2, top, 4, h, 2); ctx.fillStyle = c.border; ctx.fill();
      const thumbH = Math.max(24, h * geo.V / geo.F);
      const ty = top + (h - thumbH) * (camY / geo.camMax);
      roundRect(x - 2, ty, 4, thumbH, 2); ctx.fillStyle = c.muted; ctx.fill();
      // Mini-map: where the twist pegs are, so viewers can see what's coming further down
      for (const [id, tw] of twistPegs) {
        if (tw.used || exhausted) continue;
        const f = clamp(pegWY(+id.split(':')[0]) / geo.F, 0, 1);
        ctx.beginPath(); ctx.arc(x, top + h * f, 3.5, 0, TAU);
        ctx.fillStyle = TWISTS[tw.type].color; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      if (play) {
        for (const ch of play.chips) {
          if (!ch.view) continue;
          const f = clamp(ch.view.world / geo.F, 0, 1);
          ctx.beginPath(); ctx.arc(x, top + h * f, 5, 0, TAU);
          ctx.fillStyle = ch.view.golden ? '#f5b400' : c.accent; ctx.fill();
        }
      }
    }

    function redraw() { layout(); draw(); }

    // ---------- Animation loop ----------
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    function loop(now) {
      raf = 0;
      const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
      lastFrame = now;
      if (!geo) layout();
      let more = false;
      if (play) { stepPlay(now); more = !!play || more; }
      if (geo && Math.abs(camGoal - camY) > 0.5) {
        camY += (camGoal - camY) * (1 - Math.exp(-dt / (play ? 90 : 160)));
        more = true;
      } else camY = camGoal;
      if (tween) {
        const t = Math.min(1, (now - tween.t0) / 450);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        disp = tween.from.map((f, i) => f + (tween.to[i] - f) * e);
        if (t >= 1) tween = null;
        more = true;
      }
      for (const t of flashes.values()) if (now - t < FLASH_MS) { more = true; break; }
      draw(now);
      if (more) kick(); else lastFrame = 0;
    }

    // ---------- Simulating a drop ----------
    function simulate(slot) {
      const B = bins.length;
      const T = SPEEDS[app.state.dropSpeed] || SPEEDS.normal;
      const valid = (x) => x >= 0 && x <= B - 1;
      const events = [], landings = [], chips = [];
      const flags = { double: false, golden: false };
      let ord = order.slice();
      const bomb = new Set(), used = new Set();
      let fired = 0, slowAt = null;

      const ev = (t, type, data = {}) => events.push({ t, type, ...data });
      const newChip = (x, r, t, at) => {
        const ch = { id: chips.length, x, r, t, keys: [{ t, x, r, at, motion: null }], done: false, goldenAt: null };
        chips.push(ch);
        return ch;
      };
      const key = (ch, at, motion) => ch.keys.push({ t: ch.t, x: ch.x, r: ch.r, at, motion });

      // Moves the chip down to the next row's peg, or into a bin after the last row
      function next(ch, nx, motion = 'bounce') {
        ch.x = nx;
        if (ch.r + 1 >= ROWS) { ch.t += T * 1.5; key(ch, 'land', motion); land(ch); return; }
        ch.r += 1; ch.t += T; key(ch, 'peg', motion);
      }
      // A fair coin flip; the side walls push a chip at the edge back inward
      function bounce(ch) {
        const opts = [ch.x - 0.5, ch.x + 0.5].filter(valid);
        next(ch, opts.length === 2 ? opts[U.rand() < 0.5 ? 0 : 1] : opts.length ? opts[0] : ch.x);
      }
      function land(ch) {
        ch.done = true;
        let pos = Math.round(ch.x);
        if (bomb.has(pos)) {
          // A blown-out bin tips the chip into the nearest working neighbor
          for (let d = 1; d < B; d++) {
            const opts = [pos - d, pos + d].filter((p) => p >= 0 && p < B && !bomb.has(p));
            if (opts.length) { pos = opts.length === 2 ? opts[U.rand() < 0.5 ? 0 : 1] : opts[0]; break; }
          }
          ch.x = pos; ch.t += T; key(ch, 'land', 'slide');
        }
        ev(ch.t, 'land', { pos });
        landings.push({ pos, bin: ord[pos], golden: ch.goldenAt !== null });
      }
      // The chip is touching peg (ch.r, ch.x) at time ch.t
      function arrive(ch) {
        const id = `${ch.r}:${ch.x}`;
        ev(ch.t, 'hit', { key: id });
        const tw = twistPegs.get(id);
        if (tw && !used.has(id) && fired < MAX_TWISTS_PER_DROP) {
          used.add(id);
          fired++;
          ev(ch.t, 'twist', { key: id, twist: tw.type });
          if (fired === MAX_TWISTS_PER_DROP) ev(ch.t, 'exhausted');
          twist(ch, tw.type);
          return;
        }
        bounce(ch);
      }
      function twist(ch, type) {
        const t = ch.t;
        switch (type) {
          case 'shuffle': {
            const before = ord.join();
            for (let tries = 0; tries < 6 && ord.join() === before; tries++) {
              ord = ord.slice();
              for (let i = ord.length - 1; i > 0; i--) { const j = Math.floor(U.rand() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
            }
            ev(t, 'order', { order: ord.slice() });
            return bounce(ch);
          }
          case 'swap': {
            const i = Math.floor(U.rand() * B);
            let j = Math.floor(U.rand() * (B - 1));
            if (j >= i) j++;
            ord = ord.slice();
            [ord[i], ord[j]] = [ord[j], ord[i]];
            ev(t, 'order', { order: ord.slice() });
            return bounce(ch);
          }
          case 'bomb': {
            const open = [];
            for (let p = 0; p < B; p++) if (!bomb.has(p)) open.push(p);
            if (open.length > 1) { const p = open[Math.floor(U.rand() * open.length)]; bomb.add(p); ev(t, 'bomb', { pos: p }); }
            return bounce(ch);
          }
          case 'mystery': ev(t, 'mystery'); return bounce(ch);
          case 'double': flags.double = true; return bounce(ch);
          case 'golden': flags.golden = true; ch.goldenAt = t; return bounce(ch);
          case 'slowmo': if (slowAt === null) slowAt = t; return bounce(ch);
          case 'bumper': {
            const r2 = Math.max(0, ch.r - 3);
            // Odd rows sit between bins, so shift half a column when the row parity changes
            if ((r2 % 2 === 0) !== Number.isInteger(ch.x)) {
              const opts = [ch.x - 0.5, ch.x + 0.5].filter(valid);
              ch.x = opts[U.rand() < 0.5 ? 0 : opts.length - 1];
            }
            ch.r = r2; ch.t += T * 2.2; key(ch, 'peg', 'launch');
            return;   // arrives at that peg next
          }
          case 'portal': {
            const xs = pegXs(ch.r, B).filter((x) => x !== ch.x);
            if (!xs.length) return bounce(ch);
            ch.x = xs[Math.floor(U.rand() * xs.length)]; ch.t += T * 0.9; key(ch, 'peg', 'warp');
            return;
          }
          case 'gust': {
            const xs = pegXs(ch.r, B);
            const dir = U.rand() < 0.5 ? -1 : 1, k = U.rand() < 0.5 ? 1 : 2;
            const push = (d) => clamp(ch.x + d * k, xs[0], xs[xs.length - 1]);
            let nx = push(dir);
            if (nx === ch.x) nx = push(-dir);
            if (nx === ch.x) return bounce(ch);
            ch.x = nx; ch.t += T * 1.4; key(ch, 'peg', 'slide');
            return;
          }
          case 'split': {
            const opts = [ch.x - 0.5, ch.x + 0.5].filter(valid);
            const twin = newChip(ch.x, ch.r, t, 'peg');
            twin.goldenAt = ch.goldenAt;
            next(ch, opts[0] ?? ch.x);
            next(twin, opts[opts.length - 1] ?? ch.x);
            return;
          }
          case 'redrop': {
            ch.x = Math.floor(U.rand() * B); ch.r = -1; ch.t += T * 0.9; key(ch, 'slot', 'warp');
            ch.r = 0; ch.t += T * 1.3; key(ch, 'peg', 'fall');
            return;
          }
          default: bounce(ch);
        }
      }

      const first = newChip(slot, -1, 0, 'slot');
      first.r = 0; first.t = T * 1.3; key(first, 'peg', 'fall');
      // Advance whichever chip is earliest, so twists apply in the order viewers see them
      for (let guard = 0; guard < 10000; guard++) {
        let ch = null;
        for (const c of chips) if (!c.done && (!ch || c.t < ch.t)) ch = c;
        if (!ch) break;
        arrive(ch);
      }
      events.forEach((e, i) => { e.i = i; });
      events.sort((a, b) => a.t - b.t || a.i - b.i);
      const end = Math.max(...chips.map((c) => c.keys[c.keys.length - 1].t));
      return { chips, events, landings, flags, slowAt, end };
    }

    // ---------- Playing a drop back ----------
    function keyPos(k) {
      if (k.at === 'slot') return { x: colX(k.x), y: sy(slotWY()), world: slotWY() };
      if (k.at === 'peg') return { x: colX(k.x), y: sy(contactWY(k.r)), world: contactWY(k.r) };
      return { x: colX(k.x), y: restSY(), world: geo.F };
    }

    function chipAt(ch, s) {
      const keys = ch.keys;
      if (s < keys[0].t) return null;
      let i = 0;
      while (i < keys.length - 1 && keys[i + 1].t <= s) i++;
      const golden = ch.goldenAt !== null && s >= ch.goldenAt;
      const a = keyPos(keys[i]);
      if (i === keys.length - 1) return { ...a, alpha: 1, golden };
      const bk = keys[i + 1], b = keyPos(bk);
      const t = clamp((s - keys[i].t) / (bk.t - keys[i].t), 0, 1);
      const lerp = (p, q, f) => p + (q - p) * f;
      const hop = geo.rowH * 0.35;
      let x = lerp(a.x, b.x, t), y, alpha = 1;
      switch (bk.motion) {
        case 'fall': y = lerp(a.y, b.y, t * t); break;
        case 'launch': y = lerp(a.y, b.y, 1 - (1 - t) ** 2) - geo.rowH * 0.8 * Math.sin(Math.PI * t); break;
        case 'slide': {
          const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          x = lerp(a.x, b.x, e); y = lerp(a.y, b.y, t) - geo.rowH * 0.2 * Math.sin(Math.PI * t);
          break;
        }
        case 'warp':
          // Fade out where it was, fade in where it lands
          if (t < 0.5) { x = a.x; y = a.y; alpha = 1 - t * 2; } else { x = b.x; y = b.y; alpha = t * 2 - 1; }
          break;
        default: y = lerp(a.y, b.y, t * t) - hop * Math.sin(Math.PI * t);
      }
      return { x, y, alpha, golden, world: lerp(a.world, b.world, t) };
    }

    function fire(e, now) {
      switch (e.type) {
        case 'hit':
          if (geo && pegExists(e.key)) { flashes.set(e.key, now); app.sound.tick(0.85 + Math.random() * 0.3); }
          break;
        case 'twist': {
          const tw = twistPegs.get(e.key);
          if (tw) tw.used = true;
          play.fired.push(e.twist);
          showBanner(e.twist);
          app.sound.twist();
          break;
        }
        case 'exhausted': exhausted = true; break;
        case 'order': setOrder(e.order); break;
        case 'bomb': bombed.add(e.pos); app.sound.tick(0.35); break;
        case 'mystery': mystery = true; break;
        case 'land': lit.add(e.pos); app.sound.tick(0.5); break;
      }
    }
    const pegExists = (id) => {
      const [r, x] = id.split(':').map(Number);
      return r >= 0 && pegXs(r, geo.B).includes(x);
    };

    function stepPlay(now) {
      const real = now - play.start;
      const s = play.slowAt === null || real < play.slowAt ? real : play.slowAt + (real - play.slowAt) * SLOWMO_RATE;
      while (play.ei < play.events.length && play.events[play.ei].t <= s) fire(play.events[play.ei++], now);
      // Camera follows the lowest chip, keeping it about a third of the way down the view
      let low = 0;
      for (const ch of play.chips) {
        ch.view = chipAt(ch, s);
        if (ch.view && ch.view.world > low) low = ch.view.world;
      }
      camGoal = clamp(low - geo.V * 0.35, 0, geo.camMax);
      if (s >= play.end) finish();
    }

    function finish() {
      const p = play;
      play = null;
      resting = p.landings.map((l) => ({ pos: l.pos, golden: l.golden }));
      mystery = false;
      app.lock(false);
      dropBtn.disabled = !playable();
      // Combine chips that land on the same prize, never promising more than is in stock
      const prizes = [];
      for (const l of p.landings) {
        const b = bins[l.bin];
        const n = p.flags.double ? 2 : 1;
        const same = prizes.find((x) => x.item === b.item);
        if (same) same.n = Math.min(same.n + n, b.item.qty);
        else prizes.push({ item: b.item, color: b.color, n: Math.min(n, b.item.qty) });
      }
      const viewer = p.viewer;
      viewerInput.value = '';
      kick();
      app.result({ game: 'plinko', prizes, slot: p.slot + 1, viewer, twists: p.fired, golden: p.flags.golden });
      resetTimer = setTimeout(resetBoard, HOLD_MS);
    }

    function showBanner(type) {
      const t = TWISTS[type];
      banner.textContent = `${t.icon === '×2' ? '✖️' : t.icon} ${t.label.toUpperCase()}!`;
      banner.style.setProperty('--tw', t.color);
      banner.classList.remove('show');
      void banner.offsetWidth;   // restart the CSS animation
      banner.classList.add('show');
    }

    function drop(slot) {
      if (play) return;
      if (!playable()) { U.toast(bins.length ? `Too many bins. The max is ${MAX_BINS}.` : 'Add some prizes first'); return; }
      const B = bins.length;
      if (!(slot >= 0 && slot < B)) { U.toast(`Pick a slot from 1 to ${B}`); slotInput.focus(); return; }
      app.closeDialog();
      app.sound.unlock();
      // Dropping again before the last drop's board reset: reset it now (with fresh twist pegs)
      if (resting.length || lit.size || bombed.size || order.some((b, i) => b !== i) || [...twistPegs.values()].some((t) => t.used)) resetBoard();
      clearTimeout(resetTimer);
      hover = -1;
      slotInput.value = slot + 1;
      layout();
      const sim = simulate(slot);
      play = { ...sim, slot, viewer: viewerInput.value.trim().slice(0, 60), start: performance.now(), ei: 0, fired: [] };
      app.lock(true);
      dropBtn.disabled = true;
      kick();
    }

    // Typing digits picks a slot; it drops once no further digit could make a valid slot.
    let digits = '', digitTimer = 0;
    function typeDigit(d) {
      if (play) return;
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
      if (y < geo.top0 || Math.abs(y - sy(slotWY())) > geo.u * 0.55) return -1;
      const i = Math.floor((x - geo.left) / geo.u);
      return i >= 0 && i < geo.B ? i : -1;
    }
    canvas.addEventListener('mousemove', (e) => {
      const i = play ? -1 : slotAt(e);
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
      if (i !== hover) { hover = i; draw(); }
    });
    canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; draw(); } });
    canvas.addEventListener('click', (e) => { const i = slotAt(e); if (i >= 0) drop(i); });
    // Scroll the peg field to look at the twist pegs further down (between drops)
    canvas.addEventListener('wheel', (e) => {
      if (play || !geo || geo.camMax <= 0) return;
      e.preventDefault();
      camY = camGoal = clamp(camY + e.deltaY, 0, geo.camMax);
      draw();
    }, { passive: false });
    U.$('dropForm').addEventListener('submit', (e) => { e.preventDefault(); drop(parseInt(slotInput.value, 10) - 1); });
    slotInput.addEventListener('input', () => draw());
    new ResizeObserver(redraw).observe(canvas);

    return {
      rebuild, draw: redraw, typeDigit,
      start: () => drop(parseInt(slotInput.value, 10) - 1),
      busy: () => !!play,
      colorOf: (id) => bins.find((b) => b.item.id === id)?.color,
      rerollTwists: () => { if (!play) { rollTwists(); draw(); } },
      MAX_BINS,
    };
  };
})();
