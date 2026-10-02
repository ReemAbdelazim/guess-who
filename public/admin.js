(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p, name) => p + '-' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6);

  let token = null;
  try { token = sessionStorage.getItem('gw-token'); } catch {}
  let data = null, dirty = false;

  // ---------- api ----------
  async function api(path, method = 'GET', body) {
    const r = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/api/login') { signOut(); throw new Error('Session expired, please sign in again'); }
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2600);
  }
  function setDirty(v = true) { dirty = v; $('#dirty').textContent = v ? 'Unsaved changes' : ''; }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- auth ----------
  function signOut() { token = null; try { sessionStorage.removeItem('gw-token'); } catch {} $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = '';
    try {
      const { token: t } = await api('/api/login', 'POST', { password: $('#pw').value });
      token = t; try { sessionStorage.setItem('gw-token', t); } catch {}
      await start();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });

  async function start() {
    await api('/api/admin/check');
    data = await (await fetch('/api/data', { cache: 'no-store' })).json();
    data.settings = data.settings || {};
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    renderPeople(); renderQuestions(); renderSettings(); setDirty(false);
  }

  // ---------- tabs ----------
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
    if (b.dataset.tab === 'questions') renderQuestions();
  }));

  // ---------- people ----------
  function renderPeople() {
    $('#people').innerHTML = data.people.map((p, i) => `
      <div class="person" data-i="${i}">
        <div>
          <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : 'No photo'}</div>
          <div class="crop"><label>Photo position</label><input type="range" min="0" max="100" value="${Number(p.imageY ?? 20)}" data-k="imageY" aria-label="Vertical photo position"></div>
        </div>
        <div class="fields">
          <div><label class="f">Name</label><input class="input sm" data-k="name" value="${esc(p.name)}"></div>
          <div><label class="f">Position</label><input class="input sm" data-k="position" value="${esc(p.position)}"></div>
          <div>
            <label class="f">Photo</label>
            <input class="input sm" data-k="lookup" placeholder="Wikipedia name / link, or image URL" value="${esc(p.name)}">
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
    p[el.dataset.k] = el.dataset.k === 'imageY' ? Number(el.value) : el.value;
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
      data.questions.forEach(q => (q.yes = (q.yes || []).filter(id => id !== p.id)));
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
        const isImageUrl = /^https?:\/\//.test(q) && !/wikipedia\.org\/wiki\//.test(q);
        const r = isImageUrl
          ? await api('/api/admin/image-url', 'POST', { url: q, name: p.name })
          : await api('/api/admin/wiki', 'POST', { query: q });
        p.image = r.image; p.source = r.pageUrl || q;
        if (!p.position && r.description) p.position = r.description.replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/^./, c => c.toUpperCase());
        renderPeople(); setDirty(); toast('Photo updated' + (r.title ? ` from “${r.title}”` : ''));
      } catch (err) { msg.textContent = err.message; thumb.classList.remove('busy'); b.disabled = false; }
    }
  });

  $('#file').addEventListener('change', async () => {
    const f = $('#file').files[0]; if (!f || uploadFor === null) return;
    const p = data.people[uploadFor];
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
    try {
      const r = await api('/api/admin/upload', 'POST', { dataUrl, name: p.name || 'upload' });
      p.image = r.image; p.source = ''; renderPeople(); setDirty(); toast('Photo uploaded');
    } catch (err) { toast(err.message, true); }
  });

  $('#addPerson').addEventListener('click', () => {
    data.people.push({ id: uid('p', 'new'), name: '', position: '', image: '', imageY: 20, source: '' });
    renderPeople(); setDirty();
    const last = $('#people').lastElementChild; last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    last.querySelector('[data-k=name]').focus();
  });

  // ---------- questions ----------
  function renderQuestions() {
    $('#questions').innerHTML = data.questions.map((q, i) => {
      const yes = new Set(q.yes || []);
      return `
      <div class="question" data-i="${i}">
        <div class="qhead">
          <span class="num">${i + 1}</span>
          <input class="input sm" data-k="text" value="${esc(q.text)}" placeholder="Is your person…?">
          <button class="linkish" data-act="up" ${i === 0 ? 'disabled' : ''}>Up</button>
          <button class="linkish" data-act="down" ${i === data.questions.length - 1 ? 'disabled' : ''}>Down</button>
          <button class="linkish danger" data-act="delete">Remove</button>
        </div>
        <div class="qhint"><b>${yes.size}</b> answer YES · ${data.people.length - yes.size} answer NO</div>
        <div class="chips">${data.people.map(p => `
          <button class="chip ${yes.has(p.id) ? 'yes' : ''}" data-id="${esc(p.id)}" aria-pressed="${yes.has(p.id)}">
            ${p.image ? `<img src="${esc(p.image)}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : '<span class="ph"></span>'}${esc(p.name || 'Unnamed')}
          </button>`).join('')}</div>
      </div>`;
    }).join('') || '<p class="note">No questions yet.</p>';
  }

  $('#questions').addEventListener('input', e => {
    const row = e.target.closest('.question'); if (!row) return;
    data.questions[row.dataset.i].text = e.target.value; setDirty();
  });
  $('#questions').addEventListener('click', e => {
    const row = e.target.closest('.question'); if (!row) return;
    const i = Number(row.dataset.i), q = data.questions[i];
    const chip = e.target.closest('.chip');
    if (chip) {
      const set = new Set(q.yes || []);
      set.has(chip.dataset.id) ? set.delete(chip.dataset.id) : set.add(chip.dataset.id);
      q.yes = [...set];
      chip.classList.toggle('yes'); chip.setAttribute('aria-pressed', set.has(chip.dataset.id));
      row.querySelector('.qhint').innerHTML = `<b>${set.size}</b> answer YES · ${data.people.length - set.size} answer NO`;
      setDirty(); return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'delete') { if (!confirm('Remove this question?')) return; data.questions.splice(i, 1); }
    if (b.dataset.act === 'up') [data.questions[i - 1], data.questions[i]] = [data.questions[i], data.questions[i - 1]];
    if (b.dataset.act === 'down') [data.questions[i + 1], data.questions[i]] = [data.questions[i], data.questions[i + 1]];
    renderQuestions(); setDirty();
  });
  $('#addQuestion').addEventListener('click', () => {
    data.questions.push({ id: uid('q', 'new'), text: '', yes: [] });
    renderQuestions(); setDirty();
    const last = $('#questions').lastElementChild; last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    last.querySelector('input').focus();
  });

  // ---------- settings ----------
  function renderSettings() {
    $('#s-title').value = data.settings.title || '';
    $('#s-edition').value = data.settings.edition || '';
    $('#s-max').value = data.settings.maxQuestions || 6;
    $('#s-auto').checked = data.settings.autoEliminate !== false;
  }
  $('#s-title').addEventListener('input', e => { data.settings.title = e.target.value; setDirty(); });
  $('#s-edition').addEventListener('input', e => { data.settings.edition = e.target.value; setDirty(); });
  $('#s-max').addEventListener('input', e => { data.settings.maxQuestions = Math.max(1, Number(e.target.value) || 6); setDirty(); });
  $('#s-auto').addEventListener('change', e => { data.settings.autoEliminate = e.target.checked; setDirty(); });

  // ---------- save ----------
  $('#save').addEventListener('click', async () => {
    const blank = data.people.findIndex(p => !p.name.trim());
    if (blank >= 0) return toast('Every person needs a name', true);
    if (data.questions.some(q => !q.text.trim())) return toast('Every question needs text', true);
    try { await api('/api/admin/data', 'PUT', data); setDirty(false); toast('Saved. The game now uses these changes.'); }
    catch (err) { toast(err.message, true); }
  });

  if (token) start().catch(() => signOut());
})();
