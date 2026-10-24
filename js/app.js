/* App shell: state and saving, game switcher, settings, results, winner dialog, logos,
   Twitch settings, sharing and present mode. Each game lives in its own file. */
(() => {
  'use strict';
  const PW = window.PW;
  const U = PW.util;
  const { $, safe, toast, copy } = U;

  // Public Client ID of the shared Twitch app, so streamers only have to click Connect and Authorize.
  // Not a secret. Anyone can override it under Settings → Twitch → Advanced.
  const TWITCH_CLIENT_ID = 'ee3unqhvjtonr9kr6lojfsnkvxzabl';

  const STORE_KEY = 'prizewheel.v1';
  const LOGO_KEY = (spot) => `prizewheel.logo.${spot}`;
  const OLD_LOGO_KEY = 'prizewheel.logo';

  const GAMES = {
    wheel: { label: 'Wheel', unit: { one: 'slice', many: 'slices' } },
    plinko: { label: 'Plinko', unit: { one: 'bin', many: 'bins' } },
  };
  // Where a logo can appear, and the setting that switches it on
  const SPOTS = {
    wheelCenter: { label: 'Wheel center', setting: 'logoWheelCenter', none: 'Shows SPIN' },
    plinkoChip: { label: 'Plinko chip', setting: 'logoPlinkoChip', none: 'Plain colored chip' },
    plinkoHeader: { label: 'Plinko board header', setting: 'logoPlinkoHeader', none: 'Title text only' },
  };

  const list = (text) => () => U.itemsFromText(text);
  const numbers = (n) => list(Array.from({ length: n }, (_, i) => i + 1).join('\n'));
  // [name, qty, display mode in Plinko]; presets show everything as one slice on the wheel
  const fromRows = (rows) => () => rows.map(([n, q, m]) => U.makeItem(n, q, { plinko: m }));
  const PRESETS = {
    wheel: {
      yesno: { label: 'Yes / No', make: list('Yes\nNo') },
      coin: { label: 'Coin flip', make: list('Heads\nTails') },
      dice: { label: 'Dice 1–6', make: numbers(6) },
      num10: { label: 'Numbers 1–10', make: numbers(10) },
      num100: { label: 'Numbers 1–100', make: numbers(100) },
      az: { label: 'Letters A–Z', make: list('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').join('\n')) },
      prizes: {
        label: 'Sample prize wheel',
        make: fromRows([['🎁 Gift card', 3, 'count'], ['☕ Free coffee', 5, 'count'], ['👕 T-shirt', 2, 'split'],
          ['🍀 Try again', 3, 'split'], ['💎 Grand prize', 1, 'count'], ['🧢 Hat', 2, 'count']]),
      },
    },
    plinko: {
      prizes: {
        label: 'Sample prize board',
        make: fromRows([['💎 Grand prize', 1, 'count'], ['🎁 Gift card', 2, 'count'], ['🍀 Try again', 3, 'split'],
          ['☕ Coffee', 3, 'count'], ['👕 T-shirt', 1, 'count'], ['🍫 Candy', 2, 'split'], ['🧢 Hat', 1, 'count']]),
      },
      ladder: {
        label: 'Points ladder',
        make: list('1000\n500\n100\n50\n10\n50\n100\n500\n1000'),
      },
      yesno: { label: 'Yes / No', make: list('Yes\nNo\nYes\nNo\nYes') },
      dice: { label: 'Numbers 1–6', make: numbers(6) },
    },
  };

  const OLD_PLINKO_TEMPLATE = '🎉 {viewer} dropped from slot {slot} and won {prize}!';
  const DEFAULTS = {
    title: 'Prize Wheel', game: 'wheel',
    items: PRESETS.plinko.prizes.make(),        // one list shared by every game
    duration: 8, mystery: false, dropSpeed: 'normal',
    twistCount: 4, twistOn: Object.fromEntries(Object.keys(PW.TWISTS).map((k) => [k, true])),
    goldenName: '🎁 Golden bonus', goldenQty: 1,
    removeMode: 'ask', confetti: true, sound: true, greenScreen: false,
    palette: 'vivid', customColors: '', theme: 'auto', addMode: 'count',
    logoWheelCenter: true, logoPlinkoChip: true, logoPlinkoHeader: true,
    twitchClientId: '', announce: true,
    wheelTemplate: '🎉 The wheel landed on {prize}!',
    plinkoTemplate: '🎉 {viewer} dropped from slot {slot}{twists} and won {prize}!',
  };
  const SETTING_KEYS = Object.keys(DEFAULTS).filter((k) => k !== 'items' && k !== 'twistOn');

  // ---------- State ----------
  const state = { ...DEFAULTS, twistOn: { ...DEFAULTS.twistOn } };
  let history = [];          // [{ game, name, color, time, slot?, viewer?, twists? }]
  const logoUploads = {};    // spot -> Image uploaded by the user
  let lastWinner = null;     // { prizes, golden } awaiting the "take" decision

  function save() {
    safe(() => localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, history })));
  }

  // Copies validated settings and items from a stored, shared or restored object.
  function applyData(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of SETTING_KEYS) if (k in obj && typeof obj[k] === typeof DEFAULTS[k]) state[k] = obj[k];
    if (obj.twistOn && typeof obj.twistOn === 'object') {
      for (const k of Object.keys(DEFAULTS.twistOn)) if (typeof obj.twistOn[k] === 'boolean') state.twistOn[k] = obj.twistOn[k];
    }
    state.twistCount = Math.max(0, Math.min(12, Math.round(state.twistCount) || 0));
    state.goldenQty = U.clampQty(state.goldenQty);

    // Entries: the shared list, or older saves' per-game lists merged into one
    // (`wheelItems`/`plinkoItems`), or the very first version's one-per-line `entries` text.
    let items = null;
    if (obj.wheelItems || obj.plinkoItems) {
      items = U.mergeLists([
        { game: 'wheel', items: U.sanitizeItems(obj.wheelItems, 'wheel') || [] },
        { game: 'plinko', items: U.sanitizeItems(obj.plinkoItems, 'plinko') || [] },
      ]);
    } else {
      items = U.sanitizeItems(obj.items, 'wheel') ?? (typeof obj.entries === 'string' ? U.itemsFromText(obj.entries) : null);
    }
    if (items) state.items = items;

    // Pick up the new {twists} placeholder if the old default message is still in use
    if (state.plinkoTemplate === OLD_PLINKO_TEMPLATE) state.plinkoTemplate = DEFAULTS.plinkoTemplate;
    if (!GAMES[state.game]) state.game = 'wheel';
  }

  function load() {
    const stored = safe(() => JSON.parse(localStorage.getItem(STORE_KEY)), null);
    if (stored) {
      applyData(stored);
      if (Array.isArray(stored.history)) history = stored.history.filter((h) => h && typeof h.name === 'string');
    }
    const m = /^#w=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (m) {
      applyData(U.decodeJSON(m[1]));
      history = [];
      safe(() => window.history.replaceState(null, '', location.pathname + location.search));
    }
  }

  // ---------- Twitch, games and the entry editor ----------
  const sound = U.createSound(() => state.sound);
  const twitchClientId = () => state.twitchClientId.trim() || TWITCH_CLIENT_ID;
  const twitch = PW.createTwitch({ clientId: twitchClientId, changed: () => refreshLogos() });

  const app = {
    state, sound,
    colors: () => U.paletteColors(state),
    logo: (spot) => (state[SPOTS[spot].setting] ? logoUploads[spot] || twitch.avatar || null : null),
    headerInfo: () => (state.logoPlinkoHeader ? { img: app.logo('plinkoHeader'), text: twitch.session?.name || state.title } : null),
    lock: (on) => $('entriesTab').classList.toggle('locked', on),
    closeDialog: () => { if ($('winDialog').open) $('winDialog').close(); },
    result: onResult,
  };
  const games = { wheel: PW.createWheel(app), plinko: PW.createPlinko(app) };
  const cur = () => games[state.game];
  const busy = () => Object.values(games).some((g) => g.busy());

  const editor = PW.createItemEditor({
    key: () => state.game,
    games: () => Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, g.label])),
    items: () => state.items,
    setItems: (arr) => { state.items = arr; },
    unit: (k) => GAMES[k].unit,
    colorOf: (id) => cur().colorOf(id),
    presets: () => PRESETS[state.game],
    addMode: () => state.addMode,
    setAddMode: (v) => { state.addMode = v; save(); },
    changed: () => { Object.values(games).forEach((g) => g.rebuild()); updateCounts(); save(); },
  });

  function updateCounts() {
    const inGame = state.items.filter((it) => U.includedIn(it, state.game));
    $('entryCount').textContent = inGame.length ? `(${inGame.filter((it) => it.qty > 0).length})` : '';
  }

  function rebuildAll() { Object.values(games).forEach((g) => g.rebuild()); editor.render(); updateCounts(); }
  function redrawAll() { Object.values(games).forEach((g) => g.draw()); }

  // ---------- Game switcher ----------
  function switchGame(g) {
    if (!GAMES[g]) return;
    if (busy()) return toast('Wait for the current round to finish');
    state.game = g;
    document.body.dataset.game = g;
    U.setSeg('gameSwitch', g);
    editor.populatePresets();
    editor.render();
    editor.renderAddMode();
    updateCounts();
    save();
  }

  // ---------- Results ----------
  // r: { game, prizes: [{ item, color, n }], slot?, viewer?, twists?: [twist keys], golden? }
  const twistLabel = (k) => {
    const t = PW.TWISTS[k];
    return t ? `${t.icon === '×2' ? '✖️2' : t.icon} ${t.label}` : k;
  };
  const prizeText = (r) => {
    const parts = r.prizes.map((p) => (p.n > 1 ? `${p.n}× ${p.item.name}` : p.item.name));
    if (r.golden) parts.push(`⭐ ${state.goldenName}`);
    return parts.join(' + ');
  };

  function onResult(r) {
    history.unshift({
      game: r.game, name: prizeText(r), color: r.prizes[0].color, time: new Date().toISOString(),
      slot: r.slot, viewer: r.viewer || undefined, twists: r.twists?.length ? r.twists : undefined,
    });
    renderHistory();
    save();
    sound.fanfare();
    if (state.confetti) U.confetti([...r.prizes.map((p) => p.color), ...(r.golden ? ['#ffc53d', '#ffe08a'] : []), ...app.colors()]);
    showWinner(r);
    announce(r);
  }

  const fillTemplate = (tpl, r) => tpl.replace(/\{(viewer|prize|slot|channel|twists)\}/g, (_, k) => ({
    viewer: r.viewer || 'A viewer',
    prize: prizeText(r),
    slot: r.slot ?? '',
    channel: twitch.session?.name || '',
    twists: (r.twists || []).map((t) => ` → ${twistLabel(t)}`).join(''),
  })[k]);

  function announce(r) {
    if (!state.announce || !twitch.session) return;
    const tpl = r.game === 'plinko' ? state.plinkoTemplate : state.wheelTemplate;
    if (tpl.trim()) twitch.say(fillTemplate(tpl, r));
  }

  // Takes the won prizes off their counts (and the Golden bonus off its stock)
  function takePrizes(r) {
    for (const p of r.prizes) editor.takeOne(p.item, p.n);
    if (r.golden && state.goldenQty > 0) {
      state.goldenQty -= 1;
      $('goldenQty').value = state.goldenQty;
      save();
    }
  }

  const leftNote = (n) => (n > 0 ? `${n} left.` : 'None left. Removed from the board.');

  function showWinner(r) {
    const single = r.prizes.length === 1 && r.prizes[0].n === 1 && !r.golden;
    const q = r.prizes[0].item.qty;
    lastWinner = r;
    $('winName').textContent = prizeText(r);
    $('winHead').style.background = r.prizes[0].color;
    $('winHead').style.color = U.textOn(r.prizes[0].color);
    const sub = r.game === 'plinko'
      ? [`Slot ${r.slot}`, r.viewer && `called by ${r.viewer}`, ...(r.twists || []).map(twistLabel)].filter(Boolean).join(' · ')
      : '';
    $('winSub').textContent = sub;
    $('winSub').hidden = !sub;
    $('winAgain').textContent = r.game === 'plinko' ? 'Next drop' : 'Spin again';
    const remove = $('winRemove');
    const note = $('winNote');
    note.textContent = '';
    remove.hidden = false;
    remove.textContent = !single ? 'Take prizes' : q > 1 ? `Take one (${q} → ${q - 1})` : 'Remove';
    if (state.removeMode === 'auto') {
      takePrizes(r);
      lastWinner = null;
      note.textContent = single ? leftNote(r.prizes[0].item.qty) : 'Counts updated.';
      remove.hidden = true;
    } else if (state.removeMode === 'never') {
      remove.hidden = true;
      if (single && q > 1) note.textContent = leftNote(q);
    }
    $('winDialog').showModal();
    $('winAgain').focus();
  }

  function fmtTime(iso) {
    return safe(() => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }), '');
  }
  const metaFor = (h) => (h.game === 'plinko'
    ? ['Plinko', `slot ${h.slot}`, h.viewer, ...(h.twists || []).map(twistLabel)].filter(Boolean).join(' · ')
    : 'Wheel');

  function renderHistory() {
    const ol = $('history');
    ol.innerHTML = '';
    $('resultCount').textContent = history.length ? `(${history.length})` : '';
    $('resultSummary').textContent = history.length ? `${history.length} result${history.length === 1 ? '' : 's'}` : '';
    if (!history.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No results yet. Winners show up here.';
      ol.appendChild(li);
      return;
    }
    history.forEach((h, i) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = history.length - i;
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = h.color;
      const what = document.createElement('span'); what.className = 'what';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = h.name; name.title = h.name;
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = metaFor(h);
      what.append(name, meta);
      const time = document.createElement('time'); time.dateTime = h.time; time.textContent = fmtTime(h.time);
      li.append(n, dot, what, time);
      ol.appendChild(li);
    });
  }

  const slug = () => (state.title || 'prizes').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prizes';
  const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

  // ---------- Logos ----------
  async function setLogoUpload(spot, dataUrl, persist = true) {
    try { logoUploads[spot] = await U.loadImage(dataUrl); } catch { return; }
    if (persist && !safe(() => { localStorage.setItem(LOGO_KEY(spot), dataUrl); return true; }, false)) {
      toast('Image is too large to remember after reload');
    }
    refreshLogos();
  }
  function loadLogos() {
    // Before per-spot logos there was one upload for the wheel center
    const old = safe(() => localStorage.getItem(OLD_LOGO_KEY), null);
    if (old && !safe(() => localStorage.getItem(LOGO_KEY('wheelCenter')), null)) {
      safe(() => { localStorage.setItem(LOGO_KEY('wheelCenter'), old); localStorage.removeItem(OLD_LOGO_KEY); });
    }
    for (const spot of Object.keys(SPOTS)) {
      const data = safe(() => localStorage.getItem(LOGO_KEY(spot)), null);
      if (data) setLogoUpload(spot, data, false);
    }
  }

  function renderLogos() {
    for (const [spot, info] of Object.entries(SPOTS)) {
      const row = document.querySelector(`.logo-row[data-spot="${spot}"]`);
      const img = logoUploads[spot] || twitch.avatar;
      row.querySelector('input[type=checkbox]').checked = state[info.setting];
      row.querySelector('.logo-thumb').style.backgroundImage = img ? `url("${img.src}")` : '';
      row.querySelector('.hint').textContent = !state[info.setting] ? 'Off'
        : logoUploads[spot] ? 'Your uploaded image'
        : twitch.avatar ? 'Twitch profile picture'
        : info.none;
      row.querySelector('[data-act=clear]').hidden = !logoUploads[spot];
    }
  }

  function refreshLogos() {
    renderLogos();
    renderTwitch();
    redrawAll();
  }

  // ---------- Twitch settings ----------
  function renderTwitch() {
    const s = twitch.session;
    $('twitchDot').classList.toggle('on', !!s);
    $('twitchAvatar').hidden = !twitch.avatar;
    if (twitch.avatar) $('twitchAvatar').src = twitch.avatar.src;
    $('twitchStatusText').textContent = s ? `Connected as ${s.name}` : 'Not connected';
    // With a built-in Client ID the setup fields are an optional "Advanced" section
    $('twitchSetup').hidden = !!s;
    $('twitchSetupSummary').textContent = TWITCH_CLIENT_ID ? 'Advanced: use your own Twitch app' : 'Twitch app setup';
    $('builtinHint').hidden = !TWITCH_CLIENT_ID;
    if (!TWITCH_CLIENT_ID && !state.twitchClientId) $('twitchSetup').open = true;
    $('twitchConnect').hidden = !!s;
    $('twitchDisconnect').hidden = !s;
    $('testChat').disabled = !s;
    $('redirectUrl').textContent = twitch.redirectUri();
    const hosted = twitch.canConnect();
    $('twitchConnect').disabled = !hosted;
    $('twitchNote').textContent = hosted ? ''
      : 'Twitch sign-in only works once the app is hosted online (for example on GitHub Pages). See SETUP.md.';
    $('twitchNote').hidden = hosted;

    // Header button: one click to connect; shows the channel once connected
    const hb = $('twitchHeaderBtn');
    hb.hidden = !hosted && !s;
    hb.classList.toggle('on', !!s);
    $('twitchHeaderAvatar').hidden = !(s && twitch.avatar);
    if (s && twitch.avatar) $('twitchHeaderAvatar').src = twitch.avatar.src;
    $('twitchHeaderText').textContent = s ? s.name : 'Connect Twitch';
    hb.title = s ? 'Twitch connected. Click for Twitch settings.' : 'Connect your Twitch account';
    hb.querySelector('svg').style.display = s && twitch.avatar ? 'none' : '';
  }

  function openTwitchSettings() {
    document.querySelector('.tabs [data-tab=settingsTab]').click();
    if (document.body.classList.contains('present')) togglePresent(false);
    $('twitchStatus').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Controls ----------
  function applyTheme() {
    if (state.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', state.theme);
    U.setSeg('themeMode', state.theme);
    redrawAll();
  }

  const SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
  const SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>';
  function renderSound() {
    const btn = $('soundBtn');
    btn.innerHTML = state.sound ? SOUND_ON : SOUND_OFF;
    btn.setAttribute('aria-pressed', String(state.sound));
    btn.setAttribute('aria-label', state.sound ? 'Mute sound' : 'Unmute sound');
  }

  function syncControls() {
    $('title').value = state.title;
    document.title = state.title || 'Prize Wheel';
    $('duration').value = state.duration;
    $('durationVal').textContent = `${state.duration}s`;
    $('confettiChk').checked = state.confetti;
    $('mysteryChk').checked = state.mystery;
    $('greenChk').checked = state.greenScreen;
    document.body.classList.toggle('green', state.greenScreen);
    $('paletteSel').value = state.palette;
    $('customColors').value = state.customColors;
    $('customColors').hidden = state.palette !== 'custom';
    $('twitchClientId').value = state.twitchClientId;
    $('announceChk').checked = state.announce;
    $('wheelTemplate').value = state.wheelTemplate;
    $('plinkoTemplate').value = state.plinkoTemplate;
    U.setSeg('removeMode', state.removeMode);
    U.setSeg('dropSpeed', state.dropSpeed);
    $('twistCount').value = state.twistCount;
    $('twistCountVal').textContent = state.twistCount;
    document.querySelectorAll('#twistGrid input[data-twist]').forEach((cb) => { cb.checked = state.twistOn[cb.dataset.twist]; });
    $('goldenName').value = state.goldenName;
    $('goldenQty').value = state.goldenQty;
    renderSound();
    renderLogos();
    renderTwitch();
    applyTheme();
  }

  function togglePresent(force) {
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('present');
    document.body.classList.toggle('present', on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  function wire() {
    // Palette options
    for (const k of Object.keys(U.PALETTES)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = k[0].toUpperCase() + k.slice(1);
      $('paletteSel').appendChild(o);
    }
    $('paletteSel').insertAdjacentHTML('beforeend', '<option value="custom">Custom…</option>');

    document.querySelectorAll('#gameSwitch button').forEach((b) => b.onclick = () => switchGame(b.dataset.v));

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey || $('winDialog').open) return;
      if (e.code === 'Space') { e.preventDefault(); cur().start(); }
      else if (state.game === 'plinko' && /^[0-9]$/.test(e.key)) { e.preventDefault(); games.plinko.typeDigit(e.key); }
      else if (state.game === 'plinko' && e.key === 'Enter') { e.preventDefault(); games.plinko.start(); }
      else if (e.key === 'f' || e.key === 'F') togglePresent();
      else if (e.key === 'Escape' && document.body.classList.contains('present')) togglePresent(false);
    });

    $('title').addEventListener('input', () => {
      state.title = $('title').value;
      document.title = state.title || 'Prize Wheel';
      games.plinko.draw();
      save();
    });

    // Results
    $('copyResultsBtn').onclick = () => {
      if (!history.length) return toast('No results yet');
      copy(history.slice().reverse().map((h, i) => `${i + 1}. ${h.name} (${metaFor(h)})`).join('\n'), 'Results copied');
    };
    $('csvBtn').onclick = () => {
      if (!history.length) return toast('No results yet');
      const rows = [['#', 'Game', 'Result', 'Slot', 'Called by', 'Twists', 'Time'],
        ...history.slice().reverse().map((h, i) => [i + 1, GAMES[h.game]?.label || 'Wheel', h.name, h.slot, h.viewer,
          (h.twists || []).map((t) => PW.TWISTS[t]?.label || t).join(', '), h.time])];
      U.download(`${slug()}-results.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
    };
    $('clearResultsBtn').onclick = () => {
      if (history.length && confirm('Clear all results?')) { history = []; renderHistory(); save(); }
    };

    // Settings
    $('duration').oninput = () => { state.duration = +$('duration').value; $('durationVal').textContent = `${state.duration}s`; save(); };
    const segGroup = (id, key, after) => document.querySelectorAll(`#${id} button`).forEach((b) => b.onclick = () => {
      state[key] = b.dataset.v; U.setSeg(id, state[key]); save(); after?.();
    });
    segGroup('removeMode', 'removeMode');
    segGroup('dropSpeed', 'dropSpeed');
    segGroup('themeMode', 'theme', applyTheme);
    // Plinko twists
    const groups = {};
    for (const [k, t] of Object.entries(PW.TWISTS)) (groups[t.group] ||= []).push([k, t]);
    $('twistGrid').innerHTML = Object.entries(groups).map(([group, list]) => `
      <p class="twist-group">${group}</p>
      ${list.map(([k, t]) => `<label class="check twist-opt" title="${t.desc}">
        <input type="checkbox" data-twist="${k}"><span class="twist-icon" style="background:${t.color}">${t.icon}</span>
        <span><b>${t.label}</b><small>${t.desc}</small></span></label>`).join('')}`).join('');
    const twistsChanged = () => { save(); games.plinko.rerollTwists(); };
    $('twistGrid').addEventListener('change', (e) => {
      const k = e.target.dataset.twist;
      if (!k) return;
      state.twistOn[k] = e.target.checked;
      twistsChanged();
    });
    $('twistCount').oninput = () => { state.twistCount = +$('twistCount').value; $('twistCountVal').textContent = state.twistCount; twistsChanged(); };
    $('rerollTwists').onclick = () => games.plinko.rerollTwists();
    $('goldenName').oninput = () => { state.goldenName = $('goldenName').value.slice(0, 80); save(); };
    $('goldenName').onchange = twistsChanged;
    $('goldenQty').onchange = () => { state.goldenQty = U.clampQty($('goldenQty').value); $('goldenQty').value = state.goldenQty; twistsChanged(); };

    $('confettiChk').onchange = () => { state.confetti = $('confettiChk').checked; save(); };
    $('mysteryChk').onchange = () => { state.mystery = $('mysteryChk').checked; games.wheel.draw(); save(); };
    $('greenChk').onchange = () => {
      state.greenScreen = $('greenChk').checked;
      document.body.classList.toggle('green', state.greenScreen);
      redrawAll(); save();
    };
    $('paletteSel').onchange = () => {
      state.palette = $('paletteSel').value;
      $('customColors').hidden = state.palette !== 'custom';
      if (state.palette === 'custom' && !state.customColors) {
        state.customColors = U.PALETTES.vivid.join(', ');
        $('customColors').value = state.customColors;
      }
      rebuildAll(); save();
    };
    $('customColors').oninput = () => { state.customColors = $('customColors').value; rebuildAll(); save(); };
    $('soundBtn').onclick = () => { state.sound = !state.sound; renderSound(); save(); };

    // Logos
    let uploadSpot = null;
    document.querySelectorAll('.logo-row').forEach((row) => {
      const spot = row.dataset.spot;
      row.querySelector('input[type=checkbox]').onchange = (e) => { state[SPOTS[spot].setting] = e.target.checked; save(); refreshLogos(); };
      row.querySelector('[data-act=upload]').onclick = () => { uploadSpot = spot; $('logoFile').click(); };
      row.querySelector('[data-act=clear]').onclick = () => {
        delete logoUploads[spot];
        safe(() => localStorage.removeItem(LOGO_KEY(spot)));
        refreshLogos();
      };
    });
    $('logoFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f || !uploadSpot) return;
      try { await setLogoUpload(uploadSpot, await U.shrinkImage(f)); } catch { toast("Couldn't read that image"); }
    };

    // Twitch
    $('twitchClientId').oninput = () => { state.twitchClientId = $('twitchClientId').value.trim(); save(); };
    $('copyRedirect').onclick = () => copy(twitch.redirectUri(), 'Redirect URL copied');
    const connect = () => {
      if (!twitchClientId()) { openTwitchSettings(); $('twitchSetup').open = true; $('twitchClientId').focus(); return; }
      twitch.connect();
    };
    $('twitchConnect').onclick = connect;
    $('twitchHeaderBtn').onclick = () => (twitch.session ? openTwitchSettings() : connect());
    $('twitchClientId').addEventListener('change', renderTwitch);
    $('twitchDisconnect').onclick = () => { twitch.disconnect(); toast('Disconnected from Twitch'); };
    $('announceChk').onchange = () => { state.announce = $('announceChk').checked; save(); };
    $('wheelTemplate').oninput = () => { state.wheelTemplate = $('wheelTemplate').value; save(); };
    $('plinkoTemplate').oninput = () => { state.plinkoTemplate = $('plinkoTemplate').value; save(); };
    $('testChat').onclick = async () => {
      if (await twitch.say('✅ Prize Wheel is connected to chat.')) toast('Test message sent');
    };

    // Backup
    $('backupBtn').onclick = () => U.download(`${slug()}.json`, JSON.stringify({ app: 'prize-wheel', version: 3, ...state, history }, null, 2), 'application/json');
    $('restoreBtn').onclick = () => $('restoreFile').click();
    $('restoreFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        applyData(data);
        if (Array.isArray(data.history)) history = data.history.filter((h) => h && typeof h.name === 'string');
        syncControls(); rebuildAll(); renderHistory(); switchGame(state.game); save();
        toast('Backup restored');
      } catch { toast("That file isn't a valid backup"); }
    };

    $('shareBtn').onclick = () => {
      const { title, game, duration, mystery, dropSpeed, removeMode, confetti, palette, customColors,
        twistCount, twistOn, goldenName, goldenQty } = state;
      const data = {
        title, game, duration, mystery, dropSpeed, removeMode, confetti, palette, customColors,
        twistCount, twistOn, goldenName, goldenQty, items: U.compactItems(state.items),
      };
      const base = location.origin === 'null' ? location.href.split('#')[0] : location.origin + location.pathname;
      copy(`${base}#w=${U.encodeJSON(data)}`, 'Share link copied');
    };

    // Present mode
    $('presentBtn').onclick = () => togglePresent(true);
    $('presentExit').onclick = () => togglePresent(false);
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('present')) togglePresent(false);
    });

    // Tabs
    document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === b.dataset.tab));
    });

    // Winner dialog
    const dialog = $('winDialog');
    $('winClose').onclick = () => dialog.close();
    $('winAgain').onclick = () => {
      dialog.close();
      if (state.game === 'plinko') { $('viewerInput').focus(); } else cur().start();
    };
    $('winRemove').onclick = () => { if (lastWinner) takePrizes(lastWinner); dialog.close(); };
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { lastWinner = null; });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
  }

  // ---------- Start ----------
  load();
  wire();
  syncControls();
  Object.values(games).forEach((g) => g.rebuild());
  switchGame(state.game);
  renderHistory();
  loadLogos();
  twitch.handleRedirect().then((handled) => { if (!handled) twitch.validate(); });
})();
