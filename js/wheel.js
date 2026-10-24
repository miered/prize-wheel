/* Spinning wheel. The winner is drawn first with the crypto RNG; the animation then lands on it. */
(() => {
  'use strict';
  const PW = window.PW;
  const U = PW.util;
  const TAU = Math.PI * 2;

  // app: { state, sound, colors(), logo(spot), lock(on), closeDialog(), result(r) }
  PW.createWheel = (app) => {
    const canvas = U.$('wheel'), ctx = canvas.getContext('2d');
    const pointer = U.$('pointer'), hint = U.$('spinHint');
    let segments = [];     // [{ item, name, suffix, start, end, color }]
    let rotation = 0;      // radians
    let spinning = false;

    function rebuild() {
      const units = U.buildUnits(app.state.wheelItems);
      const n = units.length, colors = app.colors();
      segments = units.map((item, i) => ({
        item, name: item.name, suffix: U.suffixFor(item),
        start: i / n * TAU, end: (i + 1) / n * TAU, color: U.colorAt(colors, i, n),
      }));
      hint.style.visibility = n ? 'visible' : 'hidden';
      draw();
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const size = Math.round(Math.min(rect.width, rect.height) * (window.devicePixelRatio || 1));
      if (!size) return;
      if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
      draw();
    }

    function draw() {
      const S = canvas.width;
      if (!S) return;
      const c = S / 2;
      const R = c - S * 0.01;
      const hubR = R * 0.15;
      const surface = U.cssVar('--surface') || '#fff';
      const border = U.cssVar('--border') || '#ddd';
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.translate(c, c);

      if (!segments.length) {
        ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = U.cssVar('--surface-2'); ctx.fill();
        ctx.lineWidth = S * 0.006; ctx.strokeStyle = border; ctx.stroke();
        ctx.fillStyle = U.cssVar('--muted'); ctx.font = `600 ${R * 0.08}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Add some entries →', 0, 0);
        ctx.restore();
        return;
      }

      const base = -Math.PI / 2 + rotation;
      const n = segments.length;
      for (const seg of segments) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, base + seg.start, base + seg.end);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();
        if (n <= 150) { ctx.lineWidth = Math.max(1, S * 0.002); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke(); }
      }

      // Labels
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const seg of segments) {
        const sweep = seg.end - seg.start;
        const name = app.state.mystery ? '?' : seg.name;
        const suffix = app.state.mystery ? '' : seg.suffix;
        const maxW = R * 0.95 - hubR * 1.25 - R * 0.06;
        const fs = Math.min(R * 0.11, R * 0.7 * sweep * 0.8);
        if (fs < S * 0.008) continue;
        ctx.save();
        ctx.rotate(base + seg.start + sweep / 2);
        ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillStyle = U.textOn(seg.color);
        ctx.fillText(U.fitText(ctx, name, maxW - ctx.measureText(suffix).width) + suffix, R * 0.92, 0);
        ctx.restore();
      }

      // Rim
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
      ctx.lineWidth = S * 0.012; ctx.strokeStyle = surface; ctx.stroke();
      ctx.lineWidth = S * 0.003; ctx.strokeStyle = border;
      ctx.beginPath(); ctx.arc(0, 0, R + S * 0.004, 0, TAU); ctx.stroke();

      // Hub
      ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = S * 0.02;
      ctx.beginPath(); ctx.arc(0, 0, hubR, 0, TAU); ctx.fillStyle = surface; ctx.fill();
      ctx.shadowBlur = 0;
      const logo = app.logo('wheelCenter');
      if (U.imageReady(logo)) {
        U.drawCircleImage(ctx, logo, 0, 0, hubR * 0.9);
      } else {
        ctx.fillStyle = U.cssVar('--accent');
        ctx.font = `800 ${hubR * 0.42}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('SPIN', 0, hubR * 0.03);
      }
      ctx.restore();
    }

    const norm = (a) => ((a % TAU) + TAU) % TAU;
    function segmentAtPointer(rot) {
      const p = norm(-rot);
      return segments.findIndex((s) => p >= s.start && p < s.end);
    }

    function spin() {
      if (spinning || !segments.length) return;
      app.closeDialog();
      app.sound.unlock();
      spinning = true;
      app.lock(true);

      // Every slice is the same size, so each one is an equal draw.
      const seg = segments[Math.floor(U.rand() * segments.length)];
      const target = seg.start + (0.12 + 0.76 * U.rand()) * (seg.end - seg.start);
      const dur = app.state.duration * 1000;
      const turns = Math.max(3, Math.round(app.state.duration * 1.1));
      const from = rotation;
      const delta = norm(-target - from) + turns * TAU;
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      let last = segmentAtPointer(from);
      let t0 = null;

      function frame(now) {
        if (t0 === null) t0 = now;
        const t = Math.min(1, (now - t0) / dur);
        rotation = from + delta * ease(t);
        draw();
        const cur = segmentAtPointer(rotation);
        if (cur !== last) {
          last = cur;
          app.sound.tick();
          pointer.classList.add('tick');
          requestAnimationFrame(() => pointer.classList.remove('tick'));
        }
        if (t < 1) { requestAnimationFrame(frame); return; }
        rotation = norm(rotation);
        spinning = false;
        app.lock(false);
        const won = segments[segmentAtPointer(rotation)];
        if (won) app.result({ game: 'wheel', item: won.item, color: won.color });
      }
      requestAnimationFrame(frame);
    }

    canvas.addEventListener('click', spin);
    canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); spin(); } });
    new ResizeObserver(resize).observe(canvas);

    return {
      rebuild, draw, start: spin,
      busy: () => spinning,
      colorOf: (id) => segments.find((s) => s.item.id === id)?.color,
    };
  };
})();
