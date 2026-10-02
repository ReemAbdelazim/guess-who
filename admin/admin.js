(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p, name) => p + '-' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6);

  // Which repo to save to. On GitHub Pages this is read from the address
  // (owner.github.io/repo/admin/); anywhere else it falls back to these.
  const REPO = (() => {
    const fallback = { owner: 'ReemAbdelazim', repo: 'guess-who' };
    const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return m && seg && seg !== 'admin' ? { owner: m[1], repo: seg } : fallback;
  })();
  const BRANCH = 'main';
  const GH = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;
  document.querySelectorAll('#repoName, #repoName2').forEach(el => (el.textContent = REPO.repo));

  let token = null;
  try { token = sessionStorage.getItem('gw-token') || localStorage.getItem('gw-token'); } catch {}
  let data = null, dataSha = null, dirty = false;
  const previews = {}; // repo path -> local blob URL, shown until GitHub Pages publishes the new photo

  // Image paths in data.json are relative to the site root; this page lives one folder down.
  const src = path => previews[path] || (/^(https?:|data:|blob:)/.test(path) ? path : '../' + path);

  // ---------- GitHub api ----------
  async function gh(path, method = 'GET', body) {
    const r = await fetch(GH + path, {
      method, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { signOut(); throw new Error('GitHub did not accept that token. Check it and sign in again.'); }
    if (r.status === 409 || (r.status === 422 && /sha/i.test(j.message || ''))) throw new Error('Someone else saved changes meanwhile. Reload the page to get them, then redo your edit.');
    if (r.status === 403 || r.status === 404) throw new Error(`This token can't access ${REPO.repo}. Give it Contents: Read and write on that repository.`);
    if (!r.ok) throw new Error(j.message || 'GitHub request failed (' + r.status + ')');
    return j;
  }
  const toB64 = str => {
    const b = new TextEncoder().encode(str); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const blobToB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });

  // Shrink to at most 800px on the long side, as JPEG, so the repo and the game stay fast.
  async function toJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  }

  // Commit a photo to uploads/ and return its path.
  async function savePhoto(blob, name) {
    const jpg = await toJpeg(blob);
    const slug = String(name || 'photo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'photo';
    const path = `uploads/${slug}-${Math.random().toString(16).slice(2, 8)}.jpg`;
    await gh('/contents/' + path, 'PUT', { message: `Add photo for ${name || 'a person'}`, content: await blobToB64(jpg), branch: BRANCH });
    previews[path] = URL.createObjectURL(jpg);
    return path;
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
  function forget() { try { sessionStorage.removeItem('gw-token'); localStorage.removeItem('gw-token'); } catch {} }
  function signOut() { token = null; forget(); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
  $('#signout').addEventListener('click', () => {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    setDirty(false); signOut();
  });
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = '';
    token = $('#pw').value.trim();
    try {
      await start();
      forget();
      try { ($('#remember').checked ? localStorage : sessionStorage).setItem('gw-token', token); } catch {}
      $('#pw').value = '';
    } catch (err) { token = null; $('#loginErr').textContent = err.message; }
  });

  async function start() {
    const repo = await gh('');
    if (!repo.permissions || !repo.permissions.push) throw new Error(`This token can read ${REPO.repo} but can't save to it. Set Contents to Read and write.`);
    const f = await gh(`/contents/data/data.json?ref=${BRANCH}`);
    data = JSON.parse(fromB64(f.content)); dataSha = f.sha;
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
          <div class="thumb">${p.image ? `<img src="${esc(src(p.image))}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : 'No photo'}</div>
          <div class="crop"><label>Photo position</label><input type="range" min="0" max="100" value="${Number(p.imageY ?? 20)}" data-k="imageY" aria-label="Vertical photo position"></div>
        </div>
        <div class="fields">
          <div><label class="f">Name</label><input class="input sm" data-k="name" value="${esc(p.name)}"></div>
          <div><label class="f">Position</label><input class="input sm" data-k="position" value="${esc(p.position)}"></div>
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
        const r = await wikiLookup(q);
        p.image = await savePhoto(r.blob, p.name || r.title); p.source = r.pageUrl;
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
      p.image = await savePhoto(f, p.name || 'upload'); p.source = '';
      renderPeople(); setDirty(); toast('Photo uploaded. Click Save changes to use it.');
    } catch (err) { if (thumb) thumb.classList.remove('busy'); toast(err.message, true); }
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
            ${p.image ? `<img src="${esc(src(p.image))}" alt="" style="object-position:50% ${Number(p.imageY ?? 20)}%">` : '<span class="ph"></span>'}${esc(p.name || 'Unnamed')}
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
    if (data.people.some(p => !p.name.trim())) return toast('Every person needs a name.', true);
    if (data.questions.some(q => !q.text.trim())) return toast('Every question needs text.', true);
    const btn = $('#save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await gh('/contents/data/data.json', 'PUT', {
        message: 'Update Guess Who people and questions',
        content: toB64(JSON.stringify(data, null, 2) + '\n'), sha: dataSha, branch: BRANCH,
      });
      dataSha = r.content.sha; setDirty(false);
      toast('Saved. The game updates in about a minute.');
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  });

  if (token) start().catch(() => signOut());
})();
