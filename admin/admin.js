(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p, name) => p + '-' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6);

  // Admin signs in to Firebase as this one account; the password is the only thing people type.
  // The database rules only let this account edit content or pause / add time to games.
  const ADMIN_EMAIL = 'admin@seeds-guess-who.web.app';

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth(), db = firebase.database();
  let offset = 0;
  db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
  const now = () => Date.now() + offset;

  let data = null, dirty = false;

  // Starter photos are files next to the game (uploads/...); new ones are stored inline as data URLs.
  const src = path => (/^(https?:|data:|blob:)/.test(path) ? path : '../' + path);

  const blobToDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });

  // Shrink to at most 480px on the long side, as JPEG, so the game loads fast.
  async function savePhoto(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return blobToDataUrl(jpg);
  }

  // Look a person up on Wikipedia (name, exact title or page link) and download the page's main photo.
  async function wikiLookup(query) {
    const m = /wikipedia\.org\/wiki\/([^?#]+)/.exec(query);
    const title = m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : query.trim();
    const q = async extra => {
      const u = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
        action: 'query', format: 'json', origin: '*', redirects: '1',
        prop: 'pageimages|description|info', piprop: 'thumbnail|original', pithumbsize: '800', inprop: 'url', ...extra,
      });
      const r = await fetch(u);
      if (!r.ok) throw new Error('Could not reach Wikipedia. Try again in a moment.');
      const j = await r.json();
      return (j.query && j.query.pages ? Object.values(j.query.pages) : []).filter(p => !('missing' in p));
    };
    let pages = await q({ titles: title });
    if (!pages.length) pages = await q({ generator: 'search', gsrsearch: title, gsrlimit: '1' });
    if (!pages.length) throw new Error(`No Wikipedia page found for “${query}”.`);
    const p = pages[0];
    const img = (p.thumbnail && p.thumbnail.source) || (p.original && p.original.source);
    if (!img) throw new Error(`“${p.title}” has no main photo on Wikipedia. Upload one instead.`);
    const r = await fetch(img);
    if (!r.ok) throw new Error('Could not download the Wikipedia photo. Try again.');
    return { title: p.title, description: p.description || '', pageUrl: p.fullurl, blob: await r.blob() };
  }

  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3500);
  }
  function setDirty(v = true) { dirty = v; $('#dirty').textContent = v ? 'Unsaved changes' : ''; }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- sign in ----------
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = '';
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await auth.signInWithEmailAndPassword(ADMIN_EMAIL, $('#pw').value);
      $('#pw').value = '';
    } catch (err) {
      const c = err.code || '';
      $('#loginErr').textContent =
        /wrong-password|invalid-credential|invalid-login|user-not-found/.test(c) ? 'That password isn’t right.'
        : /too-many-requests/.test(c) ? 'Too many tries. Wait a few minutes, then try again.'
        : /operation-not-allowed|configuration-not-found/.test(c) ? 'Admin sign-in isn’t switched on yet in Firebase.'
        : /network/.test(c) ? 'No internet connection. Check it and try again.'
        : 'Could not sign in. ' + (err.message || '');
    } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('#signout').addEventListener('click', () => {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    setDirty(false); auth.signOut();
  });
  auth.onAuthStateChanged(u => {
    if (u && u.email === ADMIN_EMAIL) start().catch(err => toast('Could not load the game data. ' + err.message, true));
    else { stopLive(); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
  });

  async function start() {
    const snap = await db.ref('content').get();
    data = snap.exists() ? snap.val() : await (await fetch('../data/data.json?v=' + Date.now(), { cache: 'no-store' })).json();
    data.people = Array.isArray(data.people) ? data.people : Object.values(data.people || {});
    data.questions = Array.isArray(data.questions) ? data.questions : Object.values(data.questions || {});
    data.people.forEach(p => { p.facts = Array.isArray(p.facts) ? p.facts : Object.values(p.facts || {}); });
    data.settings = data.settings || {};
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    renderPeople(); renderQuestions(); renderSettings(); setDirty(false);
    startLive();
  }

  // ---------- live games ----------
  let gamesRef = null, games = {}, liveTick = null;
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ago = t => { const m = Math.round((now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
  function roundOf(g) { return (g.rounds && g.rounds['r' + (g.round || 1)]) || {}; }
  function timerOf(g) { const t = roundOf(g).timer, total = (Number(g.mins) || 5) * 60000; return t || { total, left: total, endsAt: null }; }
  function remainingOf(g) { const t = timerOf(g); return t.endsAt ? Math.max(0, t.endsAt - now()) : t.left; }
  function started(g) { const t = timerOf(g); return !!t.endsAt || t.left < t.total; }
  function phaseOf(g) {
    const r = roundOf(g), lk = r.locked || {}, rv = r.reveal || {}, gs = r.guess || {};
    if (!(lk.p1 && lk.p2)) return ['Choosing people', ''];
    if (rv.p1 && rv.p2) return ['Round finished', 'ok'];
    if (gs.p1 || gs.p2) return ['Guessing', 'warn'];
    return ['Asking questions', 'ok'];
  }

  function startLive() {
    if (gamesRef) return;
    gamesRef = db.ref('games').orderByChild('created').startAt(Date.now() - 24 * 3600 * 1000);
    gamesRef.on('value', snap => { games = snap.val() || {}; renderGames(); }, err => toast('Could not load live games. ' + err.message, true));
    liveTick = setInterval(tickClocks, 500);
  }
  function stopLive() { if (gamesRef) gamesRef.off(); gamesRef = null; clearInterval(liveTick); }

  function renderGames() {
    const list = Object.entries(games).sort((a, b) => (b[1].created || 0) - (a[1].created || 0));
    if (!list.length) { $('#games').innerHTML = '<div class="empty-state">No games in the last 24 hours. Games appear here as soon as a player clicks “Start a new game”.</div>'; return; }
    $('#games').innerHTML = list.map(([code, g]) => {
      const pl = g.players || {}, [phase, tone] = phaseOf(g), t = timerOf(g), on = started(g), running = !!t.endsAt;
      const lockedIn = phase === 'Choosing people';
      const who = s => `<span><i class="dot ${pl[s] && pl[s].online ? 'on' : ''}"></i>${pl[s] ? esc(pl[s].name) : '<em style="color:var(--muted)">Not joined</em>'}</span>`;
      return `<div class="game" data-code="${code}">
        <div class="top"><span class="code">${code}</span><span class="age">Round ${g.round || 1} · started ${ago(g.created || now())}</span></div>
        <div class="who">${who('p1')}${who('p2')}</div>
        <div class="state"><span class="clock" data-clock="${code}">${fmt(remainingOf(g))}</span>
          <span class="pill ${tone}">${phase}</span><span>${!on ? 'Not started' : running ? 'Running' : remainingOf(g) > 0 ? 'Paused' : 'Time’s up'}</span></div>
        ${lockedIn || !on ? `<div class="stepper">Time limit <button data-act="minus" aria-label="Less time">−</button><b>${g.mins || 5} min</b><button data-act="plus" aria-label="More time">+</button></div>` : ''}
        <div class="ctl">
          ${!lockedIn ? (running ? '<button class="btn btn-ghost" data-act="pause">Pause</button>' : `<button class="btn btn-primary" data-act="resume">${on ? 'Resume' : 'Start'}</button>`) : ''}
          ${!lockedIn ? '<button class="btn btn-ghost" data-act="add">+1 min</button>' : ''}
          ${!lockedIn ? '<button class="btn btn-ghost" data-act="sub">−1 min</button>' : ''}
        </div>
      </div>`;
    }).join('');
  }

  function tickClocks() {
    document.querySelectorAll('[data-clock]').forEach(el => {
      const g = games[el.dataset.clock]; if (!g) return;
      const ms = remainingOf(g);
      el.textContent = fmt(ms);
      el.classList.toggle('low', ms > 0 && ms <= 60000);
      el.classList.toggle('done', started(g) && ms <= 0);
    });
  }

  $('#games').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const code = b.closest('.game').dataset.code, g = games[code]; if (!g) return;
    const act = b.dataset.act, base = `games/${code}`;
    if (act === 'minus' || act === 'plus') {
      const mins = Math.min(60, Math.max(1, (g.mins || 5) + (act === 'plus' ? 1 : -1)));
      const up = { [base + '/mins']: mins };
      return db.ref().update(up).catch(err => toast(err.message, true));
    }
    db.ref(`${base}/rounds/r${g.round || 1}/timer`).transaction(cur => {
      const t = cur || timerOf(g), rem = t.endsAt ? Math.max(0, t.endsAt - now()) : t.left;
      if (act === 'pause') return { total: t.total, left: rem, endsAt: null };
      if (act === 'resume') return rem > 0 ? { total: t.total, left: rem, endsAt: now() + rem } : t;
      const d = act === 'add' ? 60000 : -60000;
      if (act === 'sub' && rem <= 0) return t;
      const total = Math.max(60000, t.total + d), left = Math.max(0, rem + d);
      return t.endsAt ? { total, left, endsAt: now() + left } : { total, left, endsAt: null };
    }).catch(err => toast(err.message, true));
  });

  // ---------- tabs ----------
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
    $('#save').classList.toggle('hidden', b.dataset.tab === 'live');
    if (b.dataset.tab === 'questions') renderQuestions();
  }));

  // ---------- people ----------
  function renderPeople() {
    $('#people').innerHTML = data.people.map((p, i) => `
      <div class="person" data-i="${i}">
        <div>
          <div class="thumb">${p.image ? `<img src="${esc(src(p.image))}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : 'No photo'}</div>
          <div class="crop"><label>Photo position</label><input type="range" min="0" max="100" value="${Number(p.imageY ?? 20)}" data-k="imageY" aria-label="Vertical photo position"></div>
        </div>
        <div class="fields">
          <div><label class="f">Name</label><input class="input sm" data-k="name" value="${esc(p.name)}"></div>
          <div><label class="f">Position</label><input class="input sm" data-k="position" value="${esc(p.position)}"></div>
          <div><label class="f">Facts players see (one per line)</label><textarea class="input sm" data-k="facts" rows="4" placeholder="Two or three short facts">${esc((p.facts || []).join('\n'))}</textarea></div>
          <div>
            <label class="f">Photo</label>
            <input class="input sm" data-k="lookup" placeholder="Wikipedia name or link" value="${esc(p.name)}">
            <div class="imgtools">
              <button class="btn btn-ghost mini" data-act="fetch">Get from Wikipedia</button>
              <button class="btn btn-ghost mini" data-act="upload">Upload file</button>
            </div>
          </div>
          ${p.source ? `<div class="src">Source: <a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.source.replace(/^https?:\/\//, ''))}</a></div>` : ''}
          <div class="msg"></div>
          <div class="row-actions">
            <button class="linkish" data-act="left" ${i === 0 ? 'disabled' : ''}>Earlier</button>
            <button class="linkish" data-act="right" ${i === data.people.length - 1 ? 'disabled' : ''}>Later</button>
            <button class="linkish danger" data-act="delete" style="margin-left:auto">Remove</button>
          </div>
        </div>
      </div>`).join('') || '<p class="note">No people yet. Add one to get started.</p>';
  }

  $('#people').addEventListener('input', e => {
    const el = e.target, row = el.closest('.person'); if (!row || !el.dataset.k || el.dataset.k === 'lookup') return;
    const p = data.people[row.dataset.i];
    const k = el.dataset.k;
    p[k] = k === 'imageY' ? Number(el.value) : k === 'facts' ? el.value.split('\n').map(f => f.trim()).filter(Boolean) : el.value;
    if (el.dataset.k === 'imageY') { const img = row.querySelector('.thumb img'); if (img) img.style.objectPosition = `50% ${el.value}%`; }
    setDirty();
  });

  $('#people').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.k === 'lookup') { e.preventDefault(); e.target.closest('.person').querySelector('[data-act=fetch]').click(); }
  });

  let uploadFor = null;
  $('#people').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const row = b.closest('.person'), i = Number(row.dataset.i), p = data.people[i];
    const msg = row.querySelector('.msg'); msg.textContent = '';
    const act = b.dataset.act;
    if (act === 'delete') {
      if (!confirm(`Remove ${p.name || 'this person'}?`)) return;
      data.people.splice(i, 1);
      renderPeople(); setDirty(); return;
    }
    if (act === 'left' || act === 'right') {
      const j = act === 'left' ? i - 1 : i + 1;
      [data.people[i], data.people[j]] = [data.people[j], data.people[i]];
      renderPeople(); setDirty(); return;
    }
    if (act === 'upload') { uploadFor = i; $('#file').value = ''; $('#file').click(); return; }
    if (act === 'fetch') {
      const q = row.querySelector('[data-k=lookup]').value.trim(); if (!q) return;
      const thumb = row.querySelector('.thumb'); thumb.classList.add('busy'); b.disabled = true;
      try {
        const r = await wikiLookup(q);
        p.image = await savePhoto(r.blob); p.source = r.pageUrl;
        if (!p.position && r.description) p.position = r.description.replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/^./, c => c.toUpperCase());
        renderPeople(); setDirty(); toast(`Photo added from “${r.title}”. Click Save changes to use it.`);
      } catch (err) { msg.textContent = err.message; thumb.classList.remove('busy'); b.disabled = false; }
    }
  });

  $('#file').addEventListener('change', async () => {
    const f = $('#file').files[0]; if (!f || uploadFor === null) return;
    const p = data.people[uploadFor];
    const row = $(`.person[data-i="${uploadFor}"]`), thumb = row && row.querySelector('.thumb');
    if (thumb) thumb.classList.add('busy');
    try {
      p.image = await savePhoto(f); p.source = '';
      renderPeople(); setDirty(); toast('Photo uploaded. Click Save changes to use it.');
    } catch (err) { if (thumb) thumb.classList.remove('busy'); toast(err.message, true); }
  });

  $('#addPerson').addEventListener('click', () => {
    data.people.push({ id: uid('p', 'new'), name: '', position: '', image: '', imageY: 20, source: '', facts: [] });
    renderPeople(); setDirty();
    const last = $('#people').lastElementChild; last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    last.querySelector('[data-k=name]').focus();
  });

  // ---------- questions ----------
  function renderQuestions() {
    $('#questions').innerHTML = data.questions.map((q, i) => `
      <div class="question" data-i="${i}">
        <div class="qhead">
          <span class="num">${i + 1}</span>
          <input class="input sm" data-k="text" value="${esc(q.text)}" placeholder="Did they…?">
          <button class="linkish" data-act="up" ${i === 0 ? 'disabled' : ''}>Up</button>
          <button class="linkish" data-act="down" ${i === data.questions.length - 1 ? 'disabled' : ''}>Down</button>
          <button class="linkish danger" data-act="delete">Remove</button>
        </div>
      </div>`).join('') || '<p class="note">No example questions yet.</p>';
  }

  $('#questions').addEventListener('input', e => {
    const row = e.target.closest('.question'); if (!row) return;
    data.questions[row.dataset.i].text = e.target.value; setDirty();
  });
  $('#questions').addEventListener('click', e => {
    const row = e.target.closest('.question'); if (!row) return;
    const i = Number(row.dataset.i);
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'delete') { if (!confirm('Remove this question?')) return; data.questions.splice(i, 1); }
    if (b.dataset.act === 'up') [data.questions[i - 1], data.questions[i]] = [data.questions[i], data.questions[i - 1]];
    if (b.dataset.act === 'down') [data.questions[i + 1], data.questions[i]] = [data.questions[i], data.questions[i + 1]];
    renderQuestions(); setDirty();
  });
  $('#addQuestion').addEventListener('click', () => {
    data.questions.push({ id: uid('q', 'new'), text: '' });
    renderQuestions(); setDirty();
    const last = $('#questions').lastElementChild; last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    last.querySelector('input').focus();
  });

  // ---------- settings ----------
  function renderSettings() {
    $('#s-title').value = data.settings.title || '';
    $('#s-edition').value = data.settings.edition || '';
    $('#s-mins').value = data.settings.roundMinutes || 5;
  }
  $('#s-title').addEventListener('input', e => { data.settings.title = e.target.value; setDirty(); });
  $('#s-edition').addEventListener('input', e => { data.settings.edition = e.target.value; setDirty(); });
  $('#s-mins').addEventListener('input', e => { data.settings.roundMinutes = Math.min(30, Math.max(1, Math.round(Number(e.target.value)) || 5)); setDirty(); });

  // ---------- save ----------
  $('#save').addEventListener('click', async () => {
    if (data.people.some(p => !p.name.trim())) return toast('Every person needs a name.', true);
    if (data.questions.some(q => !q.text.trim())) return toast('Every question needs text.', true);
    const btn = $('#save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await db.ref('content').set(JSON.parse(JSON.stringify(data)));
      setDirty(false);
      toast('Saved. New games use these changes right away.');
    } catch (err) {
      toast(/permission/i.test(err.message) ? 'Saving was blocked. Sign out and sign in again.' : 'Could not save. ' + err.message, true);
    }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  });

})();
