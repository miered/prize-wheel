/* Hungry Hippos Royale: every player is a marble in an arena ringed by four hungry creatures.
   The whole round is decided up front by one fair shuffle (crypto RNG): who is eaten, in which
   order, and by which creature. The animation then steers each victim into the creature that
   snaps, so every marble has exactly equal odds. The last marble left wins. */
(() => {
  'use strict';
  const PW = window.PW;
  const U = PW.util;
  const TAU = Math.PI * 2;
  const MAX_PLAYERS = 200;
  const LENGTHS = { short: 45000, normal: 75000, long: 120000 };   // round length, ms
  const APPROACH = 1100;          // ms a victim takes to get pulled into the mouth
  const SNAP = 220;               // ms for the jaws to close
  const FINAL_APPROACH = 2600;    // the last snap builds up slowly
  const EAT_MS = 260;             // a swallowed marble shrinks away
  const BODY_R = 0.16, BODY_OFF = 0.04;   // creature body radius, and how far its centre sits outside the arena (arena units)

  const THEMES = {
    hippos: { icon: '🦛', label: 'Hippos', colors: ['#8E7CC3', '#6FA8DC', '#E06666', '#F6B26B'], names: ['Big Bertha', 'Lazy Larry', 'Hungry Hank', 'Mighty Mo'], tusks: true },
    sharks: { icon: '🦈', label: 'Sharks', colors: ['#5D7B91', '#3D85C6', '#7F8C99', '#2E6E8E'], names: ['Chompy', 'Finn', 'Jaws Jr.', 'Razor'], teeth: true },
    frogs: { icon: '🐸', label: 'Frogs', colors: ['#6AA84F', '#38761D', '#93C47D', '#45818E'], names: ['Ribbit', 'Hopper', 'Croaky', 'Lily'], tongue: true, bigEyes: true },
    monsters: { icon: '👾', label: 'Monsters', colors: ['#C27BA0', '#8E44AD', '#E67E22', '#16A085'], names: ['Gloop', 'Munch', 'Zorg', 'Nomnom'], teeth: true },
  };
  PW.HIPPO_THEMES = THEMES;

  // Creatures sit on the four sides of the arena, facing the centre
  const SIDES = [
    { cx: 0.5, cy: -BODY_OFF, dx: 0, dy: 1 },
    { cx: 1 + BODY_OFF, cy: 0.5, dx: -1, dy: 0 },
    { cx: 0.5, cy: 1 + BODY_OFF, dx: 0, dy: -1 },
    { cx: -BODY_OFF, cy: 0.5, dx: 1, dy: 0 },
  ];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const fmtSecs = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // app: { state, sound, colors(), logo(spot), lock(on), closeDialog(), result(r),
  //        chat: { status(), listen(onMessage, onError), say(text), reconnect() }, savePlayers() }
  PW.createHippos = (app) => {
    const canvas = U.$('hippos'), ctx = canvas.getContext('2d');
    const $ = U.$;
    const entriesBtn = $('hipEntriesBtn'), startBtn = $('hipStartBtn');

    let phase = 'lobby';   // lobby → entry (chat can join) → running → done
    let marbles = [];      // { name, x, y, vx, vy, alive, victim, from, eatenAt, eatenBy }
    let creatures = SIDES.map(() => ({ open: 0, lunge: 0, count: 0 }));
    let plan = null;       // { start, snaps: [{ t, by, victims, approach, begun, done }], end, winner, order }
    let winnerIdx = -1;
    let radius = 0.04;
    let geo = null;
    let raf = 0, lastFrame = 0;
    let entryEnds = 0, entryTimer = 0, stopChat = null;
    let feed = [];
    let pool = [];         // prizes the survivor can win: [{ item, color }]

    const players = () => app.state.hipposPlayers;
    const theme = () => THEMES[app.state.hipposTheme] || THEMES.hippos;
    const creatureName = (i) => app.state.hipposNames?.[app.state.hipposTheme]?.[i]?.trim() || theme().names[i];
    const alive = () => marbles.filter((m) => m.alive).length;
    const command = () => (app.state.hipposCommand || '!join').trim();

    // ---------- Players ----------
    const spawn = (name) => ({
      name, x: 0.25 + 0.5 * Math.random(), y: 0.15 + 0.2 * Math.random(),
      vx: (Math.random() - 0.5) * 0.4, vy: 0.2 + Math.random() * 0.2, alive: true, victim: false, from: null, eatenAt: 0, eatenBy: -1,
    });
    const sizeFor = (n) => clamp(0.11 / Math.sqrt(Math.max(1, n)), 0.013, 0.045);

    function addPlayer(name, id = '', fromChat = false) {
      name = String(name || '').trim().slice(0, 40);
      if (!name || phase === 'running') return false;
      const list = players();
      if (list.length >= MAX_PLAYERS) { if (!fromChat) U.toast(`The arena is full (${MAX_PLAYERS} marbles)`); return false; }
      if (list.some((p) => (id && p.id === id) || p.name.toLowerCase() === name.toLowerCase())) {
        if (!fromChat) U.toast(`${name} is already in`);
        return false;
      }
      list.push(id ? { name, id } : { name });
      if (phase === 'done') resetLobby();
      else { marbles.push(spawn(name)); radius = sizeFor(marbles.length); }
      app.savePlayers();
      renderPlayers();
      kick();
      return true;
    }
    function removePlayer(i) {
      if (phase === 'running') return;
      players().splice(i, 1);
      app.savePlayers();
      resetLobby();
    }
    function clearPlayers() {
      if (phase === 'running' || !players().length) return;
      if (!confirm(`Remove all ${players().length} players?`)) return;
      players().length = 0;
      app.savePlayers();
      resetLobby();
    }

    function renderPlayers() {
      const ul = $('hipPlayers');
      ul.innerHTML = '';
      $('hipCount').textContent = players().length ? `(${players().length})` : '';
      if (!players().length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No players yet. Add names here, or open entries so chat can join.';
        ul.appendChild(li);
      }
      players().forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'player';
        const name = document.createElement('span'); name.textContent = p.name; name.className = 'pname';
        li.appendChild(name);
        if (p.id) { const tag = document.createElement('small'); tag.textContent = 'chat'; li.appendChild(tag); }
        const del = document.createElement('button');
        del.className = 'del'; del.textContent = '×'; del.title = `Remove ${p.name}`; del.dataset.i = i;
        li.appendChild(del);
        ul.appendChild(li);
      });
      updateButtons();
    }

    // Back to an idle arena holding the current players
    function resetLobby() {
      plan = null;
      winnerIdx = -1;
      feed = [];
      creatures = SIDES.map(() => ({ open: 0, lunge: 0, count: 0 }));
      if (phase !== 'entry') phase = 'lobby';
      marbles = players().map((p) => spawn(p.name));
      radius = sizeFor(marbles.length);
      renderPlayers();
      renderHud();
      kick();
    }

    // ---------- Entry window ----------
    function openEntries() {
      if (phase === 'running') return;
      if (phase === 'done') resetLobby();
      const secs = clamp(Math.round(app.state.hipposEntrySecs) || 60, 10, 600);
      phase = 'entry';
      entryEnds = performance.now() + secs * 1000;
      if (app.chat.status() === 'ok') {
        stopChat = app.chat.listen(onChat, onChatError);
        app.chat.say(`🦛 Hungry Hippos! Type ${command()} in chat to join. ${secs} seconds!`);
      }
      clearInterval(entryTimer);
      entryTimer = setInterval(() => {
        if (performance.now() >= entryEnds) closeEntries();
        else updateButtons();
      }, 250);
      updateButtons();
      kick();
    }
    function closeEntries(announce = true) {
      if (phase !== 'entry') return;
      clearInterval(entryTimer);
      const wasListening = !!stopChat;
      stopChat?.();
      stopChat = null;
      phase = 'lobby';
      if (announce && wasListening) {
        const n = players().length;
        app.chat.say(`🦛 Entries closed: ${n} marble${n === 1 ? ' is' : 's are'} in! Good luck!`);
      }
      updateButtons();
      kick();
    }
    function onChat(m) {
      if (phase !== 'entry') return;
      const text = m.text.trim().toLowerCase(), cmd = command().toLowerCase();
      if (text === cmd || text.startsWith(`${cmd} `)) addPlayer(m.name, m.id, true);
    }
    function onChatError(status) {
      stopChat = null;
      U.toast(status === 403
        ? "Twitch didn't allow reading chat. Click “Reconnect Twitch” to grant it."
        : `Couldn't listen to Twitch chat (${status || 'offline'}). You can still add players by hand.`);
      updateButtons();
    }

    // ---------- Planning a round ----------
    function makePlan(N) {
      // One fair shuffle decides everything: order[0] is eaten first, the last one survives
      const order = Array.from({ length: N }, (_, i) => i);
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(U.rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const L = LENGTHS[app.state.hipposLength] || LENGTHS.normal;
      const elim = N - 1;
      // Big rounds eat several marbles per snap early on; the last snap always eats one of the final two
      const maxSnaps = Math.max(2, Math.round((L - 6000) / 2300));
      let sizes;
      if (elim <= maxSnaps) sizes = Array(elim).fill(1);
      else {
        const n = maxSnaps - 1, rest = elim - 1, base = Math.floor(rest / n), extra = rest % n;
        sizes = [...Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)), 1];
      }
      const S = sizes.length;
      // Snaps come faster as the round goes on; the final one gets extra build-up
      const intro = 1600;
      const finalGap = FINAL_APPROACH + 1400;
      const normalGaps = Math.max(0, S - 2);
      const weights = Array.from({ length: normalGaps }, (_, j) => 1.25 - 0.6 * j / Math.max(1, normalGaps - 1));
      const wsum = weights.reduce((a, b) => a + b, 0) || 1;
      const budget = Math.max(normalGaps * 1300, L - intro - APPROACH - (S > 1 ? finalGap : 0));
      const snaps = [];
      let t = intro + APPROACH, k = 0, prev = -1;
      sizes.forEach((size, i) => {
        // Small rounds would otherwise drag, so a gap never exceeds ~3 seconds
        if (i > 0) t += i === S - 1 ? finalGap : clamp(budget * weights[i - 1] / wsum, 1300, 3200);
        let by = Math.floor(U.rand() * (prev < 0 ? 4 : 3));
        if (prev >= 0 && by >= prev) by++;   // never the same creature twice in a row
        prev = by;
        snaps.push({ t, by, victims: order.slice(k, k + size), approach: i === S - 1 && S > 1 ? FINAL_APPROACH : APPROACH, final: i === S - 1 && S > 1 });
        k += size;
      });
      return { order, snaps, end: t + 900, winner: order[N - 1], start: 0 };
    }

    function startRound() {
      if (phase === 'running') return;
      if (players().length < 2) { U.toast('Add at least 2 players'); return; }
      if (phase === 'entry') closeEntries();
      resetLobby();
      app.closeDialog();
      app.sound.unlock();
      // Spread the marbles out before the frenzy starts
      marbles.forEach((m) => { m.x = 0.2 + 0.6 * Math.random(); m.y = 0.2 + 0.6 * Math.random(); });
      plan = makePlan(marbles.length);
      plan.start = performance.now();
      phase = 'running';
      app.lock(true);
      showBanner(`${theme().icon} FEEDING TIME!`, theme().colors[0]);
      updateButtons();
      renderHud();
      kick();
    }

    // ---------- Running the round ----------
    const mouth = (i) => {
      const s = SIDES[i], reach = BODY_R * 0.8 + creatures[i].lunge * 0.09;
      return { x: s.cx + s.dx * reach, y: s.cy + s.dy * reach };
    };

    function advanceRound(now) {
      const t = now - plan.start;
      const open = SIDES.map(() => 0), lunge = SIDES.map(() => 0);
      for (const snap of plan.snaps) {
        const begin = snap.t - snap.approach;
        if (t < begin - 50) break;
        if (!snap.begun && t >= begin) {
          snap.begun = true;
          for (const idx of snap.victims) { const m = marbles[idx]; m.victim = true; m.from = { x: m.x, y: m.y }; }
          if (snap.final) {
            const left = marbles.filter((m) => m.alive).map((m) => m.name);
            showBanner('⚔️ FINAL TWO!', '#E5484D');
            feedPush(`⚔️ Final two: ${left.join(' vs ')}`);
          }
        }
        if (!snap.begun) continue;
        // Jaws: open wide while the victim is pulled in, then SNAP shut
        let o, l;
        if (t < snap.t - SNAP) { const u = clamp((t - begin) / (snap.approach - SNAP), 0, 1); o = ease(Math.min(1, u * 1.5)); l = ease(u); }
        else if (t < snap.t) { o = 1 - (t - (snap.t - SNAP)) / SNAP; l = 1; }
        else { o = 0; l = clamp(1 - (t - snap.t) / 400, 0, 1); }
        open[snap.by] = Math.max(open[snap.by], o);
        lunge[snap.by] = Math.max(lunge[snap.by], l);
        // The others lean in hungrily for the final snap
        if (snap.final && t < snap.t) SIDES.forEach((_, i) => { if (i !== snap.by) { open[i] = Math.max(open[i], 0.45 * o); lunge[i] = Math.max(lunge[i], 0.4 * l); } });
        if (!snap.done && t >= snap.t) {
          snap.done = true;
          const names = [];
          for (const idx of snap.victims) {
            const m = marbles[idx];
            m.alive = false; m.victim = false; m.eatenAt = now; m.eatenBy = snap.by;
            names.push(m.name);
          }
          creatures[snap.by].count += names.length;
          app.sound.chomp();
          const who = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
          feedPush(`${theme().icon} ${creatureName(snap.by)} ate ${who}!`);
          renderHud();
        }
      }
      creatures.forEach((c, i) => { c.open = open[i]; c.lunge = lunge[i]; });
      // Victims slide into the mouth that's about to snap
      for (const snap of plan.snaps) {
        if (!snap.begun || snap.done) continue;
        const mp = mouth(snap.by);
        const u = ease(clamp((t - (snap.t - snap.approach)) / (snap.approach - SNAP * 0.6), 0, 1));
        for (const idx of snap.victims) {
          const m = marbles[idx];
          m.x = m.from.x + (mp.x - m.from.x) * u;
          m.y = m.from.y + (mp.y - m.from.y) * u;
        }
      }
      if (t >= plan.end) finishRound();
    }

    function finishRound() {
      phase = 'done';
      winnerIdx = plan.winner;
      app.lock(false);
      updateButtons();
      const N = marbles.length;
      const name = (i) => marbles[plan.order[i]]?.name;
      const runnersUp = [name(N - 2), name(N - 3)].filter(Boolean);
      let top = 0;
      creatures.forEach((c, i) => { if (c.count > creatures[top].count) top = i; });
      // The survivor wins a random prize (each slice-like unit is one equal chance)
      const prize = pool.length ? pool[Math.floor(U.rand() * pool.length)] : null;
      showBanner(`🏆 ${marbles[winnerIdx].name} SURVIVES!`, '#F5B400');
      setTimeout(() => app.result({
        game: 'hippos', viewer: marbles[winnerIdx].name,
        prizes: prize ? [{ item: prize.item, color: prize.color, n: 1 }] : [],
        entrants: N, runnersUp, hungriest: { name: creatureName(top), count: creatures[top].count },
      }), 900);
    }

    // ---------- Marble motion (looks only; it never decides who wins) ----------
    function physics(dt) {
      const r = radius;
      const live = marbles.filter((m) => m.alive && !m.victim);
      const busyMouths = plan ? plan.snaps.filter((s) => s.begun && !s.done).map((s) => mouth(s.by)) : [];
      const calm = phase === 'done';
      for (const m of live) {
        if (calm && marbles[winnerIdx] === m) {
          // The survivor rolls to the centre
          m.x += (0.5 - m.x) * Math.min(1, dt * 3); m.y += (0.5 - m.y) * Math.min(1, dt * 3);
          continue;
        }
        m.vx += (Math.random() - 0.5) * 0.6 * dt;
        m.vy += (Math.random() - 0.5) * 0.6 * dt;
        const sp = Math.hypot(m.vx, m.vy), lo = 0.06, hi = phase === 'running' ? 0.42 : 0.24;
        if (sp < lo || sp > hi) { const k = clamp(sp, lo, hi) / (sp || 1); m.vx *= k; m.vy *= k; }
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.x < r) { m.x = r; m.vx = Math.abs(m.vx); } else if (m.x > 1 - r) { m.x = 1 - r; m.vx = -Math.abs(m.vx); }
        if (m.y < r) { m.y = r; m.vy = Math.abs(m.vy); } else if (m.y > 1 - r) { m.y = 1 - r; m.vy = -Math.abs(m.vy); }
        // Bounce off the creatures' heads
        SIDES.forEach((s, i) => {
          const bx = s.cx + s.dx * creatures[i].lunge * 0.09, by = s.cy + s.dy * creatures[i].lunge * 0.09;
          const dx = m.x - bx, dy = m.y - by, d = Math.hypot(dx, dy), min = BODY_R + r;
          if (d < min && d > 0) {
            m.x = bx + dx / d * min; m.y = by + dy / d * min;
            const dot = m.vx * dx / d + m.vy * dy / d;
            if (dot < 0) { m.vx -= 2 * dot * dx / d; m.vy -= 2 * dot * dy / d; }
          }
        });
        // Bystanders scoot away from an open mouth
        for (const mp of busyMouths) {
          const dx = m.x - mp.x, dy = m.y - mp.y, d = Math.hypot(dx, dy);
          if (d < 0.2 && d > 0) { m.vx += dx / d * 1.2 * dt; m.vy += dy / d * 1.2 * dt; }
        }
      }
      // Marbles bump into each other
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, min = 2 * r;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) { a.vx += rel * nx; a.vy += rel * ny; b.vx -= rel * nx; b.vy -= rel * ny; }
        }
      }
    }

    // ---------- Drawing ----------
    function layout() {
      const rect = canvas.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      if (!W || !H) { geo = null; return; }
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      }
      const A = Math.min(W, H) / (1 + 2 * (BODY_R + BODY_OFF)) * 0.97;
      geo = { W, H, dpr, A, x0: (W - A) / 2, y0: (H - A) / 2 };
    }
    const px = (x) => geo.x0 + x * geo.A;
    const py = (y) => geo.y0 + y * geo.A;

    function draw(now = performance.now()) {
      if (!geo) return;
      const { W, H, dpr, A } = geo;
      const c = { text: U.cssVar('--text'), muted: U.cssVar('--muted'), surface2: U.cssVar('--surface-2'), border: U.cssVar('--border') };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Arena floor
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(geo.x0, geo.y0, A, A, A * 0.06) : ctx.rect(geo.x0, geo.y0, A, A);
      ctx.fillStyle = c.surface2; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = c.border; ctx.stroke();
      const logo = app.logo('hipposCenter');
      if (U.imageReady(logo)) {
        ctx.save(); ctx.globalAlpha = 0.18;
        U.drawCircleImage(ctx, logo, px(0.5), py(0.5), A * 0.2);
        ctx.restore();
      }

      // Marbles (swallowed ones shrink into the mouth)
      const r = radius * A;
      const showNames = alive() <= 24 || phase !== 'running';
      for (let i = 0; i < marbles.length; i++) {
        const m = marbles[i];
        let s = 1, x = px(m.x), y = py(m.y);
        if (!m.alive) {
          const age = now - m.eatenAt;
          if (age > EAT_MS || m.eatenBy < 0) continue;
          s = 1 - age / EAT_MS;
          const mp = mouth(m.eatenBy);
          x += (px(mp.x) - x) * (1 - s); y += (py(mp.y) - y) * (1 - s);
        }
        const isWinner = i === winnerIdx;
        drawMarble(x, y, r * s * (isWinner ? 1.6 : 1), isWinner);
        if (m.alive && (showNames || m.victim || isWinner)) drawName(m.name, x, y - r * (isWinner ? 1.6 : 1) - 4, isWinner ? 18 : clamp(r * 0.9, 11, 15), c);
      }
      if (winnerIdx >= 0) {
        const m = marbles[winnerIdx];
        ctx.font = `${r * 2}px "Segoe UI Emoji", system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('👑', px(m.x), py(m.y) - r * 1.6 - 22);
      }

      // Creatures on top, so swallowed marbles vanish into them
      SIDES.forEach((s, i) => drawCreature(s, i));

      // Lobby / entry messages in the middle of the arena
      if (phase === 'lobby' || phase === 'entry') {
        const lines = phase === 'entry'
          ? [`Type ${command()} to join!`, fmtSecs(entryEnds - now), `${players().length} marble${players().length === 1 ? '' : 's'} in`]
          : players().length < 2 ? ['Add players, or open entries', 'so chat can join'] : [`${players().length} marbles ready`, 'Press Start round'];
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        lines.forEach((ln, k) => {
          ctx.font = `${k === 1 && phase === 'entry' ? 800 : 700} ${k === 1 && phase === 'entry' ? A * 0.1 : A * 0.042}px system-ui, sans-serif`;
          ctx.lineWidth = 4; ctx.strokeStyle = c.surface2; ctx.strokeText(ln, px(0.5), py(0.5) + (k - (lines.length - 1) / 2) * A * 0.085);
          ctx.fillStyle = k === 1 && phase === 'entry' ? U.cssVar('--accent') : c.text;
          ctx.fillText(ln, px(0.5), py(0.5) + (k - (lines.length - 1) / 2) * A * 0.085);
        });
      }
    }

    function drawMarble(x, y, r, gold) {
      if (r <= 0.5) return;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, gold ? '#ffe38a' : '#e9ecf1');
      g.addColorStop(1, gold ? '#e0a000' : '#b9c0cc');
      ctx.save();
      ctx.shadowColor = gold ? '#ffcc33' : 'rgba(0,0,0,.3)'; ctx.shadowBlur = gold ? r : r * 0.5; ctx.shadowOffsetY = gold ? 0 : r * 0.15;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
    }

    function drawName(name, x, y, size, c) {
      ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const label = U.fitText(ctx, name, 160);
      ctx.lineWidth = 3; ctx.strokeStyle = c.surface2; ctx.strokeText(label, x, y);
      ctx.fillStyle = c.text; ctx.fillText(label, x, y);
    }

    function drawCreature(s, i) {
      const th = theme(), cr = creatures[i], A = geo.A, R = BODY_R * A;
      const color = th.colors[i % th.colors.length];
      const cx = px(s.cx + s.dx * cr.lunge * 0.09), cy = py(s.cy + s.dy * cr.lunge * 0.09);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(s.dy, s.dx));   // +x now points at the arena centre
      // Head
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = R * 0.15;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = color; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, R * 0.04); ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.stroke();
      // Mouth: a wedge at the front that opens wide and snaps shut
      const a = 0.12 + cr.open * 0.78, mx = R * 0.12, ml = R * 0.88;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.arc(mx, 0, ml, -a, a); ctx.closePath();
      ctx.fillStyle = '#3b0d1f'; ctx.fill();
      if (th.tongue && cr.open > 0.2) {
        ctx.beginPath(); ctx.ellipse(mx + ml * 0.55, 0, ml * 0.35, ml * 0.12 * cr.open + 2, 0, 0, TAU);
        ctx.fillStyle = '#ff7aa8'; ctx.fill();
      }
      if (th.teeth || th.tusks) {
        ctx.fillStyle = '#fff';
        const teeth = th.tusks ? [0.82] : [0.45, 0.62, 0.79];
        const size = th.tusks ? R * 0.11 : R * 0.07;
        for (const side of [-1, 1]) {
          const ang = side * a;
          const dx = Math.cos(ang), dy = Math.sin(ang);          // along the jaw line
          const nx = side * dy, ny = -side * dx;                 // from the jaw into the mouth
          for (const f of teeth) {
            const tx = mx + dx * ml * f, ty = dy * ml * f;
            ctx.beginPath();
            ctx.moveTo(tx - dx * size * 0.6, ty - dy * size * 0.6);
            ctx.lineTo(tx + dx * size * 0.6, ty + dy * size * 0.6);
            ctx.lineTo(tx + nx * size * 1.6, ty + ny * size * 1.6);
            ctx.closePath(); ctx.fill();
          }
        }
      }
      // Eyes, looking at the arena
      const er = R * (th.bigEyes ? 0.21 : 0.16);
      for (const side of [-1, 1]) {
        const ex = -R * 0.22, ey = side * R * (th.bigEyes ? 0.55 : 0.5);
        ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(ex + er * 0.35, ey, er * 0.5, 0, TAU); ctx.fillStyle = '#14171c'; ctx.fill();
      }
      ctx.restore();
      // Name and score on the outer part of the head
      const lx = cx - s.dx * R * 0.62, ly = cy - s.dy * R * 0.62;
      ctx.font = `800 ${clamp(R * 0.17, 11, 17)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = `${creatureName(i)}${cr.count ? ` · ${cr.count}` : ''}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.strokeText(label, lx, ly);
      ctx.fillStyle = '#fff'; ctx.fillText(label, lx, ly);
    }

    // ---------- HUD, banner, buttons ----------
    function feedPush(text) {
      feed.unshift(text);
      feed = feed.slice(0, 6);
      renderHud();
    }
    function renderHud() {
      const running = phase === 'running' || phase === 'done';
      $('hipHud').hidden = !running;
      if (!running) return;
      $('hipAlive').textContent = `Alive: ${alive()} / ${marbles.length}`;
      const ol = $('hipFeed');
      ol.innerHTML = '';
      for (const f of feed) { const li = document.createElement('li'); li.textContent = f; ol.appendChild(li); }
    }
    function showBanner(text, color) {
      const b = $('hipBanner');
      b.textContent = text;
      b.style.setProperty('--tw', color);
      b.classList.remove('show');
      void b.offsetWidth;   // restart the CSS animation
      b.classList.add('show');
    }

    function updateButtons() {
      const n = players().length;
      if (phase === 'entry') {
        entriesBtn.textContent = `Close entries (${fmtSecs(entryEnds - performance.now())})`;
        entriesBtn.disabled = false;
      } else {
        entriesBtn.textContent = 'Open entries';
        entriesBtn.disabled = phase === 'running';
      }
      startBtn.textContent = phase === 'done' ? 'Play again' : phase === 'running' ? 'Round in progress…' : 'Start round';
      startBtn.disabled = phase === 'running' || n < 2;
      // Chat status hint
      const st = app.chat.status();
      const hint = $('hipChatHint');
      $('hipReconnect').hidden = st !== 'scope';
      hint.textContent = st === 'ok' ? `Chat joins by typing ${command()} while entries are open`
        : st === 'scope' ? 'Reconnect Twitch once to let chat join'
        : st === 'nohost' ? 'Chat joining works on the hosted site. Add players by hand here.'
        : 'Connect Twitch so chat can join, or add players by hand';
    }

    // ---------- Loop ----------
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    function loop(now) {
      raf = 0;
      if (!canvas.offsetParent) { lastFrame = 0; return; }   // hidden: stop until shown again
      if (!geo) layout();
      const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
      lastFrame = now;
      if (phase === 'running' && plan) advanceRound(now);
      physics(dt);
      draw(now);
      if (marbles.length || phase !== 'lobby') kick(); else lastFrame = 0;
    }

    function rebuild() {
      const units = U.buildUnits(app.state.items, 'hippos');
      const colors = app.colors();
      pool = units.map((item, i) => ({ item, color: U.colorAt(colors, i, units.length) }));
      if (phase !== 'running') { marbles.length !== players().length && resetLobby(); }
      layout();
      draw();
      kick();
    }

    // ---------- Wiring ----------
    $('hipAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (addPlayer($('hipAddName').value)) $('hipAddName').value = '';
      $('hipAddName').focus();
    });
    $('hipPlayers').addEventListener('click', (e) => { if (e.target.dataset.i !== undefined) removePlayer(+e.target.dataset.i); });
    $('hipClear').onclick = clearPlayers;
    entriesBtn.onclick = () => (phase === 'entry' ? closeEntries() : openEntries());
    startBtn.onclick = startRound;
    $('hipReconnect').onclick = () => app.chat.reconnect();
    new ResizeObserver(() => { layout(); draw(); kick(); }).observe(canvas);

    resetLobby();

    return {
      rebuild, draw: () => { layout(); draw(); kick(); }, start: startRound,
      busy: () => phase === 'running',
      colorOf: (id) => pool.find((p) => p.item.id === id)?.color,
      refresh: () => { updateButtons(); renderPlayers(); draw(); },
      reset: resetLobby,
    };
  };
})();
