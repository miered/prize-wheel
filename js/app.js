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
  const WHEEL_LOGO_KEY = (wheelId) => `prizewheel.logo.wheelCenter.${wheelId}`;

  const GAMES = {
    wheel: { label: 'Wheel', unit: { one: 'slice', many: 'slices' } },
    plinko: { label: 'Plinko', unit: { one: 'bin', many: 'bins' } },
    hippos: { label: 'Hippos', unit: { one: 'prize', many: 'prizes' } },
  };
  // Where a logo can appear, and the setting that switches it on
  const SPOTS = {
    wheelCenter: { label: 'Wheel center', setting: 'logoWheelCenter', none: 'Shows SPIN' },
    plinkoChip: { label: 'Plinko chip', setting: 'logoPlinkoChip', none: 'Plain colored chip' },
    plinkoHeader: { label: 'Plinko board header', setting: 'logoPlinkoHeader', none: 'Title text only' },
    hipposCenter: { label: 'Hippos arena center', setting: 'logoHipposCenter', none: 'Plain arena' },
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
    hippos: {
      prizes: {
        label: 'Sample prizes',
        make: fromRows([['🎁 Gift card', 2, 'count'], ['☕ Coffee', 3, 'count'], ['👕 T-shirt', 1, 'count'], ['🧢 Hat', 1, 'count'], ['💎 Grand prize', 1, 'count']]),
      },
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
    logoWheelCenter: true, logoPlinkoChip: true, logoPlinkoHeader: true, logoHipposCenter: true,
    hipposPlayers: [],                 // [{ name, id? }] — id is the Twitch user id for chat entries
    hipposCommand: '!join', hipposEntrySecs: 60, hipposLength: 'normal', hipposTheme: 'hippos',
    hipposNames: {},                   // { theme: [4 custom creature names] }
    twitchClientId: '', announce: true,
    wheelTemplate: '🎉 The wheel landed on {prize}!',
    plinkoTemplate: '🎉 {viewer} dropped from slot {slot}{twists} and won {prize}!',
    hipposTemplate: '🏆 {viewer} survived {entrants} marbles and won {prize}!{runnersup} · Hungriest: {hungriest}',
  };
  // Saved per wheel rather than app-wide (the wheel's name is the `title`)
  const WHEEL_KEYS = ['title', 'palette', 'customColors', 'duration'];
  // Validated separately in applyData()
  const SPECIAL_KEYS = ['items', 'twistOn', 'hipposPlayers', 'hipposNames'];
  const SETTING_KEYS = Object.keys(DEFAULTS).filter((k) => !SPECIAL_KEYS.includes(k) && !WHEEL_KEYS.includes(k));

  // ---------- State ----------
  // `state` holds app-wide settings plus the active wheel's fields (items, title, palette,
  // customColors, duration); `history` is the active wheel's results. Other wheels wait in `wheels`.
  const state = { ...DEFAULTS, twistOn: { ...DEFAULTS.twistOn }, hipposPlayers: [], hipposNames: {} };
  let history = [];          // [{ game, name, color, time, slot?, viewer?, twists? }]
  let wheels = [];           // [{ id, name, items, palette, customColors, duration, history }]
  let activeId = '';
  const logoUploads = {};    // spot -> Image uploaded by the user (wheelCenter is the active wheel's)
  let lastWinner = null;     // { prizes, golden } awaiting the "take" decision

  const newWheelId = () => `w${Date.now().toString(36)}${Math.floor(U.rand() * 1e6).toString(36)}`;
  const activeWheel = () => wheels.find((w) => w.id === activeId);

  // Copies the live fields back into the active wheel's record
  function syncActive() {
    const w = activeWheel();
    if (!w) return;
    Object.assign(w, { name: state.title, items: state.items, palette: state.palette, customColors: state.customColors, duration: state.duration, history });
  }
  function loadWheel(w) {
    activeId = w.id;
    Object.assign(state, { title: w.name, items: w.items, palette: w.palette, customColors: w.customColors, duration: w.duration });
    history = w.history;
  }

  function save() {
    syncActive();
    const { items, ...settings } = state;
    safe(() => localStorage.setItem(STORE_KEY, JSON.stringify({ ...settings, wheels, activeWheel: activeId })));
  }

  // Copies validated app-wide settings from a stored, shared or restored object.
  function applyData(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of SETTING_KEYS) if (k in obj && typeof obj[k] === typeof DEFAULTS[k]) state[k] = obj[k];
    if (obj.twistOn && typeof obj.twistOn === 'object') {
      for (const k of Object.keys(DEFAULTS.twistOn)) if (typeof obj.twistOn[k] === 'boolean') state.twistOn[k] = obj.twistOn[k];
    }
    state.twistCount = Math.max(0, Math.min(12, Math.round(state.twistCount) || 0));
    state.goldenQty = U.clampQty(state.goldenQty);
    if (Array.isArray(obj.hipposPlayers)) {
      state.hipposPlayers = obj.hipposPlayers
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        .slice(0, 200)
        .map((p) => (typeof p.id === 'string' && p.id ? { name: p.name.trim().slice(0, 40), id: p.id } : { name: p.name.trim().slice(0, 40) }));
    }
    if (obj.hipposNames && typeof obj.hipposNames === 'object') {
      for (const [k, v] of Object.entries(obj.hipposNames)) {
        if (PW.HIPPO_THEMES[k] && Array.isArray(v)) state.hipposNames[k] = v.slice(0, 4).map((s) => String(s ?? '').slice(0, 24));
      }
    }
    if (!PW.HIPPO_THEMES[state.hipposTheme]) state.hipposTheme = 'hippos';
    // Pick up the new {twists} placeholder if the old default message is still in use
    if (state.plinkoTemplate === OLD_PLINKO_TEMPLATE) state.plinkoTemplate = DEFAULTS.plinkoTemplate;
    if (!GAMES[state.game]) state.game = 'wheel';
  }

  // Builds a validated wheel record from a saved wheel, a share link, or an older save
  // (which kept one wheel's fields at the top level). Returns null if it has no entries field.
  function wheelFromData(obj, fallbackName = DEFAULTS.title) {
    if (!obj || typeof obj !== 'object') return null;
    // Entries: the shared list, older per-game lists merged into one (`wheelItems`/`plinkoItems`),
    // or the very first version's one-per-line `entries` text
    let items;
    if (obj.wheelItems || obj.plinkoItems) {
      items = U.mergeLists([
        { game: 'wheel', items: U.sanitizeItems(obj.wheelItems, 'wheel') || [] },
        { game: 'plinko', items: U.sanitizeItems(obj.plinkoItems, 'plinko') || [] },
      ]);
    } else {
      items = U.sanitizeItems(obj.items, 'wheel') ?? (typeof obj.entries === 'string' ? U.itemsFromText(obj.entries) : null);
    }
    if (!items) return null;
    const pick = (k) => (typeof obj[k] === typeof DEFAULTS[k] ? obj[k] : DEFAULTS[k]);
    const name = String(obj.name ?? obj.title ?? '').trim().slice(0, 80) || fallbackName;
    return {
      id: typeof obj.id === 'string' && /^w[a-z0-9]+$/.test(obj.id) ? obj.id : newWheelId(),
      name, items, palette: pick('palette'), customColors: pick('customColors'),
      duration: Math.max(2, Math.min(20, Math.round(pick('duration')))),
      history: Array.isArray(obj.history) ? obj.history.filter((h) => h && typeof h.name === 'string') : [],
    };
  }

  // Replaces all wheels from a save or backup (or wraps an older single-wheel save as the first wheel)
  function loadWheels(obj) {
    const list = Array.isArray(obj?.wheels)
      ? obj.wheels.map((w, i) => wheelFromData(w, `Wheel ${i + 1}`)).filter(Boolean)
      : [wheelFromData(obj)].filter(Boolean);
    if (!list.length) return false;
    wheels = list;
    loadWheel(wheels.find((w) => w.id === obj.activeWheel) || wheels[0]);
    return true;
  }

  const uniqueName = (base) => {
    const names = new Set(wheels.map((w) => w.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
  };

  let openedShare = false;
  function load() {
    const stored = safe(() => JSON.parse(localStorage.getItem(STORE_KEY)), null);
    if (stored) applyData(stored);
    if (!stored || !loadWheels(stored)) {
      wheels = [wheelFromData({ title: DEFAULTS.title, items: DEFAULTS.items })];
      loadWheel(wheels[0]);
    }
    // A share link opens as a new saved wheel rather than replacing yours
    const m = /^#w=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (m) {
      const shared = U.decodeJSON(m[1]);
      applyData(shared);
      const w = wheelFromData(shared, 'Shared wheel');
      if (w) {
        syncActive();
        w.id = newWheelId();
        w.name = uniqueName(w.name);
        w.history = [];
        wheels.push(w);
        loadWheel(w);
        openedShare = true;
      }
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
    savePlayers: () => save(),
    // Twitch chat for games that let viewers join
    chat: {
      status: () => (!twitch.canConnect() ? 'nohost' : !twitch.session ? 'off' : twitch.hasScope('user:read:chat') ? 'ok' : 'scope'),
      listen: (onMessage, onError) => twitch.listenChat(onMessage, onError),
      say: (text) => { if (twitch.session) twitch.say(text); },
      reconnect: () => twitch.connect(),
    },
  };
  const games = { wheel: PW.createWheel(app), plinko: PW.createPlinko(app), hippos: PW.createHippos(app) };
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
  // r: { game, prizes: [{ item, color, n }], slot?, viewer?, twists?: [twist keys], golden?,
  //      entrants?, runnersUp?: [names], hungriest?: { name, count } }   (the last three: Hippos)
  const twistLabel = (k) => {
    const t = PW.TWISTS[k];
    return t ? `${t.icon === '×2' ? '✖️2' : t.icon} ${t.label}` : k;
  };
  const prizeText = (r) => {
    const parts = r.prizes.map((p) => (p.n > 1 ? `${p.n}× ${p.item.name}` : p.item.name));
    if (r.golden) parts.push(`⭐ ${state.goldenName}`);
    return parts.join(' + ');
  };
  // In Hippos the headline is the survivor; elsewhere it's the prize
  const headline = (r) => (r.game === 'hippos'
    ? `🏆 ${r.viewer}${r.prizes.length ? ` → ${prizeText(r)}` : ''}`
    : prizeText(r));
  const medals = (names = []) => names.map((n, i) => `${['🥈', '🥉'][i]} ${n}`).join(' ');

  function onResult(r) {
    const color = r.prizes[0]?.color || '#F5B400';
    history.unshift({
      game: r.game, name: headline(r), color, time: new Date().toISOString(),
      slot: r.slot, viewer: r.viewer || undefined, twists: r.twists?.length ? r.twists : undefined,
      entrants: r.entrants, runnersUp: r.runnersUp?.length ? r.runnersUp : undefined,
    });
    renderHistory();
    save();
    sound.fanfare();
    if (state.confetti) U.confetti([color, ...r.prizes.map((p) => p.color), ...(r.golden || r.game === 'hippos' ? ['#ffc53d', '#ffe08a'] : []), ...app.colors()]);
    showWinner(r);
    announce(r);
  }

  const fillTemplate = (tpl, r) => tpl.replace(/\{(viewer|prize|slot|channel|twists|entrants|runnersup|hungriest)\}/g, (_, k) => ({
    viewer: r.viewer || 'A viewer',
    prize: prizeText(r) || 'the round',
    slot: r.slot ?? '',
    channel: twitch.session?.name || '',
    twists: (r.twists || []).map((t) => ` → ${twistLabel(t)}`).join(''),
    entrants: r.entrants ?? '',
    runnersup: r.runnersUp?.length ? ` ${medals(r.runnersUp)}` : '',
    hungriest: r.hungriest ? `${r.hungriest.name} (${r.hungriest.count})` : '',
  })[k]);

  function announce(r) {
    if (!state.announce || !twitch.session) return;
    const tpl = { plinko: state.plinkoTemplate, hippos: state.hipposTemplate }[r.game] ?? state.wheelTemplate;
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
    const q = r.prizes[0]?.item.qty ?? 0;
    const color = r.prizes[0]?.color || '#F5B400';
    lastWinner = r;
    $('winName').textContent = r.game === 'hippos' ? `🏆 ${r.viewer}` : prizeText(r);
    $('winHead').style.background = color;
    $('winHead').style.color = U.textOn(color);
    const sub = r.game === 'plinko'
      ? [`Slot ${r.slot}`, r.viewer && `called by ${r.viewer}`, ...(r.twists || []).map(twistLabel)].filter(Boolean).join(' · ')
      : r.game === 'hippos'
        ? [r.prizes.length ? `wins ${prizeText(r)}` : null, `survived ${r.entrants} marbles`, medals(r.runnersUp)].filter(Boolean).join(' · ')
        : '';
    $('winSub').textContent = sub;
    $('winSub').hidden = !sub;
    $('winAgain').textContent = { plinko: 'Next drop', hippos: 'Play again' }[r.game] || 'Spin again';
    const remove = $('winRemove');
    const note = $('winNote');
    note.textContent = '';
    remove.hidden = false;
    if (!r.prizes.length) {
      // A Hippos round with no prizes in the list: nothing to take
      remove.hidden = true;
      lastWinner = null;
      $('winDialog').showModal();
      $('winAgain').focus();
      return;
    }
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
    : h.game === 'hippos'
      ? ['Hippos', h.entrants && `${h.entrants} marbles`, medals(h.runnersUp)].filter(Boolean).join(' · ')
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

  // ---------- Saved wheels ----------
  const entryCount = (n) => `${n} entr${n === 1 ? 'y' : 'ies'}`;

  function renderWheelBar() {
    $('wheelName').textContent = state.title || 'Untitled wheel';
    $('wheelMenuBtn').title = `Switch wheel (${wheels.length} saved)`;
  }

  // Refreshes everything that depends on which wheel is active
  function afterWheelChange() {
    lastWinner = null;
    app.closeDialog();
    editor.clearUndo();
    syncControls();
    rebuildAll();
    renderHistory();
    renderWheelBar();
    loadWheelLogo();
    save();
  }

  function switchWheel(id) {
    const w = wheels.find((x) => x.id === id);
    if (!w || id === activeId) return;
    if (busy()) return toast('Wait for the current round to finish');
    syncActive();
    loadWheel(w);
    afterWheelChange();
  }

  function newWheel(kind) {
    if (busy()) return toast('Wait for the current round to finish');
    syncActive();
    const copy = kind === 'copy';
    const w = {
      id: newWheelId(),
      name: uniqueName(copy ? `${state.title} copy` : `Wheel ${wheels.length + 1}`),
      items: copy ? U.sanitizeItems(JSON.parse(JSON.stringify(state.items))) : [],
      palette: state.palette, customColors: state.customColors, duration: state.duration, history: [],
    };
    if (copy) {
      const logo = readLogo(WHEEL_LOGO_KEY(activeId));
      if (logo) safe(() => localStorage.setItem(WHEEL_LOGO_KEY(w.id), logo));
    }
    wheels.splice(wheels.findIndex((x) => x.id === activeId) + 1, 0, w);
    loadWheel(w);
    afterWheelChange();
    startRename();
  }

  function deleteWheel() {
    if (wheels.length < 2) return toast("You can't delete your only wheel");
    if (busy()) return toast('Wait for the current round to finish');
    syncActive();
    const idx = wheels.findIndex((w) => w.id === activeId);
    const gone = wheels[idx];
    const logo = readLogo(WHEEL_LOGO_KEY(gone.id));
    wheels.splice(idx, 1);
    safe(() => localStorage.removeItem(WHEEL_LOGO_KEY(gone.id)));
    loadWheel(wheels[Math.min(idx, wheels.length - 1)]);
    afterWheelChange();
    toast(`Deleted “${gone.name}”`, {
      label: 'Undo',
      run: () => {
        if (busy() || wheels.includes(gone)) return;
        syncActive();
        wheels.splice(Math.min(idx, wheels.length), 0, gone);
        if (logo) safe(() => localStorage.setItem(WHEEL_LOGO_KEY(gone.id), logo));
        loadWheel(gone);
        afterWheelChange();
      },
    });
  }

  function setWheelName(name) {
    state.title = name;
    $('title').value = name;
    document.title = name || 'Prize Wheel';
    renderWheelBar();
    games.plinko.draw();
    save();
  }
  function startRename() {
    const input = $('wheelRename');
    input.value = state.title;
    $('wheelMenuBtn').hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }
  function finishRename(keep) {
    const input = $('wheelRename');
    if (input.hidden) return;
    const name = input.value.trim().slice(0, 80);
    input.hidden = true;
    $('wheelMenuBtn').hidden = false;
    if (keep && name && name !== state.title) setWheelName(name);
  }

  function renderWheelMenu() {
    syncActive();
    const menu = $('wheelMenu');
    menu.innerHTML = '';
    for (const w of wheels) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.dataset.id = w.id;
      if (w.id === activeId) b.setAttribute('aria-current', 'true');
      b.innerHTML = '<span class="wb-check"></span><span class="wb-name"></span><span class="wb-count"></span>';
      b.querySelector('.wb-check').textContent = w.id === activeId ? '✓' : '';
      b.querySelector('.wb-name').textContent = w.name;
      b.querySelector('.wb-count').textContent = entryCount(w.items.length);
      menu.appendChild(b);
    }
    menu.insertAdjacentHTML('beforeend', `<hr>
      <button role="menuitem" data-act="rename">Rename this wheel</button>
      <button role="menuitem" data-act="copy">Duplicate this wheel</button>
      <button role="menuitem" data-act="delete" class="danger" ${wheels.length < 2 ? 'disabled title="You need at least one wheel"' : ''}>Delete this wheel</button>`);
  }

  // Dropdown menus in the wheel bar
  function setMenu(menu, btn, open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button:not([disabled])')?.focus();
  }
  function closeMenus() {
    setMenu($('wheelMenu'), $('wheelMenuBtn'), false);
    setMenu($('newWheelMenu'), $('newWheelBtn'), false);
  }

  // ---------- Logos ----------
  // The wheel-center logo belongs to each wheel; the Plinko logos are app-wide
  const logoKey = (spot, wheelId = activeId) => (spot === 'wheelCenter' ? WHEEL_LOGO_KEY(wheelId) : LOGO_KEY(spot));
  const readLogo = (key) => safe(() => localStorage.getItem(key), null);

  async function setLogoUpload(spot, dataUrl, persist = true) {
    const forWheel = activeId;
    let img;
    try { img = await U.loadImage(dataUrl); } catch { return; }
    if (spot === 'wheelCenter' && forWheel !== activeId) return;   // switched wheels while loading
    logoUploads[spot] = img;
    if (persist && !safe(() => { localStorage.setItem(logoKey(spot, forWheel), dataUrl); return true; }, false)) {
      toast('Image is too large to remember after reload');
    }
    refreshLogos();
  }
  function clearLogoUpload(spot) {
    delete logoUploads[spot];
    safe(() => localStorage.removeItem(logoKey(spot)));
    refreshLogos();
  }
  // Shows the active wheel's own center logo (or none)
  function loadWheelLogo() {
    delete logoUploads.wheelCenter;
    const data = readLogo(logoKey('wheelCenter'));
    if (data) setLogoUpload('wheelCenter', data, false);
    else refreshLogos();
  }
  function loadLogos() {
    // Older saves had one app-wide wheel-center upload; it becomes the first wheel's logo
    for (const old of [LOGO_KEY('wheelCenter'), OLD_LOGO_KEY]) {
      const data = readLogo(old);
      if (!data) continue;
      if (!readLogo(WHEEL_LOGO_KEY(wheels[0].id))) safe(() => localStorage.setItem(WHEEL_LOGO_KEY(wheels[0].id), data));
      safe(() => localStorage.removeItem(old));
    }
    for (const spot of Object.keys(SPOTS)) {
      if (spot === 'wheelCenter') continue;
      const data = readLogo(logoKey(spot));
      if (data) setLogoUpload(spot, data, false);
    }
    loadWheelLogo();
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
    games.hippos.refresh();   // its chat hint depends on the Twitch connection
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
    $('hipposTemplate').value = state.hipposTemplate;
    $('hipCommand').value = state.hipposCommand;
    $('hipEntrySecs').value = state.hipposEntrySecs;
    $('hipEntrySecsVal').textContent = `${state.hipposEntrySecs}s`;
    U.setSeg('hipLength', state.hipposLength);
    $('hipTheme').value = state.hipposTheme;
    renderHippoNames();
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

  // Four name boxes for the current creature theme; blank means the theme's default name
  function renderHippoNames() {
    const th = PW.HIPPO_THEMES[state.hipposTheme];
    const custom = state.hipposNames[state.hipposTheme] || [];
    $('hipNames').innerHTML = '';
    th.names.forEach((def, i) => {
      const input = document.createElement('input');
      input.type = 'text'; input.maxLength = 24; input.dataset.i = i;
      input.placeholder = def; input.value = custom[i] || '';
      input.setAttribute('aria-label', `Creature ${i + 1} name`);
      $('hipNames').appendChild(input);
    });
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

    // The header title is the active wheel's name
    $('title').addEventListener('input', () => {
      state.title = $('title').value;
      document.title = state.title || 'Prize Wheel';
      renderWheelBar();
      games.plinko.draw();
      save();
    });

    // Saved-wheels bar
    $('wheelMenuBtn').onclick = (e) => {
      e.stopPropagation();
      const open = $('wheelMenu').hidden;
      closeMenus();
      if (open) { renderWheelMenu(); setMenu($('wheelMenu'), $('wheelMenuBtn'), true); }
    };
    $('newWheelBtn').onclick = (e) => {
      e.stopPropagation();
      const open = $('newWheelMenu').hidden;
      closeMenus();
      if (open) setMenu($('newWheelMenu'), $('newWheelBtn'), true);
    };
    $('wheelMenu').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      closeMenus();
      if (b.dataset.id) switchWheel(b.dataset.id);
      else if (b.dataset.act === 'rename') startRename();
      else if (b.dataset.act === 'copy') newWheel('copy');
      else if (b.dataset.act === 'delete') deleteWheel();
    };
    $('newWheelMenu').onclick = (e) => {
      const b = e.target.closest('button[data-new]');
      if (!b) return;
      closeMenus();
      newWheel(b.dataset.new);
    };
    $('wheelRenameBtn').onclick = startRename;
    $('wheelRename').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishRename(true); $('wheelMenuBtn').focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); finishRename(false); $('wheelMenuBtn').focus(); }
    });
    $('wheelRename').addEventListener('blur', () => finishRename(true));
    document.addEventListener('click', (e) => { if (!e.target.closest('.wb-menu')) closeMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.closest?.('.wb-pop')) { closeMenus(); } });

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
      row.querySelector('[data-act=clear]').onclick = () => clearLogoUpload(spot);
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
    $('hipposTemplate').oninput = () => { state.hipposTemplate = $('hipposTemplate').value; save(); };

    // Hungry Hippos settings
    for (const [k, t] of Object.entries(PW.HIPPO_THEMES)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = `${t.icon} ${t.label}`;
      $('hipTheme').appendChild(o);
    }
    $('hipCommand').oninput = () => {
      // One word, e.g. !join or !hippo
      state.hipposCommand = $('hipCommand').value.trim().split(/\s+/)[0] || '!join';
      save(); games.hippos.refresh();
    };
    $('hipEntrySecs').oninput = () => {
      state.hipposEntrySecs = +$('hipEntrySecs').value;
      $('hipEntrySecsVal').textContent = `${state.hipposEntrySecs}s`;
      save();
    };
    segGroup('hipLength', 'hipposLength');
    $('hipTheme').onchange = () => { state.hipposTheme = $('hipTheme').value; renderHippoNames(); save(); games.hippos.draw(); };
    $('hipNames').addEventListener('input', (e) => {
      const i = +e.target.dataset.i;
      if (Number.isNaN(i)) return;
      const names = (state.hipposNames[state.hipposTheme] ||= ['', '', '', '']);
      names[i] = e.target.value.slice(0, 24);
      save(); games.hippos.draw();
    });
    $('testChat').onclick = async () => {
      if (await twitch.say('✅ Prize Wheel is connected to chat.')) toast('Test message sent');
    };

    // Backup
    // Backups hold every saved wheel (uploaded images stay in this browser)
    $('backupBtn').onclick = () => {
      syncActive();
      const { items, ...settings } = state;
      U.download(`${slug()}.json`, JSON.stringify({ app: 'prize-wheel', version: 4, ...settings, wheels, activeWheel: activeId }, null, 2), 'application/json');
    };
    $('restoreBtn').onclick = () => $('restoreFile').click();
    $('restoreFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (busy()) return toast('Wait for the current round to finish');
        if (!loadWheels(data)) throw new Error('No wheels in backup');
        applyData(data);
        afterWheelChange();
        switchGame(state.game);
        toast(`Backup restored (${wheels.length} wheel${wheels.length === 1 ? '' : 's'})`);
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
      copy(`${base}#w=${U.encodeJSON(data)}`, `Share link for “${state.title}” copied`);
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
  games.hippos.reset();   // picks up the saved players
  Object.values(games).forEach((g) => g.rebuild());
  switchGame(state.game);
  renderHistory();
  renderWheelBar();
  loadLogos();
  save();
  if (openedShare) toast(`Opened the shared wheel “${state.title}” as a new saved wheel`);
  twitch.handleRedirect().then((handled) => { if (!handled) twitch.validate(); });
})();
