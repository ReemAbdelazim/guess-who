// Guess Who? · live player vs player.
// Two laptops share one game through Firebase Realtime Database:
//   /games/CODE = { created, mins, round, players: {p1, p2}, rounds: {r1: {...}, r2: ...} }
// URLs:  ?game=CODE          → choose Player 1 / Player 2
//        ?game=CODE&p=1|2    → that player's own screen
// A player's secret person stays in their own browser until both have guessed.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="rgba(6,24,36,.55)" stroke="#8AD09B" stroke-width="3"/><path d="M34 34 L66 66 M66 34 L34 66" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  const grid = $('#grid'), board = $('#board');

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const db = firebase.database();
  const TS = firebase.database.ServerValue.TIMESTAMP;
  let offset = 0;
  db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
  const now = () => Date.now() + offset;

  // One id per browser tab, so two tabs on one laptop can be two players while testing.
  const CLIENT = (() => {
    try { let c = sessionStorage.getItem('gw-client'); if (!c) { c = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('gw-client', c); } return c; }
    catch { return Math.random().toString(36).slice(2, 12); }
  })();
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let data = null;          // people, questions, settings from data/data.json
  let code = null, seat = null, game = null, gameRef = null;
  let pickId = null, guessing = false, concealed = false, ticker = null, upShownFor = null, needSecret = false;
  let typeOpen = false; // typing a question is optional; asking out loud is the default
  let nextAt = {};       // round key -> when the next round starts automatically
  let wasOver = false;
  const NEXT_ROUND_MS = 6000;

  const person = id => data.people.find(p => p.id === id);
  const other = s => (s === 'p1' ? 'p2' : 'p1');
  const pname = s => (game && game.players && game.players[s] && game.players[s].name) || (s === 'p1' ? 'Player 1' : 'Player 2');
  const roundKey = () => 'r' + ((game && game.round) || 1);
  const R = () => (game && game.rounds && game.rounds[roundKey()]) || {};
  const gref = path => db.ref(`games/${code}/${path}`);
  const rref = path => gref(`rounds/${roundKey()}` + (path ? `/${path}` : ""));
  const secretKey = () => `gw:${code}:${roundKey()}:${seat}:secret`;
  const outKey = () => `gw:${code}:${roundKey()}:${seat}:out`;
  const mySecret = () => store.get(secretKey());
  const myOut = () => new Set(store.get(outKey()) || []);
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show';
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Link copied'); }
    catch { toast('Select the link and copy it'); }
  }
  const linkFor = (c, p) => location.origin + location.pathname + '?game=' + c + (p ? '&p=' + p : '');

  // ---------- routing ----------
  function go(params) {
    const q = new URLSearchParams(params).toString();
    history.pushState(null, '', location.pathname + (q ? '?' + q : ''));
    route();
  }
  window.addEventListener('popstate', route);

  function route() {
    const q = new URLSearchParams(location.search);
    const c = (q.get('game') || '').toUpperCase();
    const p = q.get('p') === '1' ? 'p1' : q.get('p') === '2' ? 'p2' : null;
    seat = p; guessing = false; pickId = null; needSecret = false; wasOver = false; nextAt = {};
    if (c !== code) subscribe(/^[A-HJ-NP-Z2-9]{4}$/.test(c) ? c : null);
    else render();
  }

  function subscribe(c) {
    if (gameRef) gameRef.off();
    code = c; game = null; gameRef = null;
    if (!code) { render(); return; }
    gameRef = db.ref('games/' + code);
    gameRef.on('value', snap => {
      const prevRound = game && game.round;
      game = snap.val();
      if (prevRound && game && game.round !== prevRound) { pickId = null; guessing = false; needSecret = false; typeOpen = false; closeModals(); }
      render();
    }, err => { $('#homeErr').textContent = 'Could not reach the game server. ' + err.message; });
  }

  // ---------- presence ----------
  let presenceFor = null;
  db.ref('.info/connected').on('value', s => {
    $('#conn').classList.toggle('hidden', s.val() === true || !code);
    if (s.val() === true) presenceFor = null; // re-announce after a reconnect
    if (game) render();
  });
  function announce() {
    const key = code + seat;
    if (presenceFor === key) return;
    presenceFor = key;
    const ref = gref(`players/${seat}/online`);
    ref.onDisconnect().set(false);
    ref.set(true);
  }

  // ---------- views ----------
  function show(view) {
    ['home', 'lobby', 'game'].forEach(v => $('#v-' + v).classList.toggle('hidden', v !== view));
    $('#codeChip').classList.toggle('hidden', view === 'home');
    $('#players').classList.toggle('hidden', view !== 'game');
    $('#codeTxt').textContent = code || '';
  }

  function render() {
    if (!data) return;
    if (!code) { show('home'); return; }
    if (!game) {
      show('lobby');
      $('#seats').innerHTML = '';
      $('#lobbyErr').textContent = gameRef ? `Looking for game ${code}…` : '';
      return;
    }
    const players = game.players || {};
    const mine = seat && players[seat] && players[seat].client === CLIENT;
    // Reopened your own link on a new tab: take the seat back if nobody else is using it.
    if (seat && players[seat] && !mine && !players[seat].online) { gref(`players/${seat}/client`).set(CLIENT); return; }
    if (seat && mine) { announce(); renderGame(); return; }
    if (seat && !players[seat]) { $('#lobbyErr').textContent = ''; }
    if (seat && players[seat] && !mine) $('#lobbyErr').textContent = `${pname(seat)} is already playing as ${seat === 'p1' ? 'Player 1' : 'Player 2'} on another screen.`;
    renderLobby();
  }

  function renderLobby() {
    show('lobby');
    $('#lobbyCode').textContent = code; $('#lobbyCode2').textContent = code;
    $('#lobbyUrl').textContent = linkFor(code);
    const players = game.players || {};
    $('#seats').innerHTML = ['p1', 'p2'].map(s => {
      const pl = players[s], label = s === 'p1' ? 'Player 1' : 'Player 2';
      if (!pl) return `<div class="seat-card"><div class="eyebrow">${label}<span>Open</span></div>
          <input class="input" id="name-${s}" maxlength="24" placeholder="Your name" aria-label="${label} name">
          <button class="btn btn-primary" data-claim="${s}">Play as ${label}</button></div>`;
      if (pl.client === CLIENT) return `<div class="seat-card mine"><div class="eyebrow">${label}<span>You</span></div>
          <div class="taken">${esc(pl.name)}</div><button class="btn btn-primary" data-go="${s}">Continue</button></div>`;
      return `<div class="seat-card"><div class="eyebrow">${label}<span>${pl.online ? 'Playing' : 'Away'}</span></div>
          <div class="taken">${esc(pl.name)}</div><div class="sub">${pl.online ? 'Already playing on another screen.' : 'Not connected right now.'}</div>
          <button class="btn btn-ghost" data-take="${s}">This is me</button></div>`;
    }).join('');
  }

  // ---------- board ----------
  function renderGrid() {
    grid.innerHTML = data.people.map(p => `
      <div class="card" role="button" tabindex="0" data-id="${esc(p.id)}" aria-label="${esc(p.name)}, ${esc(p.position)}">
        <div class="photo">
          ${p.image ? `<img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : ''}
          <div class="stamp">${X_SVG}</div>
          <button class="info" data-info="${esc(p.id)}" aria-label="About ${esc(p.name)}" title="Who is this?">i</button>
        </div>
        <div class="meta"><div class="name">${esc(p.name)}</div><div class="role">${esc(p.position)}</div></div>
      </div>`).join('');
  }

  // Pick the column count that gives the biggest cards while every card fits on screen (no scrolling).
  function layout() {
    const n = data && data.people.length; if (!n || !board.clientWidth) return;
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
      let photo = Math.min(cellH - m.h, w * 1.3);
      if (photo < w * 0.85) {
        for (let k = 0; k < 3; k++) { w = (cellH - m.h) / 0.85; m = metaFor(w); }
        w = Math.min(w, (W - gap * (cols - 1)) / cols); photo = cellH - m.h;
      }
      if (w <= 0 || photo <= 0) continue;
      const score = w * Math.min(photo, w * 1.3);
      if (!best || score > best.score) best = { cols, w, h: Math.min(photo, w * 1.3) + m.h, m, gap, score };
    }
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
    grid.querySelectorAll('.name').forEach(el => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = size * 0.72;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) { size -= 0.5; el.style.fontSize = size + 'px'; }
    });
  }

  // ---------- game state helpers ----------
  // One clock for the whole match. Rounds keep coming until it runs out.
  function timerState() {
    const total = (Number(game.mins) || 5) * 60000;
    return game.timer || { total, left: total, endsAt: null };
  }
  const remaining = () => { const t = timerState(); return t.endsAt ? Math.max(0, t.endsAt - now()) : t.left; };
  const timerStarted = () => { const t = timerState(); return !!t.endsAt || t.left < t.total; };
  const timeUp = () => timerStarted() && remaining() <= 0;
  const matchOver = () => !!game && timeUp();
  // pick → play → result. The round ends as soon as either player locks in a guess.
  function phase() {
    const r = R(), lk = r.locked || {}, g = r.guess || {};
    if (!(lk.p1 && lk.p2)) return 'pick';
    if (g.p1 || g.p2) return 'result';
    return 'play';
  }
  // A right guess wins the round for the guesser; a wrong guess gives it to the other player.
  function roundResult(r) {
    const g = r.guess || {}, rv = r.reveal || {}, pts = { p1: 0, p2: 0 }, rows = [];
    let pending = false;
    ['p1', 'p2'].forEach(s => {
      if (!g[s]) return;
      const target = rv[other(s)];
      if (!target) { pending = true; return; }
      const ok = g[s] === target;
      pts[ok ? s : other(s)]++;
      rows.push({ s, ok, guess: g[s], actual: target });
    });
    return { any: !!(g.p1 || g.p2), pending, pts, rows };
  }
  function qaList() {
    const qa = R().qa || {};
    return Object.entries(qa).map(([id, q]) => ({ id, ...q })).sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  function winsFor(s) {
    let n = 0;
    Object.values((game && game.rounds) || {}).forEach(r => { const res = roundResult(r); if (res.any && !res.pending) n += res.pts[s]; });
    return n;
  }
  const firstAsker = () => ((game.round || 1) % 2 ? 'p1' : 'p2'); // players take turns starting rounds

  // ---------- game screen ----------
  function slot(p, extra) {
    if (!p) return `<div class="ph">?</div><div class="grow"><div class="empty-txt">${extra || ''}</div></div>`;
    return `<div class="ph"><img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%"></div>
      <div class="grow"><div class="nm">${esc(p.name)}</div><div class="rl">${esc(p.position)}</div>${extra || ''}</div>`;
  }

  function renderPlayers() {
    const ph = phase(), turn = R().turn || firstAsker();
    $('#players').innerHTML = ['p1', 'p2'].map(s => {
      const pl = (game.players || {})[s];
      const me = s === seat;
      const nameHtml = me ? `<input id="myName" maxlength="24" value="${esc(pname(s))}" aria-label="Your name">` : esc(pl ? pl.name : 'Waiting…');
      return `<div class="pchip ${pl && pl.online ? 'online' : ''} ${ph === 'play' && turn === s ? 'turn' : ''}">
        <span class="seat">${s === 'p1' ? 1 : 2}</span>
        <span class="nm">${nameHtml}</span>
        ${me ? '<span class="you">You</span>' : ''}
        <span class="wins">${winsFor(s)} won</span></div>`;
    }).join('');
  }

  function renderGame() {
    show('game');
    if (!grid.children.length) { renderGrid(); requestAnimationFrame(layout); }
    // Keep the name box stable while the player is typing in it.
    const typing = document.activeElement && document.activeElement.id === 'myName';
    if (!typing) renderPlayers();

    const r = R(), ph = phase(), opp = other(seat), oppPl = (game.players || {})[opp];
    const secret = mySecret(), out = myOut();
    const locked = !!(r.locked && r.locked[seat]);
    $('#howMins').textContent = `${game.mins || 5} minute${game.mins == 1 ? '' : 's'}`;

    document.querySelectorAll('.card').forEach(c => {
      const id = c.dataset.id;
      c.classList.toggle('picked', ph === 'pick' && !locked && id === pickId);
      c.classList.toggle('mine', ph !== 'pick' || locked ? id === secret : false);
      c.classList.toggle('out', ph !== 'pick' && out.has(id));
    });
    document.body.classList.toggle('guessing', guessing || needSecret);
    document.body.classList.toggle('concealed', concealed);

    $('#step-pick').classList.toggle('hidden', ph !== 'pick');
    $('#step-play').classList.toggle('hidden', ph === 'pick');

    if (ph === 'pick') {
      $('#pickEyebrow').textContent = `Round ${game.round || 1} · Step 1`;
      const shown = locked ? person(secret) : person(pickId);
      $('#pickSlot').innerHTML = locked && !secret
        ? slot(null, 'Locked in on another screen.')
        : slot(shown, shown ? (locked ? '<button class="linkbtn" id="unlock">Change</button>' : '') : 'Click a card to choose.');
      const st = (name, s) => {
        const pl = (game.players || {})[s];
        const state = !pl ? '<span class="pill">Not joined</span>' : r.locked && r.locked[s] ? '<span class="pill ok">Locked in</span>' : '<span class="pill">Choosing</span>';
        return `<div><span>${esc(name)}</span>${state}</div>`;
      };
      $('#pickStatus').innerHTML = st('You', seat) + st(pname(opp), opp);
      renderPickClock();
      $('#pickInvite').classList.toggle('hidden', !!oppPl);
      $('#pickUrl').textContent = linkFor(code);
      $('#lockPick').disabled = locked || !pickId;
      $('#lockPick').textContent = locked ? (oppPl ? `Waiting for ${pname(opp)}…` : 'Waiting for the other player…') : 'Lock in my person';
      closeModal('#resultModal');
      if (matchOver()) showFinal(); else closeModal('#finalModal');
      return;
    }

    // play / result
    $('#mySlot').innerHTML = slot(person(secret), `<button class="linkbtn" id="toggleHide">${concealed ? 'Show' : 'Hide'} my person</button>`);
    $('#mySlot').classList.toggle('concealed', concealed);
    renderTimer();

    const turn = r.turn || firstAsker(), list = qaList();
    const incoming = list.find(q => q.from === opp && !q.ans);
    const mine = list.find(q => q.from === seat && !q.ans);
    const myGuess = r.guess && r.guess[seat], oppGuess = r.guess && r.guess[opp];
    const up = timeUp() || ph === 'result';

    $('#turn').className = 'turn' + (turn === seat && !myGuess && !up ? ' mine' : '');
    $('#turn').textContent = ph === 'result' ? 'Round over' : up ? 'Time’s up' : turn === seat ? 'Your turn to ask' : `${pname(opp)}’s turn to ask`;

    let ask = '';
    if (incoming) {
      ask = `<div class="incoming"><div class="eyebrow">${esc(pname(opp))} asks</div><div class="q">${esc(incoming.text)}</div>
        <div class="row"><button class="btn btn-primary" data-ans="yes" data-q="${esc(incoming.id)}">Yes</button><button class="btn btn-ghost" data-ans="no" data-q="${esc(incoming.id)}">No</button></div></div>`;
    } else if (up || myGuess) {
      ask = '';
    } else if (mine) {
      ask = `<div class="waiting">Waiting for ${esc(pname(opp))} to answer…</div>`;
    } else if (turn === seat && !typeOpen) {
      // Default: talk it through with the other team and ask out loud, then pass the turn.
      ask = `<div class="aloud"><div class="q">Ask ${esc(pname(opp))} a yes-or-no question out loud.</div>
        <button class="btn btn-primary" id="passTurn">Done, ${esc(pname(opp))}’s turn</button>
        <button class="linkbtn" id="typeToggle">Or type the question instead</button></div>`;
    } else if (turn === seat) {
      const opts = data.questions.map(q => `<option>${esc(q.text)}</option>`).join('');
      ask = `<form class="askbox" id="askForm">
        <div class="row"><input class="input" id="askText" maxlength="140" placeholder="Type a yes-or-no question" autocomplete="off"><button class="btn btn-primary">Ask</button></div>
        <select class="input" id="askPick" aria-label="Example questions"><option value="">Or pick an example question…</option>${opts}</select>
        <button type="button" class="linkbtn" id="typeToggle">Ask out loud instead</button></form>`;
    } else {
      ask = `<div class="waiting">${esc(pname(opp))} is asking. Answer them out loud, or on screen if they type it.</div>`;
    }
    // Don't wipe a question the player is halfway through typing.
    const typingAsk = document.activeElement && (document.activeElement.id === 'askText' || document.activeElement.id === 'askPick');
    const keepAsk = typingAsk && $('#askForm') && turn === seat && !incoming && !mine && !up && !myGuess;
    if (!keepAsk) { const draft = $('#askText') ? $('#askText').value : ''; $('#askArea').innerHTML = ask; if ($('#askText')) $('#askText').value = draft; }

    $('#log').innerHTML = list.length ? list.map(q => q.spoken
        ? `<li class="spoken"><span class="who">${q.from === seat ? 'You' : esc(pname(q.from))}</span><span class="txt">Asked out loud</span></li>`
        : `<li><span class="who">${q.from === seat ? 'You' : esc(pname(q.from))}</span><span class="txt">${esc(q.text)}</span>
        <span class="ans ${q.ans || 'wait'}">${q.ans ? q.ans.toUpperCase() : '…'}</span></li>`).join('')
      : '<li class="empty">No questions yet</li>';
    $('#log').scrollTop = $('#log').scrollHeight;

    const g = $('#guessBtn');
    g.disabled = ph !== 'play' || timeUp();
    g.textContent = guessing ? 'Cancel' : 'Lock in my guess';
    g.className = 'btn ' + (guessing ? 'btn-ghost' : 'btn-primary');
    $('#hint').textContent = needSecret ? 'Click your own secret person so it can be revealed.'
      : guessing ? `Click the person you think ${pname(opp)} chose.`
      : ph === 'result' ? 'Revealing…'
      : timeUp() ? 'Time is up.'
      : !timerStarted() ? 'Start the clock when you’re both ready.'
      : !timerState().endsAt ? 'The host has paused the timer.'
      : 'Click a card to rule that person out. Locking in a guess ends the round.';

    // Someone guessed: both players reveal their secret person (it stays in this browser until now).
    if (ph === 'result' && !(r.reveal && r.reveal[seat])) {
      if (secret) rref(`reveal/${seat}`).set(secret);
      else needSecret = true;
    }
    if (matchOver()) showFinal();
    else if (ph === 'result') showResult();
    else { closeModal('#resultModal'); closeModal('#finalModal'); }
  }

  function renderTimer() {
    if (!game || !seat) return;
    const t = timerState(), ms = remaining();
    const paused = timerStarted() && !t.endsAt && ms > 0;
    $('#clock').textContent = fmt(ms);
    $('#bar').style.width = (t.total ? (ms / t.total) * 100 : 0) + '%';
    $('#timer').classList.toggle('low', ms > 0 && ms <= 60000);
    $('#timer').classList.toggle('done', timerStarted() && ms <= 0);
    $('#timer').classList.toggle('paused', paused);
    // Only rebuild the state area when it changes, so the Start button stays clickable.
    const key = paused ? 'paused' : t.endsAt ? 'running' : timerStarted() ? 'up' : 'ready';
    const ts = $('#tstate');
    if (ts.dataset.k !== key) {
      ts.dataset.k = key;
      ts.innerHTML = key === 'paused' ? 'Paused by host' : key === 'up' ? 'Time’s up'
        : key === 'ready' ? '<button class="btn btn-primary" id="startClock">Start clock</button>' : '';
    }
  }
  function renderPickClock() {
    if (!game || !seat) return;
    const started = timerStarted();
    $('#minsLbl').textContent = started ? 'Time left in this game' : 'Game time';
    $('#mins').textContent = started ? fmt(remaining()) : (game.mins || 5) + ' min';
  }

  ticker = setInterval(() => {
    if (!game || !seat) return;
    const ph = phase();
    if (ph === 'pick') renderPickClock(); else renderTimer();
    if (ph === 'result') tickNextRound();
    const over = matchOver();
    if (over !== wasOver) { wasOver = over; renderGame(); }
  }, 250);

  // ---------- result ----------
  function personMini(id, label) {
    const p = person(id);
    return `<div class="mini">${p ? `<img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : ''}<div><div class="k">${label}</div><div class="v">${esc(p ? p.name : '…')}</div></div></div>`;
  }
  const who = s => (s === seat ? 'You' : esc(pname(s)));

  function showResult() {
    const r = R(), res = roundResult(r), rv = r.reveal || {}, me = seat, opp = other(seat), n = game.round || 1;
    $('#resEyebrow').textContent = `Round ${n} · Result`;
    $('#again').classList.add('hidden');
    if (res.pending) {
      $('#resTitle').textContent = 'Revealing…';
      $('#resDuo').innerHTML = '';
      $('#resMsg').textContent = needSecret ? 'Click your own secret person on the board so it can be revealed.' : 'Waiting for both secret people to be revealed.';
    } else {
      const winners = ['p1', 'p2'].filter(s => res.pts[s] > 0);
      $('#resTitle').textContent = winners.length === 2 ? 'You both win this round!'
        : winners[0] === me ? 'You win this round!' : `${pname(winners[0])} wins this round`;
      const lines = res.rows.map(x => `${x.s === me ? 'You' : pname(x.s)} guessed ${person(x.guess) ? person(x.guess).name : ''}: ${x.ok ? 'correct' : 'wrong'}.`).join(' ');
      $('#resDuo').innerHTML = ['p1', 'p2'].map(s => `<div class="who ${res.pts[s] ? 'win' : ''}">
          <div class="head"><b>${who(s)}</b>${res.pts[s] ? '<span class="pill ok">Wins round</span>' : ''}</div>
          ${personMini(rv[s], s === me ? 'Your person' : 'Their person')}
          ${(r.guess || {})[s] ? personMini(r.guess[s], s === me ? 'You guessed' : 'They guessed') : ''}
        </div>`).join('');
      if (!nextAt[roundKey()]) nextAt[roundKey()] = Date.now() + NEXT_ROUND_MS;
      const secs = Math.max(0, Math.ceil((nextAt[roundKey()] - Date.now()) / 1000));
      $('#resMsg').textContent = `${lines} Score: You ${winsFor(me)} · ${pname(opp)} ${winsFor(opp)}. Round ${n + 1} starts in ${secs}s.`;
      $('#again').textContent = `Start round ${n + 1} now`;
      $('#again').classList.remove('hidden');
    }
    if (!$('#resultModal').classList.contains('show')) openModal('#resultModal');
  }

  // Count down on the result screen, then move both players to the next round.
  function tickNextRound() {
    const at = nextAt[roundKey()];
    if (!at || matchOver()) return;
    if (Date.now() >= at) { nextAt[roundKey()] = Infinity; nextRound(); }
    else if ($('#resultModal').classList.contains('show')) showResult();
  }

  function showFinal() {
    const me = seat, opp = other(seat), a = winsFor(me), b = winsFor(opp);
    $('#finTitle').textContent = a === b ? `It’s a tie, ${a}–${b}` : a > b ? `You win the game, ${a}–${b}!` : `${pname(opp)} wins the game, ${b}–${a}`;
    const rounds = Object.entries(game.rounds || {}).map(([k, r]) => [Number(k.slice(1)), roundResult(r)])
      .filter(([, res]) => res.any && !res.pending).sort((x, y) => x[0] - y[0]);
    $('#finRounds').innerHTML = rounds.length ? rounds.map(([n, res]) => {
      const w = ['p1', 'p2'].filter(s => res.pts[s]);
      return `<li><span>Round ${n}</span><b>${w.length === 2 ? 'Both' : w[0] === me ? 'You' : esc(pname(w[0]))}</b></li>`;
    }).join('') : '<li><span>No rounds finished</span><b>—</b></li>';
    $('#finMsg').textContent = game.next ? 'Starting a rematch…' : 'Play again with the same two players, or go back to the start.';
    if (!$('#finalModal').classList.contains('show')) openModal('#finalModal');
    if (game.next) go({ game: game.next, p: seat === 'p1' ? 1 : 2 });
  }

  // ---------- actions ----------
  async function newGame() {
    $('#homeErr').textContent = '';
    try {
      let c;
      for (let i = 0; i < 8; i++) {
        c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
        if (!(await db.ref('games/' + c).get()).exists()) break;
      }
      await db.ref('games/' + c).update({ created: TS, mins: Number(data.settings.roundMinutes) || 5, round: 1 });
      go({ game: c });
    } catch (e) { $('#homeErr').textContent = 'Could not start a game. Check your internet connection and try again.'; }
  }

  async function joinGame(raw) {
    const c = raw.trim().toUpperCase();
    $('#homeErr').textContent = '';
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(c)) { $('#homeErr').textContent = 'Game codes are 4 letters or numbers, like K7QM.'; return; }
    try {
      if (!(await db.ref('games/' + c).get()).exists()) { $('#homeErr').textContent = `There’s no game with code ${c}. Check it with the other player.`; return; }
      go({ game: c });
    } catch { $('#homeErr').textContent = 'Could not reach the game server. Check your internet connection.'; }
  }

  async function claim(s) {
    const input = $('#name-' + s);
    const name = (input && input.value.trim()) || (s === 'p1' ? 'Player 1' : 'Player 2');
    const res = await gref('players/' + s).transaction(cur => (!cur || cur.client === CLIENT) ? { name: name.slice(0, 24), client: CLIENT, online: true } : undefined);
    if (!res.committed) { $('#lobbyErr').textContent = 'Someone just took that seat. Choose the other one.'; return; }
    go({ game: code, p: s === 'p1' ? 1 : 2 });
  }

  function lockPick() {
    if (!pickId) return;
    store.set(secretKey(), pickId);
    rref('locked/' + seat).set(true);
  }

  // Players can only start the clock; pausing and adding time happen in /admin.
  function startTimer() {
    gref('timer').transaction(cur => {
      if (cur) return; // already started (or changed by the host)
      const t = timerState();
      return { total: t.total, left: t.left, endsAt: now() + t.left };
    });
  }

  // Asked out loud: note it in the list and hand the turn over.
  function passTurn() {
    const r = R(), opp = other(seat), oppGuess = r.guess && r.guess[opp];
    const k = rref('qa').push().key;
    rref('').update({ [`qa/${k}`]: { from: seat, spoken: true, ans: 'spoken', at: TS }, turn: opp });
    if (!timerStarted()) startTimer();
  }

  function ask(text) {
    text = text.trim().slice(0, 140);
    if (!text) return;
    rref('qa').push({ from: seat, text, at: TS });
    if (!timerStarted()) startTimer(); // the first question starts the clock
  }
  function answer(qid, ans) {
    // After answering, it's my turn to ask.
    rref('').update({ [`qa/${qid}/ans`]: ans, turn: seat });
  }

  // Locking in a guess ends the round for both players.
  function lockGuess(id) {
    guessing = false;
    if (phase() !== 'play' || timeUp()) return;
    rref(`guess/${seat}`).set(id);
  }

  function nextRound() {
    const n = game.round || 1;
    gref('round').transaction(cur => (cur || 1) === n ? n + 1 : cur);
  }

  // Rematch: a fresh game (and a fresh clock) with the same two players in the same seats.
  async function rematch() {
    if (game.next) return go({ game: game.next, p: seat === 'p1' ? 1 : 2 });
    $('#rematch').disabled = true;
    try {
      let c;
      for (let i = 0; i < 8; i++) {
        c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
        if (!(await db.ref('games/' + c).get()).exists()) break;
      }
      await db.ref('games/' + c).update({ created: TS, mins: Number(game.mins) || 5, round: 1 });
      const pl = game.players || {}, copy = {};
      ['p1', 'p2'].forEach(s => { if (pl[s]) copy[s] = { name: pl[s].name, client: pl[s].client, online: false }; });
      await db.ref(`games/${c}/players`).set(copy);
      const res = await gref('next').transaction(cur => cur || c);
      const target = res.snapshot.val() || c;
      go({ game: target, p: seat === 'p1' ? 1 : 2 });
    } catch (e) { $('#rematch').disabled = false; toast('Could not start a rematch. Try again.'); }
  }

  // ---------- modals ----------
  function openModal(sel) { document.querySelectorAll('.modal.show').forEach(m => { if ('#' + m.id !== sel) m.classList.remove('show'); }); $(sel).classList.add('show'); }
  function closeModal(sel) { $(sel).classList.remove('show'); }
  function closeModals() { document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show')); }
  function showInfo(id) {
    const p = person(id); if (!p) return;
    $('#bioImg').src = p.image; $('#bioImg').style.objectPosition = `50% ${Number(p.imageY ?? 20)}%`;
    $('#bioName').textContent = p.name; $('#bioRole').textContent = p.position;
    const facts = (p.facts || []).filter(Boolean);
    $('#bioFacts').innerHTML = facts.length ? facts.map(f => `<li>${esc(f)}</li>`).join('') : '<li>No facts added yet.</li>';
    $('#bioSrc').innerHTML = p.source ? `Read more on <a href="${esc(p.source)}" target="_blank" rel="noopener">Wikipedia</a>` : '';
    openModal('#infoModal');
  }

  // ---------- events ----------
  function cardAction(id) {
    if (!game || !seat) return;
    const ph = phase(), r = R();
    if (ph === 'pick') {
      if (r.locked && r.locked[seat]) return;
      pickId = pickId === id ? null : id; renderGame(); return;
    }
    if (needSecret) { store.set(secretKey(), id); needSecret = false; rref(`reveal/${seat}`).set(id); return; }
    if (ph !== 'play') return;
    const out = myOut();
    if (guessing) { if (!out.has(id)) lockGuess(id); return; }
    out.has(id) ? out.delete(id) : out.add(id);
    store.set(outKey(), [...out]);
    renderGame();
  }
  grid.addEventListener('click', e => {
    const info = e.target.closest('.info');
    if (info) { e.stopPropagation(); return showInfo(info.dataset.info); }
    const card = e.target.closest('.card'); if (card) cardAction(card.dataset.id);
  });
  grid.addEventListener('keydown', e => {
    if (e.target.classList.contains('card') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cardAction(e.target.dataset.id); }
  });

  $('#newGame').addEventListener('click', newGame);
  $('#joinForm').addEventListener('submit', e => { e.preventDefault(); joinGame($('#joinCode').value); });
  $('#seats').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.claim) claim(b.dataset.claim);
    if (b.dataset.go) go({ game: code, p: b.dataset.go === 'p1' ? 1 : 2 });
    if (b.dataset.take) { gref(`players/${b.dataset.take}/client`).set(CLIENT).then(() => go({ game: code, p: b.dataset.take === 'p1' ? 1 : 2 })); }
  });
  $('#seats').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('name-')) claim(e.target.id.slice(5)); });
  $('#copyLobby').addEventListener('click', () => copy(linkFor(code)));
  $('#copyPick').addEventListener('click', () => copy(linkFor(code)));

  $('#players').addEventListener('change', e => {
    if (e.target.id !== 'myName') return;
    const v = e.target.value.trim().slice(0, 24);
    if (v) gref(`players/${seat}/name`).set(v); else e.target.value = pname(seat);
  });
  $('#players').addEventListener('keydown', e => { if (e.target.id === 'myName' && e.key === 'Enter') e.target.blur(); });

  $('#lockPick').addEventListener('click', lockPick);
  $('#pickSlot').addEventListener('click', e => {
    if (e.target.id !== 'unlock') return;
    pickId = mySecret(); rref('locked/' + seat).remove();
  });
  $('#mySlot').addEventListener('click', e => { if (e.target.id === 'toggleHide') { concealed = !concealed; renderGame(); } });
  $('#askArea').addEventListener('submit', e => { e.preventDefault(); const t = $('#askText'); ask(t.value); t.value = ''; t.blur(); });
  $('#askArea').addEventListener('change', e => { if (e.target.id === 'askPick' && e.target.value) { $('#askText').value = e.target.value; e.target.value = ''; $('#askText').focus(); } });
  $('#askArea').addEventListener('click', e => {
    const b = e.target.closest('[data-ans]'); if (b) return answer(b.dataset.q, b.dataset.ans);
    if (e.target.id === 'passTurn') return passTurn();
    if (e.target.id === 'typeToggle') { typeOpen = !typeOpen; $('#askArea').innerHTML = ''; renderGame(); if (typeOpen && $('#askText')) $('#askText').focus(); }
  });
  $('#tstate').addEventListener('click', e => { if (e.target.id === 'startClock') startTimer(); });
  $('#guessBtn').addEventListener('click', () => { guessing = !guessing; renderGame(); });
  $('#again').addEventListener('click', () => { nextAt[roundKey()] = Infinity; nextRound(); });
  $('#rematch').addEventListener('click', rematch);
  $('#home').addEventListener('click', () => { closeModals(); go({}); });
  $('#howBtn').addEventListener('click', () => openModal('#howModal'));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {
    if (m.id === 'resultModal' || m.id === 'finalModal') return;
    if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('show');
  }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal.show');
    if (open && open.id !== 'resultModal' && open.id !== 'finalModal') open.classList.remove('show');
    else if (guessing) { guessing = false; renderGame(); }
  });
  new ResizeObserver(() => layout()).observe(board);

  // ---------- start ----------
  // People, facts and example questions live in the database (edited in /admin);
  // data/data.json is the starter set used until admin saves for the first time.
  db.ref('content').get()
    .then(snap => snap.exists() ? snap.val() : fetch('data/data.json?v=' + Date.now(), { cache: 'no-store' }).then(r => r.json()))
    .then(d => {
      d.people = Array.isArray(d.people) ? d.people : Object.values(d.people || {});
      d.questions = Array.isArray(d.questions) ? d.questions : Object.values(d.questions || {});
      d.settings = d.settings || {};
      data = d;
      $('#title').textContent = data.settings.title || 'Guess Who?';
      $('#edition').textContent = data.settings.edition || '';
      if (document.fonts) document.fonts.ready.then(layout);
      route();
    })
    .catch(err => { show('home'); $('#homeErr').textContent = 'Could not load the game. ' + err.message; });
})();
