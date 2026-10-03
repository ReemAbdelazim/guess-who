// Guess Who? · team vs team. Each team runs this page on its own laptop:
// pick a secret person, run the question timer, rule people out, lock in a guess, reveal.
(() => {
  const $ = s => document.querySelector(s);
  const grid = $('#grid'), board = $('#board');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="rgba(6,24,36,.55)" stroke="#8AD09B" stroke-width="3"/><path d="M34 34 L66 66 M66 34 L34 66" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>';

  let data = null;
  // phase: 'pick' → 'play' → 'result'
  let state = { phase: 'pick', round: 1, wins: 0, mins: 5, pickId: null, mineId: null, out: [], timeLeft: 0, total: 0, endsAt: null, guessId: null, resolved: null, concealed: false };
  let guessing = false, ticker = null;

  const person = id => data.people.find(p => p.id === id);
  const save = () => { try { sessionStorage.setItem('gw-game', JSON.stringify(state)); } catch {} };
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const remaining = () => state.endsAt ? Math.max(0, state.endsAt - Date.now()) : state.timeLeft;

  async function load() {
    const r = await fetch('data/data.json?v=' + Date.now(), { cache: 'no-store' });
    data = await r.json();
    $('#title').textContent = data.settings.title || 'Guess Who?';
    $('#edition').textContent = data.settings.edition || '';
    state.mins = Number(data.settings.roundMinutes) || 5;
    // Survive an accidental refresh mid-round (this tab only).
    try {
      const saved = JSON.parse(sessionStorage.getItem('gw-game') || 'null');
      if (saved && (!saved.mineId || person(saved.mineId))) state = { ...state, ...saved };
    } catch {}
    $('#examples').innerHTML = data.questions.map(q => `<li>${esc(q.text)}</li>`).join('');
    renderGrid();
    new ResizeObserver(layout).observe(board);
    if (document.fonts) document.fonts.ready.then(layout);
    render();
    if (state.endsAt) startTicker();
    if (state.phase === 'result') showResult(); // page was reloaded mid-reveal
  }

  // ---------- board ----------
  function renderGrid() {
    if (!data.people.length) { grid.innerHTML = '<div class="hint">No people yet. Add some in admin.</div>'; return; }
    grid.innerHTML = data.people.map(p => `
      <div class="card" role="button" tabindex="0" data-id="${esc(p.id)}" aria-label="${esc(p.name)}, ${esc(p.position)}">
        <div class="photo">
          ${p.image ? `<img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : ''}
          <div class="stamp">${X_SVG}</div>
          <button class="info" data-info="${esc(p.id)}" aria-label="About ${esc(p.name)}" title="Who is this?">i</button>
        </div>
        <div class="meta"><div class="name">${esc(p.name)}</div><div class="role">${esc(p.position)}</div></div>
      </div>`).join('');
    layout();
  }

  // Pick the column count that gives the biggest cards while every card fits on screen (no scrolling).
  function layout() {
    const n = data && data.people.length; if (!n) return;
    const W = board.clientWidth, H = board.clientHeight;
    const gap = Math.max(8, Math.min(14, Math.round(W / 110)));
    const metaFor = w => {
      const name = Math.max(11, Math.min(16, w * 0.088)), role = Math.max(9.5, Math.min(12.5, w * 0.07));
      const padY = Math.round(Math.max(6, Math.min(10, w * 0.05)));
      return { name, role, padY, padX: Math.round(Math.max(7, Math.min(12, w * 0.06))), h: Math.ceil(padY * 2 + 2 + name * 1.2 + 2 + role * 1.25 * 2) };
    };
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      let w = (W - gap * (cols - 1)) / cols;
      const cellH = (H - gap * (rows - 1)) / rows;
      let m = metaFor(w);
      // photo between slightly-landscape (0.85) and portrait (1.3) height:width
      let photo = Math.min(cellH - m.h, w * 1.3);
      if (photo < w * 0.85) {
        for (let k = 0; k < 3; k++) { w = (cellH - m.h) / 0.85; m = metaFor(w); }
        w = Math.min(w, (W - gap * (cols - 1)) / cols); photo = cellH - m.h;
      }
      if (w <= 0 || photo <= 0) continue;
      const score = w * Math.min(photo, w * 1.3);
      if (!best || score > best.score) best = { cols, w, h: Math.min(photo, w * 1.3) + m.h, m, gap, score };
    }
    // Tiny windows (phones): give up on "no scroll" and let the board scroll instead.
    const tooSmall = !best || best.w < 70;
    if (tooSmall) {
      const cols = Math.max(2, Math.floor((W + gap) / (120 + gap)));
      const w = (W - gap * (cols - 1)) / cols, m = metaFor(w);
      best = { cols, w, h: w * 1.15 + m.h, m, gap };
    }
    board.style.overflowY = tooSmall ? 'auto' : '';
    grid.style.height = tooSmall ? 'auto' : '';
    const { cols, w, h, m } = best;
    grid.style.gap = best.gap + 'px';
    grid.style.gridTemplateColumns = `repeat(${cols}, ${Math.floor(w)}px)`;
    grid.style.gridAutoRows = Math.floor(h) + 'px';
    grid.style.setProperty('--name-size', m.name + 'px');
    grid.style.setProperty('--role-size', m.role + 'px');
    grid.style.setProperty('--meta-pad', `${m.padY}px ${m.padX}px`);
    grid.style.setProperty('--meta-h', m.h + 'px');
    fitNames();
  }

  // Shrink a long name (e.g. "Salahuddin al-Ayyubi") until it fits on one line.
  function fitNames() {
    grid.querySelectorAll('.name').forEach(el => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = size * 0.72;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) { size -= 0.5; el.style.fontSize = size + 'px'; }
    });
  }

  // ---------- rendering ----------
  function slot(p, empty) {
    if (!p) return `<div class="ph">?</div><div class="empty-txt">${empty}</div>`;
    return `<div class="ph"><img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%"></div>
      <div><div class="nm">${esc(p.name)}</div><div class="rl">${esc(p.position)}</div>${empty}</div>`;
  }

  function render() {
    const out = new Set(state.out);
    document.querySelectorAll('.card').forEach(c => {
      const id = c.dataset.id;
      c.classList.toggle('picked', state.phase === 'pick' && id === state.pickId);
      c.classList.toggle('mine', state.phase !== 'pick' && id === state.mineId);
      c.classList.toggle('out', state.phase !== 'pick' && out.has(id));
    });
    document.body.classList.toggle('guessing', guessing);
    document.body.classList.toggle('concealed', state.concealed);

    $('#s-round').textContent = state.round;
    $('#s-total').textContent = data.people.length;
    $('#s-left').textContent = data.people.length - (state.phase === 'pick' ? 0 : out.size);
    $('#s-wins').textContent = state.wins;
    $('#howMins').textContent = `${state.mins} minute${state.mins === 1 ? '' : 's'}`;

    $('#step-pick').classList.toggle('hidden', state.phase !== 'pick');
    $('#step-play').classList.toggle('hidden', state.phase === 'pick');

    if (state.phase === 'pick') {
      $('#pickSlot').innerHTML = slot(person(state.pickId), state.pickId ? '' : 'Click a card to choose.');
      $('#lockPick').disabled = !state.pickId;
      $('#mins').textContent = state.mins + ' min';
    } else {
      const me = person(state.mineId);
      $('#mySlot').innerHTML = slot(me, `<button class="linkbtn" id="toggleHide">${state.concealed ? 'Show' : 'Hide'}</button>`);
      $('#mySlot').classList.toggle('concealed', state.concealed);
      renderTimer();
      $('#guessBtn').textContent = guessing ? 'Cancel' : 'Lock in our guess';
      $('#guessBtn').className = 'btn ' + (guessing ? 'btn-ghost' : 'btn-primary');
      $('#guessBtn').disabled = state.phase === 'result';
      const left = data.people.length - out.size;
      $('#hint').textContent = guessing ? 'Click the person you think the other team chose.'
        : remaining() <= 0 ? 'Time is up. Lock in your guess.'
        : !state.endsAt && state.timeLeft === state.total ? 'Start the timer when both teams are ready.'
        : left === 1 ? 'Only one person left. Lock in your guess.'
        : 'Click a card to rule that person out.';
    }
    save();
  }

  function renderTimer() {
    const ms = remaining();
    $('#clock').textContent = fmt(ms);
    $('#bar').style.width = (state.total ? (ms / state.total) * 100 : 0) + '%';
    const t = $('#timer');
    t.classList.toggle('low', ms > 0 && ms <= 60000);
    t.classList.toggle('done', ms <= 0);
    $('#startBtn').textContent = state.endsAt ? 'Pause' : (state.timeLeft === state.total ? 'Start timer' : 'Resume');
    $('#startBtn').disabled = ms <= 0 || state.phase === 'result';
  }

  // ---------- timer ----------
  function startTicker() {
    clearInterval(ticker);
    ticker = setInterval(() => {
      renderTimer();
      if (remaining() <= 0) timeUp();
    }, 250);
  }
  function timeUp() {
    clearInterval(ticker); ticker = null;
    state.timeLeft = 0; state.endsAt = null;
    render();
    if (state.phase === 'play') openModal('#upModal');
  }
  function toggleTimer() {
    if (state.endsAt) { state.timeLeft = remaining(); state.endsAt = null; clearInterval(ticker); ticker = null; }
    else if (state.timeLeft > 0) { state.endsAt = Date.now() + state.timeLeft; startTicker(); }
    render();
  }
  function addMinute() {
    if (state.endsAt) state.endsAt += 60000; else state.timeLeft += 60000;
    state.total += 60000;
    render();
  }

  // ---------- flow ----------
  function lockPick() {
    if (!state.pickId) return;
    state.mineId = state.pickId; state.phase = 'play'; state.out = [];
    state.total = state.timeLeft = state.mins * 60000; state.endsAt = null;
    state.concealed = false;
    render();
  }

  function setGuessing(on) { guessing = on && state.phase === 'play'; render(); }

  function lockGuess(id) {
    guessing = false;
    if (state.endsAt) { state.timeLeft = remaining(); state.endsAt = null; }
    clearInterval(ticker); ticker = null;
    state.guessId = id; state.phase = 'result'; state.resolved = null;
    render(); showResult();
  }

  function showResult() {
    const g = person(state.guessId), m = person(state.mineId);
    const fill = (k, p) => {
      $(`#res${k}Img`).src = p.image; $(`#res${k}Img`).style.objectPosition = `50% ${Number(p.imageY ?? 20)}%`;
      $(`#res${k}Name`).textContent = p.name; $(`#res${k}Role`).textContent = p.position;
    };
    fill('Guess', g); fill('Mine', m);
    const r = state.resolved;
    $('#resTitle').textContent = r === true ? 'You got it!' : r === false ? 'Not this time' : 'Time to reveal';
    $('#resMsg').textContent = r === true
      ? 'Nice work. If the other team also guessed right, both teams win this round.'
      : r === false
        ? 'The other team keeps their secret this round. If they guessed your person, they win.'
        : 'Show your secret person to the other team and ask them to reveal theirs. Then tell us how you did.';
    $('#resAsk').classList.toggle('hidden', r !== null);
    $('#resNext').classList.toggle('hidden', r === null);
    openModal('#resultModal');
  }

  function resolve(right) {
    state.resolved = right;
    if (right) state.wins++;
    render(); showResult();
  }

  function newRound(bumpRound) {
    clearInterval(ticker); ticker = null; guessing = false;
    if (bumpRound) state.round++;
    Object.assign(state, { phase: 'pick', pickId: null, mineId: null, out: [], timeLeft: 0, total: 0, endsAt: null, guessId: null, resolved: null, concealed: false });
    closeModals(); render();
  }

  // ---------- modals ----------
  function openModal(sel) { closeModals(); $(sel).classList.add('show'); const b = $(sel).querySelector('button'); if (b) b.focus(); }
  function closeModals() { document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show')); }

  function showInfo(id) {
    const p = person(id); if (!p) return;
    $('#bioImg').src = p.image; $('#bioImg').style.objectPosition = `50% ${Number(p.imageY ?? 20)}%`;
    $('#bioName').textContent = p.name;
    $('#bioRole').textContent = p.position;
    const facts = (p.facts || []).filter(Boolean);
    $('#bioFacts').innerHTML = facts.length ? facts.map(f => `<li>${esc(f)}</li>`).join('') : '<li>No facts added yet.</li>';
    $('#bioSrc').innerHTML = p.source ? `Read more on <a href="${esc(p.source)}" target="_blank" rel="noopener">Wikipedia</a>` : '';
    openModal('#infoModal');
  }

  // ---------- events ----------
  function cardAction(id) {
    if (state.phase === 'pick') { state.pickId = state.pickId === id ? null : id; render(); return; }
    if (state.phase !== 'play') return;
    if (guessing) {
      if (state.out.includes(id)) return;
      return lockGuess(id);
    }
    state.out = state.out.includes(id) ? state.out.filter(x => x !== id) : [...state.out, id];
    render();
  }
  grid.addEventListener('click', e => {
    const info = e.target.closest('.info');
    if (info) { e.stopPropagation(); return showInfo(info.dataset.info); }
    const card = e.target.closest('.card'); if (card) cardAction(card.dataset.id);
  });
  grid.addEventListener('keydown', e => {
    if (e.target.classList.contains('card') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cardAction(e.target.dataset.id); }
  });

  $('#minus').addEventListener('click', () => { state.mins = Math.max(1, state.mins - 1); render(); });
  $('#plus').addEventListener('click', () => { state.mins = Math.min(30, state.mins + 1); render(); });
  $('#lockPick').addEventListener('click', lockPick);
  $('#startBtn').addEventListener('click', toggleTimer);
  $('#addMin').addEventListener('click', addMinute);
  $('#guessBtn').addEventListener('click', () => setGuessing(!guessing));
  $('#upGuess').addEventListener('click', () => { closeModals(); setGuessing(true); });
  $('#mySlot').addEventListener('click', e => { if (e.target.id === 'toggleHide') { state.concealed = !state.concealed; render(); } });
  $('#gotIt').addEventListener('click', () => resolve(true));
  $('#missed').addEventListener('click', () => resolve(false));
  $('#again').addEventListener('click', () => newRound(true));
  $('#howBtn').addEventListener('click', () => openModal('#howModal'));
  $('#newRound').addEventListener('click', () => {
    if (state.phase === 'play' && !confirm('Start a new round? This round’s progress will be lost.')) return;
    newRound(state.phase !== 'pick');
  });
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {
    // the result and time's-up screens need an answer; the others close on backdrop click
    if (m.id === 'resultModal' || m.id === 'upModal') return;
    if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('show');
  }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal.show');
    if (open && open.id !== 'resultModal' && open.id !== 'upModal') open.classList.remove('show');
    else if (guessing) setGuessing(false);
  });

  load().catch(err => { grid.innerHTML = `<div class="hint">Could not load the game. ${esc(err.message)}</div>`; });
})();
