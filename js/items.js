/* Entry list editor shared by every game: add with a quantity, −/+ steppers, mode toggle,
   rename, list tools and per-game undo. */
(() => {
  'use strict';
  const PW = window.PW;
  const { $, rand, clampQty, makeItem, itemsFromText, toast, setSeg } = PW.util;

  // host: {
  //   key()               active game key
  //   items(key)          that game's item array; setItems(key, arr) replaces it
  //   unit(key)           { one: 'slice', many: 'slices' }
  //   colorOf(id)         dot color for an item in the active game
  //   presets()           { value: { label, make() } } for the active game
  //   addMode()           'count' | 'split'; setAddMode(v)
  //   changed(key)        rebuild that game and save
  // }
  PW.createItemEditor = (host) => {
    const list = $('itemList'), addName = $('addName'), addQty = $('addQty');
    const modeRow = $('addModeRow'), modeHint = $('addModeHint'), undoBtn = $('undoBtn');
    const presetSel = $('presetSel');
    const stacks = {};
    const stack = (k = host.key()) => (stacks[k] ||= []);
    const items = () => host.items(host.key());

    function pushUndo(k = host.key()) {
      const s = stack(k);
      s.push(JSON.stringify(host.items(k)));
      if (s.length > 50) s.shift();
    }

    // Call after any change to a game's items.
    function commit(k = host.key()) {
      host.changed(k);
      if (k === host.key()) render();
    }

    function takeOne(item, k) {
      if (!item || !host.items(k).includes(item) || item.qty <= 0) return;
      pushUndo(k);
      item.qty -= 1;
      commit(k);
    }

    function render() {
      undoBtn.disabled = !stack().length;
      const unit = host.unit(host.key());
      // Keep keyboard focus on the same control across re-renders
      const active = document.activeElement;
      const focusRow = active?.closest?.('.item')?.dataset.id;
      const focusRole = active?.dataset?.role;

      list.innerHTML = '';
      const all = items();
      if (!all.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No entries yet. Add one above.';
        list.appendChild(li);
        return;
      }
      for (const it of all) {
        const li = document.createElement('li');
        li.className = 'item' + (it.qty === 0 ? ' out' : '');
        li.dataset.id = it.id;
        li.innerHTML = `
          <span class="dot"></span>
          <input class="iname" data-role="name" aria-label="Entry name" maxlength="120">
          <button class="mode-btn" data-role="mode"></button>
          <span class="qty">
            <button data-role="dec" aria-label="One fewer">−</button>
            <input type="number" min="0" max="999" data-role="qty" aria-label="Quantity">
            <button data-role="inc" aria-label="One more">+</button>
          </span>
          <button class="del" data-role="del" aria-label="Delete entry" title="Delete">×</button>`;
        li.querySelector('.dot').style.background = host.colorOf(it.id) || 'transparent';
        li.querySelector('.iname').value = it.name;
        li.querySelector('[data-role=qty]').value = it.qty;
        const mode = li.querySelector('.mode-btn');
        if (it.start > 1 || it.qty > 1) {
          mode.textContent = it.mode === 'split' ? 'Separate' : `1 ${unit.one}`;
          mode.title = it.mode === 'split'
            ? `${it.qty} separate ${unit.many}. Click to make it one ${unit.one} with a count.`
            : `One ${unit.one} with a count. Click to use separate ${unit.many}.`;
        } else {
          mode.hidden = true;
        }
        list.appendChild(li);
      }
      if (focusRow && focusRole) list.querySelector(`[data-id="${focusRow}"] [data-role="${focusRole}"]`)?.focus();
    }

    function renderAddMode() {
      const qty = clampQty(addQty.value);
      const unit = host.unit(host.key());
      const mode = host.addMode();
      modeRow.hidden = qty <= 1;
      document.querySelector('#addMode [data-v=count]').textContent = `One ${unit.one} with a count`;
      document.querySelector('#addMode [data-v=split]').textContent = `Separate ${unit.many}`;
      setSeg('addMode', mode);
      modeHint.textContent = mode === 'split'
        ? `${qty} ${unit.many} spread out. More ${unit.many} mean better odds, and each win removes one.`
        : `One ${unit.one} labelled ×${qty}. Each win takes one off the count.`;
    }

    function populatePresets() {
      presetSel.innerHTML = '<option value="">Load preset…</option>';
      for (const [value, p] of Object.entries(host.presets())) {
        const o = document.createElement('option');
        o.value = value; o.textContent = p.label;
        presetSel.appendChild(o);
      }
    }

    // ---------- Add entry ----------
    $('addForm').onsubmit = (e) => {
      e.preventDefault();
      const name = addName.value.trim();
      if (!name) { addName.focus(); return; }
      const qty = clampQty(addQty.value) || 1;
      pushUndo();
      items().push(makeItem(name, qty, host.addMode()));
      commit();
      addName.value = '';
      addQty.value = 1;
      renderAddMode();
      addName.focus();
      list.lastElementChild?.scrollIntoView({ block: 'nearest' });
    };
    addQty.addEventListener('input', renderAddMode);
    document.querySelectorAll('#addMode button').forEach((b) => b.onclick = () => { host.setAddMode(b.dataset.v); renderAddMode(); });

    // ---------- Entry list (event delegation) ----------
    const itemOf = (el) => items().find((it) => it.id === el.closest('.item')?.dataset.id);
    let nameSnapshot = null;
    list.addEventListener('focusin', (e) => {
      if (e.target.dataset.role === 'name') nameSnapshot = JSON.stringify(items());
    });
    list.addEventListener('input', (e) => {
      if (e.target.dataset.role !== 'name') return;
      const it = itemOf(e.target);
      if (!it) return;
      it.name = e.target.value;
      host.changed(host.key());
    });
    list.addEventListener('change', (e) => {
      const it = itemOf(e.target);
      if (!it) return;
      if (e.target.dataset.role === 'name') {
        const name = e.target.value.trim();
        if (!name) {
          // An emptied name reverts instead of leaving a blank slice
          it.name = (nameSnapshot && JSON.parse(nameSnapshot).find((x) => x.id === it.id)?.name) || 'Untitled';
          commit();
          return;
        }
        if (nameSnapshot) { stack().push(nameSnapshot); nameSnapshot = JSON.stringify(items()); }
        it.name = name;
        commit();
      } else if (e.target.dataset.role === 'qty') {
        pushUndo();
        it.qty = it.start = clampQty(e.target.value);
        commit();
      }
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
    });
    list.addEventListener('click', (e) => {
      const role = e.target.dataset.role;
      const it = itemOf(e.target);
      if (!it || !role) return;
      if (role === 'inc' || role === 'dec') {
        const next = clampQty(it.qty + (role === 'inc' ? 1 : -1));
        if (next === it.qty) return;
        pushUndo();
        // Setting the quantity by hand also sets what "Reset counts" returns to
        it.qty = it.start = next;
        commit();
      } else if (role === 'mode') {
        pushUndo();
        it.mode = it.mode === 'split' ? 'count' : 'split';
        commit();
      } else if (role === 'del') {
        pushUndo();
        host.setItems(host.key(), items().filter((x) => x !== it));
        commit();
      }
    });

    // ---------- Toolbar ----------
    $('shuffleBtn').onclick = () => {
      const l = items();
      if (l.length < 2) return;
      pushUndo();
      for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
      commit();
    };
    $('sortBtn').onclick = () => {
      if (items().length < 2) return;
      pushUndo();
      items().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      commit();
    };
    $('dedupeBtn').onclick = () => {
      const byName = new Map(), out = [];
      for (const it of items()) {
        const k = it.name.trim().toLowerCase();
        const first = byName.get(k);
        if (first) { first.qty += it.qty; first.start += it.start; }
        else { const copy = { ...it }; byName.set(k, copy); out.push(copy); }
      }
      const merged = items().length - out.length;
      if (!merged) return toast('No duplicates found');
      pushUndo();
      out.forEach((it) => { it.qty = clampQty(it.qty); it.start = Math.max(it.qty, clampQty(it.start)); });
      host.setItems(host.key(), out);
      commit();
      toast(`Merged ${merged} duplicate${merged === 1 ? '' : 's'} into their counts`);
    };
    $('resetCountsBtn').onclick = () => {
      if (!items().some((it) => it.qty !== it.start)) return toast('Counts are already full');
      pushUndo();
      items().forEach((it) => { it.qty = it.start; });
      commit();
      toast('Counts reset');
    };
    $('clearBtn').onclick = () => {
      if (!items().length) return;
      pushUndo();
      host.setItems(host.key(), []);
      commit();
      toast('Cleared. Undo is available.');
    };
    undoBtn.onclick = () => {
      const s = stack();
      if (!s.length) return;
      host.setItems(host.key(), JSON.parse(s.pop()));
      commit();
    };
    presetSel.onchange = () => {
      const p = host.presets()[presetSel.value];
      presetSel.value = '';
      if (!p) return;
      pushUndo();
      host.setItems(host.key(), p.make());
      commit();
    };

    // ---------- Paste a list ----------
    const pastePanel = $('pastePanel'), pasteText = $('pasteText');
    $('pasteBtn').onclick = () => { pastePanel.hidden = !pastePanel.hidden; if (!pastePanel.hidden) pasteText.focus(); };
    $('pasteCancel').onclick = () => { pastePanel.hidden = true; pasteText.value = ''; };
    $('pasteAdd').onclick = () => {
      const added = itemsFromText(pasteText.value);
      if (!added.length) return pasteText.focus();
      pushUndo();
      items().push(...added);
      commit();
      pastePanel.hidden = true; pasteText.value = '';
      toast(`Added ${added.length} entr${added.length === 1 ? 'y' : 'ies'}`);
    };

    // ---------- Import .txt / .csv ----------
    $('importBtn').onclick = () => $('importFile').click();
    $('importFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const text = await f.text();
      const isCsv = /\.csv$/i.test(f.name);
      const names = text.split(/\r?\n/).map((row) => {
        if (!isCsv) return row.trim();
        // First column only; handles quoted cells
        const m = /^\s*(?:"((?:[^"]|"")*)"|([^,]*))/.exec(row);
        return (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]).trim();
      }).filter(Boolean);
      pushUndo();
      items().push(...itemsFromText(names.join('\n')));
      commit();
      toast(`Imported ${names.length} entr${names.length === 1 ? 'y' : 'ies'}`);
    };

    return { render, renderAddMode, populatePresets, takeOne };
  };
})();
