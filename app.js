/* WiCyS Eboard Availability — a small When2Meet-style poll.
 * Data model (Firebase Realtime Database, or localStorage in demo mode):
 *   polls/{id}/meta              { title, mode: 'dates'|'weekly', days: [...], start, end, step, tz, created }
 *   polls/{id}/responses/{key}   { name, slots: '0101…', updated }
 * slots is one character per cell, ordered day by day: index = dayIndex * slotsPerDay + slotIndex.
 */
(() => {
  'use strict';

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const $app = document.getElementById('app');

  // ---------- storage ----------
  const Store = (() => {
    const cfg = window.FIREBASE_CONFIG;
    if (cfg && window.firebase) {
      firebase.initializeApp(cfg);
      const db = firebase.database();
      const watch = (path, cb) => {
        const ref = db.ref(path);
        const h = (snap) => cb(snap.val());
        ref.on('value', h, (err) => toast('Could not load data: ' + err.message));
        return () => ref.off('value', h);
      };
      return {
        live: true,
        watchPolls: (cb) => watch('polls', (v) => cb(v || {})),
        watchPoll: (id, cb) => watch('polls/' + id, cb),
        async createPoll(meta) {
          const ref = db.ref('polls').push();
          await ref.child('meta').set(meta);
          return ref.key;
        },
        saveResponse: (id, key, val) => db.ref(`polls/${id}/responses/${key}`).set(val),
        deleteResponse: (id, key) => db.ref(`polls/${id}/responses/${key}`).remove(),
      };
    }

    // Demo mode: everything lives in this browser's localStorage.
    const KEY = 'wicys-demo-db';
    const listeners = new Set();
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { polls: {} }; } catch { return { polls: {} }; } };
    const write = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} listeners.forEach((l) => l()); };
    window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((l) => l()); });
    const watch = (get, cb) => {
      const l = () => cb(get(read()));
      listeners.add(l); setTimeout(l, 0);
      return () => listeners.delete(l);
    };
    return {
      live: false,
      watchPolls: (cb) => watch((db) => db.polls || {}, cb),
      watchPoll: (id, cb) => watch((db) => (db.polls || {})[id] || null, cb),
      async createPoll(meta) {
        const db = read();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        db.polls[id] = { meta };
        write(db);
        return id;
      },
      async saveResponse(id, key, val) {
        const db = read();
        const p = db.polls[id]; if (!p) return;
        (p.responses = p.responses || {})[key] = val;
        write(db);
      },
      async deleteResponse(id, key) {
        const db = read();
        const p = db.polls[id]; if (p && p.responses) delete p.responses[key];
        write(db);
      },
    };
  })();

  if (!Store.live) document.getElementById('mode-badge').hidden = false;

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameKey = (n) => n.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.#$\[\]\/]/g, '_');
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const fmtTime = (mins, short) => {
    const h = Math.floor(mins / 60) % 24, m = mins % 60;
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    if (short && m === 0) return `${h12} ${ap}`;
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayLabel = (meta, day) => {
    if (meta.mode === 'weekly') return { top: day, sub: '' };
    const d = parseDate(day);
    return {
      top: d.toLocaleDateString(undefined, { weekday: 'short' }),
      sub: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    };
  };
  const dayLong = (meta, day) => meta.mode === 'weekly'
    ? ({ Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays', Sun: 'Sundays' }[day] || day)
    : parseDate(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- routing ----------
  let cleanup = () => {};
  function route() {
    cleanup(); cleanup = () => {};
    const id = new URLSearchParams(location.search).get('p');
    if (id) renderPoll(id); else renderHome();
  }
  window.addEventListener('popstate', route);
  const go = (url) => { history.pushState(null, '', url); route(); window.scrollTo(0, 0); };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });

  // ---------- home ----------
  function renderHome() {
    document.title = 'WiCyS Eboard Availability';
    const today = new Date();
    const hourOpts = (sel) => Array.from({ length: 25 }, (_, h) =>
      `<option value="${h * 60}" ${h * 60 === sel ? 'selected' : ''}>${h === 24 ? '12 AM (midnight)' : fmtTime(h * 60, true)}</option>`).join('');

    $app.innerHTML = `
      <div class="stack">
        <div>
          <h1>Find a time that works</h1>
          <p class="muted">Make a poll, drop the link in the gc, and everyone taps the times they're free. The best times show up automatically.</p>
        </div>
        <div class="grid-2">
          <form class="card stack" id="create">
            <h2>New poll</h2>
            <div class="field">
              <label for="title">What's it for?</label>
              <input type="text" id="title" maxlength="100" placeholder="e.g. Eboard meeting, Fall CTF night" required>
            </div>
            <div>
              <label>Which days?</label>
              <div class="seg" role="group" aria-label="Poll type">
                <button type="button" data-mode="dates" aria-pressed="true">Pick a date</button>
                <button type="button" data-mode="weekly" aria-pressed="false">Weekly</button>
              </div>
              <p class="muted small" id="mode-hint" style="margin:6px 0 0">For a one-time meeting or event.</p>
            </div>
            <div id="dates-fields" class="stack">
              <div id="date-list" class="date-list"></div>
              <div><button type="button" class="btn ghost sm" id="add-date">+ Add another date</button></div>
            </div>
            <div id="weekly-fields" hidden>
              <div class="chips">${WEEKDAYS.map((d, i) => `<button type="button" class="chip" data-wd="${d}" aria-pressed="${i < 5}">${d}</button>`).join('')}</div>
            </div>
            <div class="row">
              <div class="field"><label for="start">No earlier than</label><select id="start">${hourOpts(9 * 60)}</select></div>
              <div class="field"><label for="end">No later than</label><select id="end">${hourOpts(21 * 60)}</select></div>
            </div>
            <p class="error small" id="create-err" hidden></p>
            <div><button class="btn" type="submit">Create poll</button></div>
          </form>
          <section class="card stack">
            <h2>Recent polls</h2>
            <div id="polls"><p class="muted">Loading…</p></div>
          </section>
        </div>
      </div>`;

    let mode = 'dates';
    const form = $app.querySelector('#create');
    form.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      form.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      form.querySelector('#dates-fields').hidden = mode !== 'dates';
      form.querySelector('#weekly-fields').hidden = mode !== 'weekly';
      form.querySelector('#mode-hint').textContent = mode === 'dates'
        ? 'For a one-time meeting or event.' : 'For a recurring weekly meeting time.';
    }));
    form.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () =>
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true')));

    // One date by default; "+ Add another date" for the occasional multi-day poll.
    const dateList = form.querySelector('#date-list');
    const addDate = (value) => {
      const row = document.createElement('div');
      row.className = 'date-row';
      const n = dateList.children.length + 1;
      row.innerHTML = `<input type="date" aria-label="Date ${n}" value="${value || ''}">` +
        (n > 1 ? '<button type="button" class="btn subtle sm" aria-label="Remove this date">✕</button>' : '');
      const rm = row.querySelector('button');
      if (rm) rm.addEventListener('click', () => row.remove());
      dateList.appendChild(row);
      return row.querySelector('input');
    };
    addDate(isoDate(today));
    form.querySelector('#add-date').addEventListener('click', () => {
      const inputs = dateList.querySelectorAll('input');
      const last = inputs[inputs.length - 1].value;
      let next = '';
      if (last) { const d = parseDate(last); d.setDate(d.getDate() + 1); next = isoDate(d); }
      addDate(next).focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('#create-err');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      const title = form.querySelector('#title').value.trim();
      const start = +form.querySelector('#start').value, end = +form.querySelector('#end').value;
      if (!title) return fail('Give the poll a name.');
      if (end <= start) return fail('The end time needs to be after the start time.');
      let days;
      if (mode === 'dates') {
        days = [...new Set([...dateList.querySelectorAll('input')].map((i) => i.value).filter(Boolean))].sort();
        if (!days.length) return fail('Pick a date.');
        if (days.length > 31) return fail('Keep it to 31 dates or fewer.');
      } else {
        days = [...form.querySelectorAll('[data-wd][aria-pressed=true]')].map((b) => b.dataset.wd);
        if (!days.length) return fail('Pick at least one day.');
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const id = await Store.createPoll({ title, mode, days, start, end, step: 30, tz: myTz(), created: Date.now() });
        go('?p=' + encodeURIComponent(id));
      } catch (ex) {
        btn.disabled = false; btn.textContent = 'Create poll';
        fail('Could not create the poll: ' + ex.message);
      }
    });

    cleanup = Store.watchPolls((polls) => {
      const el = $app.querySelector('#polls'); if (!el) return;
      const list = Object.entries(polls).filter(([, p]) => p && p.meta)
        .sort((a, b) => (b[1].meta.created || 0) - (a[1].meta.created || 0)).slice(0, 25);
      if (!list.length) { el.innerHTML = '<p class="muted">No polls yet. Make the first one!</p>'; return; }
      el.innerHTML = `<ul class="poll-list">${list.map(([id, p]) => {
        const n = Object.keys(p.responses || {}).length;
        const when = p.meta.mode === 'weekly' ? 'Weekly' : p.meta.days.map((d) => dayLong(p.meta, d)).join(', ');
        return `<li><a href="?p=${encodeURIComponent(id)}" data-nav><span><strong>${esc(p.meta.title)}</strong><br><span class="muted small">${esc(when)}</span></span><span class="muted small">${n} ${n === 1 ? 'response' : 'responses'}</span></a></li>`;
      }).join('')}</ul>`;
    });
  }

  // ---------- poll ----------
  function renderPoll(id) {
    let poll = null;            // latest data from the store
    let meta = null, S = 0, D = 0;
    let me = null;              // { name, key }
    let mine = null;            // Uint8Array of my slots
    let dirty = false, saveTimer = null;
    let excluded = new Set();   // response keys left out of the group view
    let minLen = 2;             // best-times minimum length, in slots
    let built = false;

    $app.innerHTML = '<p class="muted">Loading poll…</p>';

    const unwatch = Store.watchPoll(id, (data) => {
      poll = data;
      if (!data || !data.meta) {
        $app.innerHTML = `<div class="card stack"><h2>Poll not found</h2><p class="muted">The link might be wrong or the poll was removed.</p><p><a href="./" data-nav>← Back to all polls</a></p></div>`;
        built = false;
        return;
      }
      if (!built) build(data.meta);
      if (me && !dirty) loadMine();
      refreshGroup();
    });
    cleanup = () => { unwatch(); if (dirty) flush(); };

    function build(m) {
      meta = m; D = meta.days.length; S = (meta.end - meta.start) / meta.step;
      document.title = meta.title + ' · WiCyS';
      const tzNote = meta.tz ? `Times are in ${esc(meta.tz.replace(/_/g, ' '))}` : '';
      const tzWarn = meta.tz && myTz() && meta.tz !== myTz()
        ? ` <span class="error">(your device is set to ${esc(myTz().replace(/_/g, ' '))})</span>` : '';
      const span = meta.mode === 'weekly'
        ? meta.days.join(', ')
        : meta.days.map((d) => dayLong(meta, d)).join(', ');

      $app.innerHTML = `
        <div class="stack">
          <p style="margin:0"><a href="./" data-nav class="small">← All polls</a></p>
          <div class="poll-head">
            <div>
              <h1>${esc(meta.title)}</h1>
              <p class="muted" style="margin:4px 0 0">${esc(span)} · ${fmtTime(meta.start)} – ${fmtTime(meta.end)}<br><span class="small">${tzNote}${tzWarn}</span></p>
            </div>
            <div class="share">
              <button class="btn" id="copy">Copy link for the gc</button>
            </div>
          </div>
          <div class="grid-2">
            <section class="card stack" id="mine-card"></section>
            <section class="card stack">
              <div class="poll-head">
                <h2>Group availability</h2>
                <div class="legend" id="legend"></div>
              </div>
              <div class="who" id="who"><span class="muted">Tap a time to see who's free.</span></div>
              <div id="group" class="group-list"></div>
            </section>
          </div>
          <section class="card stack">
            <div class="poll-head">
              <h2>Best times</h2>
              <div class="row" style="align-items:center">
                <label for="minlen" style="margin:0" class="muted small">At least</label>
                <select id="minlen" style="width:auto">
                  ${[1, 2, 3, 4, 6].map((n) => `<option value="${n}" ${n === minLen ? 'selected' : ''}>${n * meta.step >= 60 ? (n * meta.step / 60) + ' hr' : n * meta.step + ' min'}</option>`).join('')}
                </select>
              </div>
            </div>
            <div id="best"></div>
          </section>
          <section class="card stack">
            <h2>Who's responded</h2>
            <p class="muted small" style="margin:4px 0 0">Tap someone to leave them out of the group view and best times.</p>
            <div class="people" id="people"></div>
          </section>
        </div>`;
      built = true;

      $app.querySelector('#copy').addEventListener('click', async () => {
        const url = location.origin + location.pathname + '?p=' + encodeURIComponent(id);
        try { await navigator.clipboard.writeText(url); toast('Link copied — paste it in the gc'); }
        catch { prompt('Copy this link:', url); }
      });
      $app.querySelector('#minlen').addEventListener('change', (e) => { minLen = +e.target.value; refreshGroup(); });

      buildGroupList($app.querySelector('#group'));
      wireGroup();

      const saved = ls.get('wicys-name-' + id) || null;
      if (saved) setMe(saved); else renderNameForm();
    }

    // --- my availability ---
    function renderNameForm() {
      const card = $app.querySelector('#mine-card');
      const last = ls.get('wicys-name') || '';
      card.innerHTML = `
        <h2>Your availability</h2>
        <form id="name-form" class="stack">
          <div class="field">
            <label for="name">Your name</label>
            <input type="text" id="name" maxlength="40" autocomplete="name" value="${esc(last)}" placeholder="First name is fine" required>
          </div>
          <p class="muted small" style="margin:6px 0 0">Already responded on another device? Use the same name to edit it.</p>
          <div><button class="btn" type="submit">Fill in my times</button></div>
        </form>`;
      card.querySelector('#name-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const n = card.querySelector('#name').value.trim();
        if (n) setMe(n);
      });
      card.querySelector('#name').focus();
    }

    function setMe(name) {
      me = { name, key: nameKey(name) };
      ls.set('wicys-name-' + id, name); ls.set('wicys-name', name);
      const card = $app.querySelector('#mine-card');
      card.innerHTML = `
        <div class="poll-head">
          <h2>Your availability</h2>
          <span class="save-state" id="save-state"></span>
        </div>
        <p class="muted small" style="margin:4px 0 0">Filling in as <strong>${esc(name)}</strong> · <a href="#" id="switch">not you?</a></p>
        <p class="hint">Tap <strong>every</strong> time you're free. Pick as many as you want. Tap again to undo.<br><span class="muted small">Each button is a ${meta.step}-minute block starting at that time. It saves automatically.</span></p>
        <div id="mine" class="picker"></div>
        <div class="row">
          <button class="btn ghost sm" id="remove">Remove my response</button>
        </div>`;
      buildPicker(card.querySelector('#mine'));
      loadMine();
      wireMine();
      card.querySelector('#switch').addEventListener('click', (e) => {
        e.preventDefault(); if (dirty) flush();
        me = null; mine = null; ls.set('wicys-name-' + id, '');
        renderNameForm();
      });
      card.querySelector('#remove').addEventListener('click', async () => {
        if (!confirm('Remove your response from this poll?')) return;
        clearTimeout(saveTimer); dirty = false;
        await Store.deleteResponse(id, me.key);
        me = null; mine = null; ls.set('wicys-name-' + id, '');
        renderNameForm(); toast('Your response was removed');
      });
    }

    function loadMine() {
      const r = poll && poll.responses && poll.responses[me.key];
      mine = new Uint8Array(D * S);
      if (r && r.slots) for (let i = 0; i < mine.length; i++) mine[i] = r.slots[i] === '1' ? 1 : 0;
      paintMine();
      const st = $app.querySelector('#save-state');
      if (st && r) st.textContent = 'Saved ✓';
    }

    function paintMine() {
      const g = $app.querySelector('#mine'); if (!g || !mine) return;
      g.querySelectorAll('.c').forEach((c) => {
        const on = mine[+c.dataset.i] === 1;
        c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', on);
      });
      g.querySelectorAll('[data-count]').forEach((el) => {
        const d = +el.dataset.count;
        let k = 0; for (let s = 0; s < S; s++) k += mine[d * S + s];
        el.textContent = k ? `${k} picked` : '';
      });
    }

    function wireMine() {
      const g = $app.querySelector('#mine');
      // Tap (or click) toggles one time. With a mouse you can also hold and sweep across several.
      let drag = null, suppressClick = false;
      const set = (c, val) => { mine[+c.dataset.i] = val; paintMine(); };
      g.addEventListener('pointerdown', (e) => {
        suppressClick = false;
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        const c = e.target.closest('.c'); if (!c) return;
        e.preventDefault();
        drag = { val: mine[+c.dataset.i] ? 0 : 1 };
        dirty = true; suppressClick = true;
        set(c, drag.val);
      });
      g.addEventListener('pointerover', (e) => {
        if (!drag) return;
        const c = e.target.closest('.c'); if (c) set(c, drag.val);
      });
      g.addEventListener('click', (e) => {
        const day = e.target.closest('[data-day-all], [data-day-none]');
        if (day) {
          const d = +(day.dataset.dayAll ?? day.dataset.dayNone);
          mine.fill(day.dataset.dayAll !== undefined ? 1 : 0, d * S, (d + 1) * S);
          paintMine(); queueSave(); return;
        }
        const c = e.target.closest('.c'); if (!c) return;
        if (suppressClick) { suppressClick = false; return; }
        set(c, mine[+c.dataset.i] ? 0 : 1);
        queueSave();
      });
      const up = () => { if (!drag) return; drag = null; queueSave(); };
      window.addEventListener('pointerup', up);
      const prev = cleanup;
      cleanup = () => { prev(); window.removeEventListener('pointerup', up); };
    }

    function queueSave() {
      dirty = true;
      const st = $app.querySelector('#save-state'); if (st) st.textContent = 'Saving…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 500);
      refreshGroup(); // show my change in the group view right away
    }

    async function flush() {
      clearTimeout(saveTimer);
      if (!me || !mine) { dirty = false; return; }
      const val = { name: me.name, slots: Array.from(mine).join(''), updated: Date.now() };
      dirty = false;
      try {
        await Store.saveResponse(id, me.key, val);
        const st = $app.querySelector('#save-state'); if (st) st.textContent = 'Saved ✓';
      } catch (ex) {
        dirty = true;
        const st = $app.querySelector('#save-state'); if (st) st.innerHTML = '<span class="error">Not saved — check your connection</span>';
        toast('Could not save: ' + ex.message);
      }
    }

    // --- markup: one block per day ---
    const cellAttrs = (d, s) => `data-d="${d}" data-s="${s}" data-i="${d * S + s}"`;

    function buildPicker(el) {
      el.innerHTML = meta.days.map((day, d) => `
        <div class="day-block">
          <div class="day-head">
            <strong>${esc(dayLong(meta, day))}</strong>
            <span class="day-tools"><span class="muted small" data-count="${d}"></span>
              <button type="button" class="link-btn" data-day-all="${d}">Select all</button>
              <button type="button" class="link-btn" data-day-none="${d}">Clear</button></span>
          </div>
          <div class="slots">${Array.from({ length: S }, (_, s) =>
            `<button type="button" class="slot c" aria-pressed="false" ${cellAttrs(d, s)}>${fmtTime(meta.start + s * meta.step)}</button>`).join('')}
          </div>
        </div>`).join('');
    }

    function buildGroupList(el) {
      el.innerHTML = meta.days.map((day, d) => `
        <div class="day-block">
          ${D > 1 ? `<div class="day-head"><strong>${esc(dayLong(meta, day))}</strong></div>` : ''}
          <div class="glist">${Array.from({ length: S }, (_, s) =>
            `<button type="button" class="grow c" ${cellAttrs(d, s)}>
               <span class="t">${fmtTime(meta.start + s * meta.step)}</span>
               <span class="bar"><span class="fill"></span></span>
               <span class="n"></span>
             </button>`).join('')}
          </div>
        </div>`).join('');
    }

    // --- group view ---
    function people() {
      // Everyone's responses, with my unsaved local edits swapped in.
      const out = [];
      const rs = (poll && poll.responses) || {};
      for (const [key, r] of Object.entries(rs)) {
        if (!r || !r.slots) continue;
        out.push({ key, name: r.name || key, slots: (me && key === me.key && mine) ? mine : Uint8Array.from(r.slots, (ch) => ch === '1' ? 1 : 0) });
      }
      if (me && mine && !rs[me.key] && mine.some((x) => x)) out.push({ key: me.key, name: me.name, slots: mine });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    let current = []; // included people, for hover lookups
    function refreshGroup() {
      if (!built || !meta) return;
      const all = people();
      current = all.filter((p) => !excluded.has(p.key));
      const n = current.length;
      const counts = new Uint16Array(D * S);
      current.forEach((p) => { for (let i = 0; i < counts.length; i++) counts[i] += p.slots[i]; });

      const g = $app.querySelector('#group');
      g.querySelectorAll('.c').forEach((c) => {
        const k = counts[+c.dataset.i];
        const fill = c.querySelector('.fill');
        fill.style.width = n ? `${(k / n) * 100}%` : '0';
        fill.classList.toggle('all', n > 0 && k === n);
        c.querySelector('.n').textContent = n ? `${k}/${n}` : '';
        c.classList.toggle('zero', !k);
      });

      $app.querySelector('#legend').textContent = n ? `${n} ${n === 1 ? 'person' : 'people'} so far` : '';

      const pe = $app.querySelector('#people');
      pe.innerHTML = all.length
        ? all.map((p) => `<button type="button" data-k="${esc(p.key)}" aria-pressed="${!excluded.has(p.key)}">${esc(p.name)}</button>`).join('')
        : '<span class="muted">Nobody yet. Be the first!</span>';
      pe.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.k;
        excluded.has(k) ? excluded.delete(k) : excluded.add(k);
        refreshGroup();
      }));

      renderBest();
    }

    function wireGroup() {
      const g = $app.querySelector('#group');
      const who = $app.querySelector('#who');
      let hot = null;
      const show = (c) => {
        if (hot) hot.classList.remove('hot');
        hot = c; c.classList.add('hot');
        const i = +c.dataset.i, d = +c.dataset.d, s = +c.dataset.s;
        const yes = current.filter((p) => p.slots[i]).map((p) => p.name);
        const no = current.filter((p) => !p.slots[i]).map((p) => p.name);
        const t = meta.start + s * meta.step;
        who.innerHTML = `<strong>${esc(dayLong(meta, meta.days[d]))}, ${fmtTime(t)} – ${fmtTime(t + meta.step)}</strong> · ${yes.length}/${current.length} free
          ${yes.length ? `<div class="names">${yes.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
          ${no.length ? `<div class="names no">${no.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}`;
      };
      g.addEventListener('pointerover', (e) => { const c = e.target.closest('.c'); if (c) show(c); });
      g.addEventListener('click', (e) => { const c = e.target.closest('.c'); if (c) show(c); });
    }

    function renderBest() {
      const el = $app.querySelector('#best');
      const n = current.length;
      if (!n) { el.innerHTML = '<p class="muted">Best times will show up once people fill in their availability.</p>'; return; }
      const L = Math.min(minLen, S);
      // For every window of L slots, who is free for the whole window? Merge neighbouring windows with the same group.
      const blocks = [];
      for (let d = 0; d < D; d++) {
        let run = null;
        for (let s = 0; s + L <= S; s++) {
          const who = current.filter((p) => { for (let k = 0; k < L; k++) if (!p.slots[d * S + s + k]) return false; return true; });
          const key = who.map((p) => p.key).join('|');
          if (run && run.key === key) { run.end = s + L; continue; }
          if (run && run.who.length) blocks.push(run);
          run = { d, start: s, end: s + L, key, who };
        }
        if (run && run.who.length) blocks.push(run);
      }
      blocks.sort((a, b) => b.who.length - a.who.length || (b.end - b.start) - (a.end - a.start) || a.d - b.d || a.start - b.start);
      const picked = [];
      for (const b of blocks) {
        if (picked.some((p) => p.d === b.d && b.start < p.end && p.start < b.end)) continue;
        picked.push(b);
        if (picked.length >= 6) break;
      }
      if (!picked.length) { el.innerHTML = '<p class="muted">No time slot that long works for anyone yet. Try a shorter length.</p>'; return; }
      el.innerHTML = `<ul class="best-list">${picked.map((b, idx) => {
        const missing = current.filter((p) => !b.who.includes(p));
        const all = missing.length === 0;
        return `<li data-idx="${idx}">
          <span class="count ${all ? 'all' : ''}">${b.who.length}/${n}</span>
          <span><strong>${esc(dayLong(meta, meta.days[b.d]))} · ${fmtTime(meta.start + b.start * meta.step)} – ${fmtTime(meta.start + b.end * meta.step)}</strong><br>
          <span class="muted small">${all ? 'Everyone is free 🎉' : 'Can’t make it: ' + missing.map((p) => esc(p.name)).join(', ')}</span></span>
        </li>`;
      }).join('')}</ul>`;
      const g = $app.querySelector('#group');
      const mark = (b) => {
        g.querySelectorAll('.c.best').forEach((c) => c.classList.remove('best'));
        if (b) for (let s = b.start; s < b.end; s++) g.querySelector(`.c[data-i="${b.d * S + s}"]`).classList.add('best');
      };
      el.querySelectorAll('li').forEach((li) => {
        const b = picked[+li.dataset.idx];
        li.addEventListener('pointerenter', () => mark(b));
        li.addEventListener('pointerleave', () => mark(null));
        li.addEventListener('click', () => mark(b));
      });
    }
  }

  route();
})();
