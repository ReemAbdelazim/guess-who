(() => {
  const $ = s => document.querySelector(s);
  const grid = $('#grid'), board = $('#board');

  const X_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="rgba(6,24,36,.55)" stroke="#8AD09B" stroke-width="3"/><path d="M34 34 L66 66 M66 34 L34 66" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>';

  let data = null;
  const state = { round: 1, wins: 0, mystery: null, asked: {}, out: new Set(), guessing: false, over: false };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const max = () => Math.max(1, Number(data.settings.maxQuestions) || 6);
  const used = () => Object.keys(state.asked).length;

  async function load() {
    const r = await fetch('/api/data', { cache: 'no-store' });
    data = await r.json();
    $('#title').textContent = data.settings.title || 'Guess Who?';
    $('#edition').textContent = data.settings.edition || '';
    document.title = (data.settings.title || 'Guess Who?') + ' · Seeds Congress 2026';
    renderGrid();
    newGame(true);
    new ResizeObserver(layout).observe(board);
    if (document.fonts) document.fonts.ready.then(layout);
  }

  // ---------- board ----------
  function renderGrid() {
    if (!data.people.length) { grid.innerHTML = '<div class="empty">No people yet.</div>'; return; }
    grid.innerHTML = data.people.map(p => `
      <button class="card" data-id="${esc(p.id)}" title="${esc(p.name)} — ${esc(p.position)}">
        <div class="photo">
          ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" style="object-position:50% ${Number(p.imageY ?? 20)}%" loading="eager">` : ''}
          <div class="stamp">${X_SVG}</div>
        </div>
        <div class="meta"><div class="name">${esc(p.name)}</div><div class="role">${esc(p.position)}</div></div>
      </button>`).join('');
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

  // Shrink a long name (e.g. "Martin Luther King Jr.") until it fits on one line.
  function fitNames() {
    grid.querySelectorAll('.name').forEach(el => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = size * 0.72;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) { size -= 0.5; el.style.fontSize = size + 'px'; }
    });
  }

  // ---------- questions ----------
  function renderQuestions() {
    const locked = state.over || used() >= max();
    $('#questions').innerHTML = data.questions.map(q => {
      const a = state.asked[q.id];
      const ans = a === undefined ? '' : `<span class="ans ${a ? 'yes' : 'no'}">${a ? 'YES' : 'NO'}</span>`;
      return `<button class="qbtn ${a !== undefined ? 'asked' : ''} ${locked ? 'locked' : ''}" data-q="${esc(q.id)}" ${a !== undefined || locked ? 'disabled' : ''}>
        <span>${esc(q.text)}</span>${ans}</button>`;
    }).join('') || '<p class="count">No questions yet.</p>';
    $('#q-count').textContent = `${max() - used()} left`;
  }

  function ask(qid) {
    if (state.over || used() >= max() || state.asked[qid] !== undefined) return;
    const q = data.questions.find(x => x.id === qid);
    const yesSet = new Set(q.yes || []);
    const answer = yesSet.has(state.mystery.id);
    state.asked[qid] = answer;
    if (data.settings.autoEliminate !== false) {
      data.people.forEach(p => { if (yesSet.has(p.id) !== answer) state.out.add(p.id); });
    }
    refresh();
    if (used() >= max()) setGuessing(true);
  }

  // ---------- guessing ----------
  function setGuessing(on) {
    state.guessing = on && !state.over;
    document.body.classList.toggle('guessing', state.guessing);
    $('#guessBtn').textContent = state.guessing ? 'Cancel guess' : 'Make your guess';
    $('#guessBtn').className = 'btn ' + (state.guessing ? 'btn-ghost' : 'btn-primary');
    hint();
  }

  function guess(id) {
    state.over = true;
    setGuessing(false);
    const win = id === state.mystery.id;
    if (win) state.wins++;
    const m = state.mystery;
    $('#r-eyebrow').textContent = win ? 'Correct' : 'Not quite';
    $('#r-title').textContent = win ? 'You got it!' : 'It was…';
    $('#r-img').src = m.image; $('#r-img').alt = m.name;
    $('#r-img').style.objectPosition = `50% ${Number(m.imageY ?? 20)}%`;
    $('#r-name').textContent = m.name;
    $('#r-role').textContent = m.position;
    const n = used();
    $('#r-msg').textContent = win
      ? `Solved with ${n} question${n === 1 ? '' : 's'}.`
      : `You guessed ${data.people.find(p => p.id === id).name}.`;
    const slot = $('#slot');
    slot.innerHTML = `<img src="${esc(m.image)}" alt="" style="object-position:50% ${Number(m.imageY ?? 20)}%">`;
    refresh();
    $('#modal').classList.add('show');
    $('#again').focus();
  }

  // ---------- flow ----------
  function newGame(first) {
    if (!data.people.length) return;
    if (!first) state.round++;
    state.mystery = data.people[Math.floor(Math.random() * data.people.length)];
    state.asked = {}; state.out = new Set(); state.over = false;
    $('#slot').innerHTML = '<span class="q">?</span>';
    $('#modal').classList.remove('show');
    setGuessing(false);
    refresh();
  }

  function hint() {
    const left = data.people.length - state.out.size;
    let t = '';
    if (state.over) t = 'Round over. Start a new game.';
    else if (state.guessing) t = 'Click the person you think it is.';
    else if (used() >= max()) t = 'Out of questions. Time to guess!';
    else if (left === 1) t = 'Only one left. Make your guess!';
    else t = 'Click a card to rule someone out yourself.';
    $('#hint').textContent = t;
  }

  function refresh() {
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('out', state.out.has(c.dataset.id)));
    $('#s-round').textContent = state.round;
    $('#s-used').textContent = used();
    $('#s-max').textContent = max();
    $('#s-left').textContent = data.people.length - state.out.size;
    $('#s-total').textContent = data.people.length;
    $('#s-wins').textContent = state.wins;
    $('#intro').textContent = `Ask up to ${max()} questions, then make your guess.`;
    $('#guessBtn').disabled = state.over;
    renderQuestions();
    hint();
  }

  // ---------- events ----------
  grid.addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card || state.over) return;
    const id = card.dataset.id;
    if (state.guessing) return guess(id);
    state.out.has(id) ? state.out.delete(id) : state.out.add(id);
    refresh();
  });
  $('#questions').addEventListener('click', e => { const b = e.target.closest('.qbtn'); if (b) ask(b.dataset.q); });
  $('#guessBtn').addEventListener('click', () => setGuessing(!state.guessing));
  $('#newGame').addEventListener('click', () => newGame(false));
  $('#again').addEventListener('click', () => newGame(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (state.guessing) setGuessing(false); } });

  load().catch(err => { grid.innerHTML = `<div class="empty">Could not load the game.<br>${esc(err.message)}</div>`; });
})();
