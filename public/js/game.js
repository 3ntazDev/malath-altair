/* ==========================================================
   ملاذ الطير — client  ·  Developer: المبرمج فهد
   الواجهة تعرض فقط ما يرسله الخادم لهذا اللاعب.
   الجلسة: token في المتصفح (هوية فقط) — كل الحالة في الخادم.
   ========================================================== */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $modal = document.getElementById('modal');
  const $net = document.getElementById('net');
  const $fx = document.getElementById('fx');

  const tokenStore = {
    get: () => { try { return localStorage.getItem('ib_session'); } catch { return null; } },
    set: (v) => { try { localStorage.setItem('ib_session', v); } catch {} },
    del: () => { try { localStorage.removeItem('ib_session'); } catch {} },
  };

  const S = {
    cfg: null, token: tokenStore.get(), user: null, view: null, offset: 0,
    screen: 'name', pick: null, pendingJoin: null, takenInRoom: [], formError: '', notice: '',
    draft: null, joinCode: '', matchId: null, chats: new Map(), unread: new Map(), activeChat: null,
    sheet: null, pulseVote: false, drafts: {}, spyPick: null, votePick: null, dismissed: null, phaseKey: null,
    seen: new Set(), seenSlots: new Set(), lobbyPick: false, busy: false, booting: true,
  };

  // ---------------- utils ----------------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now() + S.offset;
  const fmt = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const clock = (ts) => new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  const ch = (id) => (S.cfg && S.cfg.characters.find((c) => c.characterId === id)) || { characterName: '—', title: '', characterImage: '', characterPortrait: '' };
  const portrait = (id, alt = '') => `<img src="${esc(ch(id).characterPortrait)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  const art = (id, alt = '') => `<img src="${esc(ch(id).characterImage)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  const once = (key) => { if (S.seen.has(key)) return false; S.seen.add(key); return true; };
  let toastT;
  function toast(text, bad = false) {
    $toast.innerHTML = `<div class="${bad ? 'bad' : ''}">${esc(text)}</div>`;
    clearTimeout(toastT);
    toastT = setTimeout(() => ($toast.innerHTML = ''), 3200);
  }
  function flash(kind) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const d = document.createElement('div');
    d.className = `flash ${kind}`;
    $fx.appendChild(d);
    setTimeout(() => d.remove(), 800);
    if (navigator.vibrate && kind !== 'spy') try { navigator.vibrate(kind === 'blood' ? [60, 40, 120] : 40); } catch {}
  }

  // ---------------- modal ----------------
  let modalResolve = null;
  function ask({ title, body, ok = 'تأكيد', cancel = 'إلغاء', danger = false }) {
    if (modalResolve) modalResolve(false);
    $modal.innerHTML = `<div class="modal-back"><div class="modal panel" role="alertdialog" aria-modal="true" aria-labelledby="mt" aria-describedby="mb">
      <h2 id="mt">${esc(title)}</h2><p id="mb">${esc(body)}</p>
      <div class="row"><button class="gbtn ghost" data-modal="0">${esc(cancel)}</button><button class="gbtn ${danger ? 'danger' : 'primary'}" data-modal="1">${esc(ok)}</button></div>
    </div></div>`;
    $modal.hidden = false;
    $modal.querySelector('[data-modal="0"]').focus();
    return new Promise((res) => (modalResolve = res));
  }
  function closeModal(v) {
    $modal.hidden = true;
    $modal.innerHTML = '';
    const r = modalResolve;
    modalResolve = null;
    if (r) r(v);
  }
  $modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-modal]');
    if (b) closeModal(b.dataset.modal === '1');
    else if (e.target.classList.contains('modal-back')) closeModal(false);
  });

  // ---------------- API ----------------
  async function api(path, body = {}) {
    try {
      const r = await fetch(`/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({ ok: false, error: 'استجابة غير صالحة من الخادم.' }));
      $net.hidden = true;
      if (data.code === 'NO_SESSION') resetSession();
      return data;
    } catch {
      $net.hidden = false;
      return { ok: false, code: 'NETWORK', error: 'تعذر الاتصال بالخادم. تحقق من الإنترنت.' };
    }
  }
  function resetSession() {
    tokenStore.del();
    Object.assign(S, { token: null, user: null, view: null, screen: 'name', matchId: null });
    disconnectRealtime();
    render();
  }

  // ---------------- realtime ----------------
  let rt = null;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function connectRealtime() {
    if (rt || !S.user || !S.cfg) return;
    const c = S.cfg.realtime;
    const handlers = {
      sync: () => scheduleSync(),
      chat: (m) => addMessage(m, true),
      ability: () => scheduleSync(0),
      host: () => toast('👑 أصبحت الـHost لهذه الغرفة.'),
      removed: ({ reason }) => {
        S.view = null; S.matchId = null; S.screen = 'menu';
        S.notice = reason === 'KICKED' ? 'تمت إزالتك من الغرفة بواسطة الـHost.' : 'أُلغيت الغرفة.';
        if (modalResolve) closeModal(false);
        render();
      },
    };
    if (c.driver === 'none') {
      // وضع احتياطي بدون Pusher: تحديث سريع
      const iv = setInterval(async () => {
        if (!S.user || !S.view) return;
        sync();
        if (S.view.match && S.sheet && S.sheet.type === 'chat') {
          const r = await api('chat/history');
          if (r.ok) r.messages.forEach((m) => addMessage(m, true));
        }
      }, 2000);
      rt = { kind: 'none', close: () => clearInterval(iv) };
      return;
    }
    if (c.driver === 'pusher') {
      rt = { kind: 'pusher' };
      if (!window.Pusher) await loadScript('https://js.pusher.com/8.2.0/pusher.min.js');
      const p = new window.Pusher(c.key, {
        cluster: c.cluster,
        channelAuthorization: { endpoint: '/api/realtime/auth', transport: 'ajax', headers: { Authorization: `Bearer ${S.token}` } },
      });
      const channel = p.subscribe(`private-user-${S.user.id}`);
      for (const [ev, fn] of Object.entries(handlers)) channel.bind(ev, fn);
      p.connection.bind('state_change', ({ current }) => {
        $net.hidden = current === 'connected';
        if (current === 'connected') scheduleSync(0);
      });
      rt.close = () => p.disconnect();
    } else {
      const es = new EventSource(`/api/realtime/stream?token=${encodeURIComponent(S.token)}`);
      for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => fn(JSON.parse(e.data)));
      es.onopen = () => { $net.hidden = true; scheduleSync(0); };
      es.onerror = () => { $net.hidden = false; };
      rt = { kind: 'sse', close: () => es.close() };
    }
  }
  function disconnectRealtime() { if (rt && rt.close) rt.close(); rt = null; }

  // ---------------- sync (server state for this player) ----------------
  let syncing = false, syncAgain = false, syncTimer = null;
  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, delay ?? Math.random() * 60);
  }
  async function sync() {
    if (!S.user) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const r = await api('sync');
      if (r.ok) applyView(r.inRoom ? r.view : null);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(0); }
    }
  }
  function applyView(v) {
    if (!v) {
      if (S.view) { S.view = null; S.matchId = null; S.screen = 'menu'; }
      return render();
    }
    S.offset = v.serverTime - Date.now();
    const mid = v.match ? v.match.id : null;
    if (mid !== S.matchId) {
      Object.assign(S, { matchId: mid, chats: new Map(), unread: new Map(), sheet: null, spyPick: null, votePick: null, drafts: {} });
      if (mid) api('chat/history').then((r) => { if (r.ok) { r.messages.forEach((m) => addMessage(m, false)); render(); } });
    }
    S.view = v;
    onPhase();
    render();
  }
  function addMessage(m, live) {
    if (!S.user) return;
    const me = S.user.id;
    const partner = m.senderId === me ? m.receiverId : m.senderId;
    const list = S.chats.get(partner) || [];
    const pending = m.clientId && list.find((x) => x.clientId === m.clientId);
    if (pending) { // تأكيد الرسالة المعروضة فورًا
      const changed = pending.pending || pending.id !== m.id;
      Object.assign(pending, m, { pending: false, live: pending.live });
      if (changed && S.view) render();
      return;
    }
    if (list.some((x) => x.id === m.id)) return;
    m.live = live;
    list.push(m);
    list.sort((a, b) => a.createdAt - b.createdAt);
    S.chats.set(partner, list);
    const viewing = S.sheet && S.sheet.type === 'chat' && S.sheet.id === partner;
    if (live && m.senderId !== me && !viewing) {
      S.unread.set(partner, (S.unread.get(partner) || 0) + 1);
      toast(`💬 ${nameOf(partner)}: ${m.text.slice(0, 50)}`);
    }
    if (live) render({ bottom: viewing });
  }
  function onPhase() {
    const v = S.view;
    if (!v.match) return;
    const key = `${v.match.id}:${v.match.round}:${v.room.phase}:${v.match.vote ? v.match.vote.attempt : 0}`;
    if (key === S.phaseKey) return;
    S.phaseKey = key;
    S.dismissed = null;
    S.votePick = null;
    const ph = v.room.phase;
    const alive = v.match.myStatus === 'ALIVE';
    S.pulseVote = false;
    const keepChat = ph === 'PRIVATE_CHAT' && S.sheet && S.sheet.type === 'chat';
    if (!keepChat && S.sheet && !['players', 'admin', 'profile'].includes(S.sheet.type)) S.sheet = null;
    if (['ROUND_START', 'LAST_STAND', 'ELIMINATION'].includes(ph) && S.sheet && S.sheet.type !== 'admin') S.sheet = null;
    if (ph === 'ABILITY' && v.match.ability && v.match.ability.canUse) S.sheet = { type: 'spy' };
    if (ph === 'LAST_STAND' && modalResolve) closeModal(false);
    const r = v.match.lastResult;
    if (ph === 'ELIMINATION' && r && r.eliminatedId && once(`fx-el-${key}`)) flash('blood');
    if (ph === 'VOTE_RESULT' && r && r.someoneSaved && once(`fx-sv-${key}`)) flash('shield');
  }

  // ---------------- actions ----------------
  async function act(path, body, okMsg) {
    if (S.busy) return null;
    S.busy = true;
    const r = await api(path, body);
    S.busy = false;
    if (!r.ok) toast(r.error || 'تعذر تنفيذ الإجراء.', true);
    else { if (okMsg) toast(okMsg); if (S.view) scheduleSync(0); }
    render();
    return r.ok ? r : null;
  }

  const A = {
    async 'save-name'() {
      const name = document.getElementById('name').value;
      const r = S.user ? await api('session/name', { name }) : await api('session/register', { name });
      if (!r.ok) { S.formError = r.error; return render(); }
      if (r.token) { S.token = r.token; tokenStore.set(r.token); }
      S.user = r.user;
      S.formError = '';
      S.pick = S.user.characterId;
      S.screen = S.user.characterId ? 'menu' : 'character';
      connectRealtime();
      render();
    },
    'pick'(el) {
      if (el.classList.contains('taken')) return;
      S.pick = el.dataset.id;
      S.popped = el.dataset.id;
      render();
    },
    async 'confirm-char'() {
      if (!S.pick) return;
      const r = await api('session/character', { characterId: S.pick });
      if (!r.ok) { S.formError = r.error; return render(); }
      S.user = r.user;
      S.formError = '';
      if (S.pendingJoin) { S.joinCode = S.pendingJoin; S.pendingJoin = null; S.takenInRoom = []; return A.join(); }
      S.screen = 'menu';
      render();
    },
    'go'(el) { S.screen = el.dataset.to; S.formError = ''; S.notice = ''; if (S.screen === 'character') S.pick = S.user && S.user.characterId; if (S.screen === 'create') S.draft = S.draft || { roomName: '', ...S.cfg.roomDefaults }; render(); },
    'chip'(el) { S.draft[el.dataset.key] = Number(el.dataset.v); if (el.dataset.key === 'MAX_PLAYERS' && S.draft.MIN_PLAYERS > S.draft.MAX_PLAYERS) S.draft.MIN_PLAYERS = S.draft.MAX_PLAYERS; render(); },
    'draft'(el) { S.draft[el.dataset.key] = parseVal(el); render(); },
    async 'create'() {
      const { roomName, ...settings } = S.draft;
      const r = await api('room/create', { roomName, settings });
      if (!r.ok) { S.formError = r.error; return render(); }
      S.formError = '';
      await sync();
    },
    async 'join'() {
      const input = document.getElementById('code');
      const code = ((input && input.value) || S.joinCode || '').trim().toUpperCase();
      S.notice = '';
      if (!code) { S.formError = 'اكتب رمز الغرفة.'; return render(); }
      const r = await api('room/join', { code });
      if (!r.ok) {
        if (r.code === 'CHARACTER_TAKEN') {
          S.pendingJoin = code; S.takenInRoom = r.taken || []; S.pick = null; S.screen = 'character'; S.formError = r.error;
          return render();
        }
        S.screen = 'join'; S.joinCode = code; S.formError = r.error;
        return render();
      }
      S.formError = '';
      await sync();
    },
    'lobby-pick'() { S.lobbyPick = !S.lobbyPick; render(); },
    async 'lobby-char'(el) {
      if (el.classList.contains('taken')) return;
      const r = await act('room/character', { characterId: el.dataset.id });
      if (r) { S.user.characterId = el.dataset.id; S.lobbyPick = false; }
    },
    async 'setting'(el) { await act('room/settings', { settings: { [el.dataset.key]: parseVal(el) } }); },
    async 'lobby-chip'(el) { await act('room/settings', { settings: { [el.dataset.key]: Number(el.dataset.v) } }); },
    async 'room-name'(el) { if (el.value !== S.view.room.name) await act('room/settings', { roomName: el.value }); },
    async 'join-open'() { await act('room/join-open', { open: !S.view.room.joinOpen }); },
    async 'kick'(el) {
      const name = el.dataset.name;
      if (await ask({ title: 'إزالة اللاعب؟', body: `هل أنت متأكد من إزالة ${name} من الغرفة؟ لن يستطيع العودة إليها.`, ok: 'طرد', danger: true })) {
        await act('room/kick', { playerId: el.dataset.id }, `تمت إزالة ${name}.`);
      }
    },
    async 'start'() { await act('room/start'); },
    async 'close'() {
      if (!(await ask({ title: 'إلغاء الغرفة؟', body: 'سيخرج جميع اللاعبين من الغرفة.', ok: 'إلغاء الغرفة', cancel: 'رجوع', danger: true }))) return;
      if (await act('room/close')) { S.view = null; S.screen = 'menu'; render(); }
    },
    async 'leave'() {
      const v = S.view;
      const live = v && v.match && !['LOBBY', 'GAME_OVER'].includes(v.room.phase) && v.match.myStatus === 'ALIVE';
      if (live && !(await ask({ title: 'مغادرة المباراة؟', body: 'الخروج أثناء المباراة يعني إقصاءك منها.', ok: 'مغادرة', danger: true }))) return;
      if (await act('room/leave')) { S.view = null; S.matchId = null; S.screen = 'menu'; render(); }
    },
    async 'copy'() {
      try { await navigator.clipboard.writeText(S.view.room.code); toast('تم نسخ رمز الغرفة.'); } catch { toast(S.view.room.code); }
    },
    async 'share'() {
      const text = `انضم لي في ملاذ الطير 🦅 — رمز الغرفة: ${S.view.room.code}`;
      if (navigator.share) try { await navigator.share({ title: 'ملاذ الطير', text, url: location.origin }); return; } catch {}
      A.copy();
    },
    'tok'(el) {
      const id = el.dataset.id, m = S.view.match;
      if (m.vote && isCandidate(id)) { S.votePick = id; S.pulseVote = false; S.sheet = null; return render(); }
      S.sheet = { type: id === S.user.id ? 'profile' : 'char', id };
      render();
    },
    'sheet'(el) { S.sheet = { type: el.dataset.sheet, id: el.dataset.id || null }; render(); },
    'close-sheet'() { S.sheet = null; render(); },
    'open-chat'(el) { S.sheet = { type: 'chat', id: el.dataset.id }; S.unread.delete(el.dataset.id); render({ bottom: true }); setTimeout(() => { const c = document.getElementById('composer'); if (c && matchMedia('(min-width: 900px)').matches) c.focus(); }, 50); },
    'select-vote'(el) { S.votePick = el.dataset.id; S.sheet = null; render(); },
    'cancel-pick'() { S.votePick = null; render(); },
    'vote-btn'() {
      const v = S.view, m = v.match;
      if (v.room.phase !== 'VOTING' || m.myStatus !== 'ALIVE' || !m.vote) return toast('التصويت يُفتح بعد المحادثات والجاسوس.');
      if (m.vote.myVote) return toast(`صوتك مسجّل ضد ${nameOf(m.vote.myVote)}. لا يمكن تغييره.`);
      if (S.votePick) return A.vote();
      S.sheet = null; S.pulseVote = true; toast('اضغط على الشخصية التي تريد إخراجها من الجزيرة.'); render();
      setTimeout(() => { S.pulseVote = false; render(); }, 2400);
    },
    async 'admin-remove'(el) {
      if (await ask({ title: 'REMOVE PLAYER?', body: `هل أنت متأكد من إزالة ${el.dataset.name} من الغرفة؟ سيُقصى من المباراة ولن يستطيع العودة.`, ok: 'إزالة', cancel: 'إلغاء', danger: true })) {
        await act('room/kick', { playerId: el.dataset.id }, `تمت إزالة ${el.dataset.name}.`);
      }
    },
    async 'end-game'() {
      if (await ask({ title: 'END GAME?', body: 'سيتم إنهاء المباراة فورًا لجميع اللاعبين، بدون إعلان فائزين.', ok: 'END GAME', cancel: 'إلغاء', danger: true })) {
        if (await act('match/end')) S.sheet = null;
      }
    },
    async 'pause'() { await act('match/pause', {}, '⏸ تم إيقاف اللعبة مؤقتًا.'); },
    async 'resume'() { await act('match/resume', {}, '▶ استؤنفت اللعبة.'); },
    async 'send'() {
      const input = document.getElementById('composer');
      const text = input.value.trim();
      const to = S.sheet && S.sheet.id;
      if (!text || !to) return;
      const clientId = (crypto.randomUUID && crypto.randomUUID()) || `c${Date.now()}${Math.random().toString(36).slice(2)}`;
      input.value = '';
      S.drafts[to] = '';
      // عرض فوري قبل رد الخادم
      addMessage({ id: `tmp-${clientId}`, clientId, senderId: S.user.id, receiverId: to, text, round: S.view.match.round, createdAt: now(), pending: true }, true);
      render({ bottom: true });
      const r = await api('chat/send', { to, text, clientId });
      if (!r.ok) {
        const list = S.chats.get(to) || [];
        S.chats.set(to, list.filter((x) => x.clientId !== clientId));
        const inp = document.getElementById('composer');
        if (inp && !inp.value) { inp.value = text; S.drafts[to] = text; }
        toast(r.error, true);
        return render();
      }
      addMessage(r.message, false);
    },
    'spy-pick'(el) { S.spyPick = { a: el.dataset.a, b: el.dataset.b }; render(); },
    async 'spy-use'() {
      if (!S.spyPick) return;
      const r = await act('ability/use', { input: S.spyPick });
      if (r) { S.spyPick = null; S.revealIntel = true; flash('spy'); }
    },
    async 'last-stand'(el) {
      const use = el.dataset.use === '1';
      if (use && !(await ask({ title: 'تفعيل LAST STAND؟', body: 'مرة واحدة في المباراة. إن لم تكن أنت المستهدف تضيع.', ok: '🛡️ فعّلها' }))) return;
      const r = await act('last-stand', { use }, use ? '🛡️ قرارك مسجل.' : 'قرارك مسجل: عدم الاستخدام.');
      if (r && use) flash('shield');
    },
    async 'vote'() {
      const p = S.votePick && player(S.votePick);
      if (!p) return;
      const r = await act('vote', { targetId: S.votePick }, `🗳️ صوتك ضد ${ch(p.characterId).characterName} مسجّل.`);
      if (r && navigator.vibrate) try { navigator.vibrate(30); } catch {}
    },
    'dismiss'() { S.dismissed = S.phaseKey; render(); },
    async 'again'() { await act('match/again'); },
    async 'to-lobby'() { await act('match/lobby'); },
  };
  function parseVal(el) {
    if (el.dataset.kind === 'number') return Number(el.value);
    if (el.dataset.kind === 'bool') return el.value === 'true';
    return el.value;
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    e.preventDefault();
    if (A[el.dataset.act]) A[el.dataset.act](el);
  });
  // زر الإرسال لا يسحب التركيز من حقل الكتابة (تبقى لوحة المفاتيح مفتوحة)
  document.addEventListener('pointerdown', (e) => { if (e.target.closest('.send')) e.preventDefault(); });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-act], input[data-act]');
    if (el && A[el.dataset.act]) A[el.dataset.act](el);
  });
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'composer' && S.sheet && S.sheet.id) S.drafts[S.sheet.id] = e.target.value;
    if (id === 'code') S.joinCode = e.target.value.toUpperCase();
    if (id === 'room-name-draft' && S.draft) S.draft.roomName = e.target.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalResolve) return closeModal(false);
    if (e.key === 'Escape' && S.sheet) { S.sheet = null; return render(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="radio"][data-act]')) { e.preventDefault(); return A[e.target.dataset.act](e.target); }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const id = e.target.id;
    if (id === 'composer') { e.preventDefault(); A.send(); }
    if (id === 'name') { e.preventDefault(); A['save-name'](); }
    if (id === 'code') { e.preventDefault(); A.join(); }
    if (id === 'room-name') { e.preventDefault(); e.target.blur(); }
  });

  // ---------------- view helpers ----------------
  const player = (id) => (S.view && S.view.match ? S.view.match.players.find((p) => p.id === id) : null);
  const nameOf = (id) => { const p = player(id); if (p) return p.name; const m = S.view && S.view.room.members.find((x) => x.id === id); return m ? m.name : '—'; };
  const credit = () => '<p class="credit" dir="ltr">Developer: <b dir="rtl">المبرمج فهد</b></p>';
  const steps = (n) => `<div class="steps" aria-label="الخطوة ${n} من 3">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

  const PHASES = {
    ROUND_START: ['بداية الجولة', 'استعد… الجزيرة تستيقظ.'],
    PRIVATE_CHAT: ['المحادثات الخاصة', 'تحالف، اكذب، أو اكشف. لا اتفاق ملزم.'],
    ABILITY: ['مرحلة الجاسوس', 'ربما يقرأ أحدهم محادثاتك الآن.'],
    VOTING: ['التصويت', 'صوت واحد. سري. نهائي.'],
    LAST_STAND: ['فرز الأصوات', 'النتيجة تُعلن بعد لحظات.'],
    VOTE_RESULT: ['نتيجة التصويت', ''],
    ELIMINATION: ['الإقصاء', ''],
  };

  // ---------------- screens: entry ----------------
  function screenName() {
    return `<div class="screen"><div class="wrap">
      <div class="logo"><div class="emblem-bird" aria-hidden="true">🦅</div><div class="title-ar">ملاذ الطير</div><div class="tag">تحالف مع من شئت. الجميع يستطيع الخيانة.</div></div>
      ${steps(1)}
      <div class="panel stack">
        <h1 class="display h2 center">ما اسمك؟</h1>
        <input id="name" class="field" maxlength="${S.cfg.limits.nameMax}" autocomplete="nickname" enterkeyhint="next" placeholder="اكتب اسمك…" value="${esc(S.user ? S.user.name : '')}" aria-label="اسمك">
        <p class="err" role="alert">${esc(S.formError)}</p>
        <button class="gbtn primary block" data-act="save-name">متابعة</button>
      </div>
      ${credit()}
    </div></div>`;
  }

  function charCards(selected, taken, act) {
    return `<div class="cgrid" role="radiogroup" aria-label="الشخصيات">${S.cfg.characters.map((c) => {
      const isTaken = taken.includes(c.characterId) && c.characterId !== selected;
      const isSel = selected === c.characterId;
      return `<div class="ccard ${isSel ? 'selected' : ''} ${isTaken ? 'taken' : ''} ${isSel && S.popped === c.characterId ? 'pop' : ''}" data-act="${act}" data-id="${c.characterId}" role="radio" aria-checked="${isSel}" aria-disabled="${isTaken}" tabindex="0">
        ${art(c.characterId, c.characterName)}
        <div class="plate"><div class="cname">${esc(c.characterName)}</div>${c.nameAr ? `<div class="cname-ar">${esc(c.nameAr)}</div>` : ''}<div class="ctitle">${esc(c.title)}</div>
        <button class="sel" tabindex="-1">${isTaken ? 'غير متاحة' : isSel ? 'مختارة' : 'اختيار'}</button></div>
      </div>`;
    }).join('')}</div>`;
  }

  function screenCharacter() {
    const html = `<div class="screen"><div class="wrap wide">
      ${steps(2)}
      <h1 class="display h1 center">اختر شخصيتك</h1>
      <p class="muted center" style="margin:6px 0 16px">شخصيتك هويتك على الجزيرة فقط. القدرات السرية تُوزّع عشوائيًا.</p>
      ${S.formError ? `<p class="notice" role="alert" style="max-width:560px;margin:0 auto 14px">${esc(S.formError)}</p>` : ''}
      ${charCards(S.pick, S.takenInRoom, 'pick')}
      <div class="sticky-cta"><div class="wrap">
        <button class="gbtn primary block" data-act="confirm-char" ${S.pick ? '' : 'disabled'}>${S.pick ? `متابعة بـ ${esc(ch(S.pick).nameAr || ch(S.pick).characterName)}` : 'اختر شخصية للمتابعة'}</button>
      </div></div>
    </div></div>`;
    S.popped = null;
    return html;
  }

  function screenMenu() {
    const c = ch(S.user.characterId);
    return `<div class="screen"><div class="wrap">
      <div class="logo" style="margin:2vh 0 18px"><div class="title-ar sm">ملاذ الطير</div></div>
      <div class="hero-char">${art(S.user.characterId, c.characterName)}<div class="badge-name">${esc(c.characterName)}</div></div>
      <h1 class="display h2 center" style="margin-top:26px">أهلًا، ${esc(S.user.name)}</h1>
      <p class="center" style="margin:4px 0 18px"><button class="linkbtn" data-act="go" data-to="character">تغيير الشخصية</button> <button class="linkbtn" data-act="go" data-to="name">تغيير الاسم</button></p>
      ${S.notice ? `<p class="notice" role="alert">${esc(S.notice)}</p>` : ''}
      <div class="stack menu-btns" style="margin-top:14px">
        <button class="gbtn primary block" data-act="go" data-to="create">إنشاء مباراة</button>
        <button class="gbtn block" data-act="go" data-to="join">انضمام لمباراة</button>
      </div>
      ${credit()}
    </div></div>`;
  }

  function chipRow(src, key, from, to, act, min = 0) {
    const vals = [];
    for (let i = from; i <= to; i++) vals.push(i);
    return `<div class="chips" role="radiogroup">${vals.map((n) => `<button class="chip" data-act="${act}" data-key="${key}" data-v="${n}" aria-pressed="${src[key] === n}" ${n < min ? 'disabled' : ''}>${n}</button>`).join('')}</div>`;
  }
  const SECS = (arr) => arr.map((x) => [x, x >= 60 ? `${x / 60} دقيقة` : `${x} ثانية`]);
  function sel(src, key, opts, kind, act, enabled) {
    if (!opts.some(([v]) => String(v) === String(src[key]))) opts = [[src[key], kind === 'number' ? `${src[key]} ثانية` : String(src[key])], ...opts];
    return `<select data-act="${act}" data-key="${key}" data-kind="${kind}" ${enabled ? '' : 'disabled'}>${opts.map(([v, l]) => `<option value="${v}" ${String(src[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  function advanced(src, act, enabled, members = 0) {
    const f = (k, o, kind) => sel(src, k, o, kind, act, enabled);
    const onOff = [[true, 'مفعّل'], [false, 'معطّل']];
    const mins = [];
    for (let i = 3; i <= (src.MAX_PLAYERS || 15); i++) mins.push([i, `${i} لاعبين`]);
    return `<div class="sgrid">
      <label>الحد الأدنى للبدء ${f('MIN_PLAYERS', mins, 'number')}</label>
      <label>عند التعادل ${f('TIE_RULE', [['RANDOM', 'قرعة عشوائية'], ['NO_ELIMINATION', 'لا إقصاء'], ['REVOTE', 'إعادة تصويت']], 'string')}</label>
      <label>المحادثات ${f('CHAT_DURATION', SECS([60, 120, 180, 300, 420, 600]), 'number')}</label>
      <label>التصويت ${f('VOTING_DURATION', SECS([30, 45, 60, 90, 120]), 'number')}</label>
      <label>👁️ الجاسوس ${f('SPY_ENABLED', onOff, 'bool')}</label>
      <label>مدة الجاسوس ${f('ABILITY_DURATION', SECS([15, 20, 30, 45, 60]), 'number')}</label>
      <label>🛡️ LAST STAND ${f('LAST_STAND_ENABLED', onOff, 'bool')}</label>
      <label>نافذة LAST STAND ${f('LAST_STAND_DURATION', SECS([5, 8, 10, 15, 20]), 'number')}</label>
      <label>المُقصى يشاهد ${f('ALLOW_SPECTATORS', [[true, 'نعم'], [false, 'لا']], 'bool')}</label>
    </div>`;
  }

  function screenCreate() {
    const d = S.draft;
    return `<div class="screen"><div class="wrap">
      <button class="linkbtn" data-act="go" data-to="menu">→ رجوع</button>
      <h1 class="display h1" style="margin:8px 0 16px">إنشاء مباراة</h1>
      <div class="panel stack">
        <label class="label" for="room-name-draft">اسم الغرفة (اختياري)</label>
        <input id="room-name-draft" class="field" maxlength="30" placeholder="ملاذ الطير" value="${esc(d.roomName)}">
      </div>
      <div class="panel">
        <h2 class="panel-title">أقصى عدد لاعبين <span class="muted small">حتى ${S.cfg.limits.playerLimit}</span></h2>
        ${chipRow(d, 'MAX_PLAYERS', 4, S.cfg.limits.playerLimit, 'chip')}
        <details class="adv" style="margin-top:14px"><summary>إعدادات متقدمة</summary>${advanced(d, 'draft', true)}</details>
      </div>
      <p class="muted small center" style="margin:14px 0 0">رمز الغرفة يُنشأ تلقائيًا. تنتهي المباراة عند بقاء لاعبَين ويفوز الاثنان.</p>
      <p class="err center" role="alert">${esc(S.formError)}</p>
      <div class="sticky-cta"><button class="gbtn primary block" data-act="create">إنشاء الغرفة</button></div>
    </div></div>`;
  }

  function screenJoin() {
    return `<div class="screen"><div class="wrap">
      <button class="linkbtn" data-act="go" data-to="menu">→ رجوع</button>
      <h1 class="display h1" style="margin:8px 0 16px">انضمام لمباراة</h1>
      <div class="panel stack">
        <label class="label center" for="code">أدخل رمز الغرفة</label>
        <input id="code" class="field code" maxlength="${S.cfg.limits.codeLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" inputmode="text" placeholder="X7K92P" value="${esc(S.joinCode)}">
        <p class="err center" role="alert">${esc(S.formError)}</p>
        <button class="gbtn primary block" data-act="join">انضمام</button>
      </div>
      <p class="muted small center" style="margin-top:14px">تدخل بشخصية ${esc(ch(S.user.characterId).characterName)} — إن كانت مستخدمة في الغرفة ستختار غيرها.</p>
    </div></div>`;
  }

  // ---------------- lobby ----------------
  function screenLobby() {
    const v = S.view, r = v.room, s = r.settings, host = v.me.isHost;
    const cap = s.MAX_PLAYERS;
    const count = r.members.length;
    const taken = r.members.map((m) => m.characterId);
    const reason = count < s.MIN_PLAYERS ? `بانتظار ${s.MIN_PLAYERS - count} لاعب على الأقل للبدء` : '';
    const slots = r.members.map((m) => {
      const isNew = !S.seenSlots.has(m.id);
      S.seenSlots.add(m.id);
      return `<div class="slot ${m.id === v.me.id ? 'me' : ''} ${m.connected ? '' : 'off'} ${isNew ? 'enter' : ''}">
        ${portrait(m.characterId, '')}
        ${m.isHost ? '<span class="crown" title="Host">👑</span>' : ''}
        ${host && m.id !== v.me.id ? `<button class="kick" data-act="kick" data-id="${m.id}" data-name="${esc(m.name)}" aria-label="طرد ${esc(m.name)}">✕</button>` : ''}
        ${m.connected ? '' : '<span class="off-tag">غير متصل</span>'}
        <div class="nm">${esc(m.name)}<small>${esc(ch(m.characterId).characterName)}</small></div>
      </div>`;
    });
    for (let i = count; i < cap; i++) slots.push('<div class="slot empty" aria-hidden="true">+</div>');
    return `<div class="screen"><div class="wrap">
      <div class="lobby-head">
        ${host ? `<input id="room-name" class="room-name-input" data-act="room-name" maxlength="${s.ROOM_NAME_MAX_LENGTH}" placeholder="اسم الغرفة" value="${esc(r.name)}" aria-label="اسم الغرفة">`
          : `<div class="room-name">${esc(r.name || 'ملاذ الطير')}</div>`}
        <div class="muted small" style="margin-top:6px">رمز الغرفة</div>
        <div class="codebox"><span class="code">${esc(r.code)}</span><button class="gbtn sm ghost" data-act="share">مشاركة</button></div>
        <div class="pcount ${r.full ? 'full' : ''}"><span class="muted">اللاعبون</span><span class="n"><b>${count}</b> / ${cap}</span>${r.full ? '<span class="full-tag">ROOM FULL</span>' : ''}</div>
        <div class="muted small">الحد الأدنى ${s.MIN_PLAYERS} · الحد الأقصى ${cap}${r.joinOpen ? '' : ' · 🔒 الانضمام مغلق'}</div>
      </div>
      <div class="slots">${slots.join('')}</div>
      ${reason ? `<p class="muted small center" style="margin-top:12px">${reason}…</p>` : ''}

      <div class="panel" style="margin-top:18px">
        <h2 class="panel-title">شخصيتك <button class="gbtn sm ghost" data-act="lobby-pick">${S.lobbyPick ? 'إغلاق' : 'تغيير'}</button></h2>
        ${S.lobbyPick ? charCards(v.me.characterId, taken, 'lobby-char') : `<div style="display:flex;align-items:center;gap:12px"><div style="width:64px;border-radius:12px;overflow:hidden">${portrait(v.me.characterId)}</div><div><div class="name-latin" style="font-size:1.4rem">${esc(ch(v.me.characterId).characterName)}</div><div class="muted small">${esc(ch(v.me.characterId).title)}</div></div></div>`}
      </div>

      <div class="panel">
        <h2 class="panel-title">إعدادات الغرفة <span class="muted small">${host ? 'تُقفل عند البدء' : 'يحددها الـHost'}</span></h2>
        <div class="label">أقصى عدد لاعبين</div>
        ${host ? chipRow(s, 'MAX_PLAYERS', 4, s.PLAYER_LIMIT, 'lobby-chip', Math.max(4, count)) : `<div class="display h3">${cap} لاعبًا</div>`}
        <details class="adv" style="margin-top:12px" ${host ? '' : ''}><summary>القواعد والتوقيت</summary>${advanced(s, 'setting', host, count)}</details>
        ${host ? `<button class="gbtn sm ghost block" style="margin-top:12px" data-act="join-open">${r.joinOpen ? '🔒 إغلاق الانضمام' : '🔓 فتح الانضمام'}</button>` : ''}
      </div>
      <div style="height:90px"></div>
    </div></div>
    <div class="bottom-bar"><div class="inner">
      ${host ? `<button class="gbtn ghost" data-act="close" style="flex:.6">إلغاء</button><button class="gbtn primary" data-act="start" ${r.canStart ? '' : 'disabled'}>ابدأ المباراة</button>`
        : `<button class="gbtn ghost" data-act="leave" style="flex:.6">مغادرة</button><button class="gbtn" disabled>بانتظار الـHost…</button>`}
    </div></div>`;
  }

  function messagesHtml(msgs, perspective, showNames) {
    let last = null;
    return msgs.map((x) => {
      const sep = x.round !== last ? `<div class="rsep">الجولة ${x.round}</div>` : '';
      last = x.round;
      const anim = x.live && once(`m-${x.id}`) ? 'in' : '';
      const mine = x.senderId === perspective;
      const tick = !showNames && mine ? (x.pending ? ' 🕓' : ' ✓') : '';
      return `${sep}<div class="msg ${mine ? 'mine' : 'theirs'} ${anim} ${x.pending ? 'pending' : ''}">${showNames ? `<span class="from">${esc(nameOf(x.senderId))}</span>` : ''}${esc(x.text)}<time>${clock(x.createdAt)}${tick}</time></div>`;
    }).join('');
  }


  // ==========================================================
  //  ISLAND — عالم اللعبة. العناصر ثابتة في DOM وتُحدَّث جزئيًا
  //  (حتى لا تنقطع الحركات والمؤثرات مع كل تحديث من الخادم).
  // ==========================================================
  const TOD = [['dusk', '🌅 غروب'], ['night', '🌙 ليل'], ['dawn', '🌄 فجر'], ['day', '☀️ نهار']];
  const todOf = (round) => TOD[(Math.max(1, round) - 1) % TOD.length];

  function palm(x, y, s = 1, rot = 0) {
    let leaves = '';
    for (let i = 0; i < 7; i++) {
      const a = rot + i * (360 / 7);
      leaves += `<ellipse cx="0" cy="-34" rx="11" ry="36" transform="rotate(${a})" style="fill:var(--jungle2)"/>`;
      leaves += `<path d="M0 0 L0 -62" transform="rotate(${a})" style="stroke:var(--jungle)" stroke-width="2.5"/>`;
    }
    return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="14" cy="14" rx="46" ry="22" fill="#000" opacity=".18"/><g class="sway">${leaves}<circle r="9" style="fill:var(--wood2)"/></g></g>`;
  }
  function bush(x, y, r) {
    return `<g><circle cx="${x + 6}" cy="${y + 8}" r="${r}" fill="#000" opacity=".2"/><circle cx="${x}" cy="${y}" r="${r}" style="fill:var(--jungle)"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.55}" style="fill:var(--jungle2)"/></g>`;
  }
  function hut(x, y, s = 1, flip = 1) {
    return `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})">
      <ellipse cx="6" cy="44" rx="78" ry="20" fill="#000" opacity=".25"/>
      <rect x="-62" y="10" width="124" height="34" rx="4" style="fill:var(--wood)"/>
      <path d="M-80 16 L0 -58 L80 16 Z" style="fill:var(--wood2)"/>
      <path d="M-60 0 L0 -50 M-30 12 L0 -50 M30 12 L0 -50 M60 0 L0 -50" style="stroke:var(--wood)" stroke-width="3" opacity=".7"/>
      <path d="M-80 16 L80 16" style="stroke:var(--wood)" stroke-width="6"/>
      <rect x="-16" y="18" width="32" height="26" rx="3" fill="#0a0604" opacity=".75"/>
    </g>`;
  }
  function islandSvg() {
    let palms = '';
    [[210, 250, 1.05, 10], [800, 245, 1.1, 30], [140, 420, .95, 50], [870, 430, 1, 5], [330, 175, .9, 20], [680, 170, .95, 40], [120, 610, .9, 25], [880, 640, .95, 15], [500, 150, .8, 12]].forEach((p) => (palms += palm(...p)));
    let bushes = '';
    [[260, 330, 42], [310, 290, 36], [700, 300, 40], [745, 350, 34], [200, 520, 30], [800, 530, 32], [420, 245, 34], [585, 240, 38], [240, 650, 26], [765, 660, 28]].forEach((b) => (bushes += bush(...b)));
    let rocks = '';
    [[92, 520, 26, 18], [930, 560, 30, 20], [150, 760, 22, 14], [860, 780, 26, 16], [60, 380, 18, 12], [640, 895, 20, 12]].forEach(([x, y, rx, ry]) =>
      (rocks += `<ellipse cx="${x + 4}" cy="${y + 6}" rx="${rx}" ry="${ry}" fill="#000" opacity=".25"/><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" style="fill:var(--rock)"/><ellipse cx="${x - rx * 0.3}" cy="${y - ry * 0.35}" rx="${rx * 0.45}" ry="${ry * 0.35}" fill="#fff" opacity=".12"/>`));
    const island = 'M110 520 C100 330 260 170 500 160 C750 150 910 300 905 510 C900 720 760 860 520 870 C280 880 120 730 110 520 Z';
    return `<svg class="island" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="shallow" cx="50%" cy="52%" r="50%"><stop offset=".6" style="stop-color:var(--sea1)"/><stop offset="1" style="stop-color:var(--sea2)" stop-opacity="0"/></radialGradient>
        <radialGradient id="clear" cx="50%" cy="50%" r="50%"><stop offset="0" style="stop-color:var(--dirt2)"/><stop offset="1" style="stop-color:var(--dirt)"/></radialGradient>
      </defs>
      <rect width="1000" height="1000" style="fill:var(--sea2)"/>
      <ellipse cx="505" cy="515" rx="520" ry="450" fill="url(#shallow)"/>
      <ellipse class="wv" cx="505" cy="515" rx="430" ry="372" fill="none" style="stroke:var(--foam)" stroke-width="3"/>
      <ellipse class="wv w2" cx="505" cy="515" rx="430" ry="372" fill="none" style="stroke:var(--foam)" stroke-width="3"/>
      <ellipse class="wv w3" cx="505" cy="515" rx="430" ry="372" fill="none" style="stroke:var(--foam)" stroke-width="3"/>
      ${rocks}
      <path d="${island}" style="fill:var(--sand2)" transform="translate(0 10)"/>
      <path d="${island}" style="fill:var(--sand)"/>
      <path class="foam" d="${island}" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="18 14" opacity=".35"/>
      <path d="M170 480 C170 320 300 215 500 210 C710 205 850 320 850 490 C850 560 820 610 770 640 C700 690 600 700 500 700 C390 700 280 690 220 640 C185 610 170 560 170 480 Z" style="fill:var(--grass)"/>
      <path d="M230 470 C240 360 340 280 500 276 C660 280 760 360 770 470 C700 430 600 410 500 410 C400 410 300 430 230 470 Z" style="fill:var(--grass2)" opacity=".7"/>
      <path d="M470 660 C455 730 430 800 445 880 L555 880 C565 800 540 730 530 660 Z" style="fill:var(--dirt)"/>
      <ellipse cx="500" cy="505" rx="320" ry="188" style="fill:var(--dirt)" opacity=".55"/>
      <ellipse cx="500" cy="505" rx="296" ry="170" fill="url(#clear)"/>
      <g opacity=".5">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle cx="${500 + Math.cos(i * 0.785) * 250}" cy="${505 + Math.sin(i * 0.785) * 140}" r="4" style="fill:var(--sand2)"/>`).join('')}</g>
      ${bushes}
      ${hut(250, 390, 0.95, 1)}${hut(760, 385, 1.05, -1)}
      <g transform="translate(700 830) rotate(28)"><rect x="0" y="-16" width="190" height="32" style="fill:var(--wood2)"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${i * 24}" y="-16" width="3" height="32" style="fill:var(--wood)"/>`).join('')}<rect x="186" y="-22" width="8" height="44" style="fill:var(--wood)"/></g>
      <g transform="translate(410 470) rotate(-8)"><rect x="-38" y="-9" width="76" height="18" rx="9" style="fill:var(--wood)"/><rect x="-38" y="-9" width="76" height="6" rx="3" style="fill:var(--wood2)"/></g>
      <g transform="translate(592 468) rotate(10)"><rect x="-38" y="-9" width="76" height="18" rx="9" style="fill:var(--wood)"/><rect x="-38" y="-9" width="76" height="6" rx="3" style="fill:var(--wood2)"/></g>
      ${palms}
    </svg>`;
  }

  function gameSkeleton() {
    return `<div class="game" id="g">
      <header class="hud" id="g-hud"></header>
      <main class="stage" id="g-stage">
        <div class="world" id="g-world">
          <div class="map" id="g-map">
            ${islandSvg()}
            <div class="torch" style="left:30.5%;top:40%"><i></i></div><div class="torch" style="left:69%;top:39.5%"><i></i></div>
            <div class="glow" aria-hidden="true"></div>
            <div class="fire" id="g-fire" aria-hidden="true"><span class="stones"></span><span class="logs"></span><span class="fl f1"></span><span class="fl f2"></span><span class="fl f3"></span><span class="sp s1"></span><span class="sp s2"></span><span class="sp s3"></span></div>
            <div class="tokens" id="g-tokens"></div>
            <div class="flies" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
            <div class="tint"></div>
          </div>
          <div class="fog" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="vignette"></div>
        </div>
        <div id="g-banner"></div>
        <div id="g-layer"></div>
        <div id="g-sheet"></div>
      </main>
      <nav class="dock" id="g-dock"></nav>
    </div>`;
  }

  // مواقع الشخصيات حول النار (أنت في المقدمة)
  // يحسب نصف قطر الدائرة حسب مساحة الشاشة الفعلية حتى لا تُقص الشخصيات
  function fitRing(count) {
    const w = document.getElementById('g-world');
    const W = (w && w.clientWidth) || 390, H = (w && w.clientHeight) || 600;
    const mapW = Math.max(H, Math.min(W, 1.6 * H));
    const tf = count > 11 ? 0.8 : count > 7 ? 0.9 : count <= 5 ? 1.15 : 1;
    const tok = Math.min(Math.max(52, 0.135 * Math.min(W, H)), W >= 900 ? 128 : 118) * tf;
    const fx = (W / mapW) * 50, fy = (H / mapW) * 50;
    const half = ((tok * 1.12) / 2 / mapW) * 100 + 1.5;
    const tall = ((tok * 1.33 * 0.8) / mapW) * 100;
    const plate = ((tok * 0.5) / mapW) * 100;
    const rx = Math.max(12, Math.min(30, fx - half));
    const ry = Math.max(9, Math.min(18, Math.min(fy - tall - 3, fy - plate - 4)));
    return { rx, ry, tf };
  }
  function layout(m, me, phase) {
    const r = m.lastResult;
    const keep = (p) => p.status === 'ALIVE' || (phase === 'ELIMINATION' && r && p.id === r.eliminatedId);
    const list = m.players.filter(keep);
    const hasMe = list.some((p) => p.id === me);
    const others = list.filter((p) => p.id !== me);
    const n = others.length;
    const { rx, ry, tf } = fitRing(list.length);
    const cx = 50, cy = 51;
    const pos = new Map();
    const put = (id, deg) => {
      const t = (deg * Math.PI) / 180;
      const depth = (Math.sin(t) + 1) / 2;
      pos.set(id, { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t), s: 0.78 + 0.3 * depth });
    };
    if (hasMe) put(me, 90);
    others.forEach((p, k) => put(p.id, 90 + ((k + 1) * 360) / (n + 1)));
    return { list, pos, count: list.length, tf };
  }

  function tokenHtml(p, o) {
    const c = ch(p.characterId);
    return `<span class="tk-ring"></span><span class="tk-shadow"></span>
      ${o.me ? '<span class="tk-you">أنت</span>' : ''}
      ${o.unread ? `<span class="tk-bubble">💬${o.unread > 1 ? o.unread : ''}</span>` : ''}
      <span class="tk-body"><img src="${esc(c.characterImage)}" alt="" draggable="false"></span>
      ${p.isHost ? '<span class="tk-crown" title="Host">👑</span>' : ''}
      ${o.voted ? '<span class="tk-mark">🗳️</span>' : ''}
      <span class="tk-plate"><b>${esc(c.characterName)}</b><small>${esc(p.name)}${p.connected || p.left ? '' : ' · ⚠︎'}</small></span>`;
  }

  function syncTokens(root, items) {
    const existing = new Map([...root.children].map((el) => [el.dataset.id, el]));
    for (const it of items) {
      let el = existing.get(it.id);
      if (!el || el.classList.contains('exit')) {
        el = document.createElement('button');
        el.dataset.id = it.id;
        el.dataset.act = 'tok';
        el.className = 'tok enter';
        root.appendChild(el);
        setTimeout(() => el.classList.remove('enter'), 700);
      }
      existing.delete(it.id);
      el.style.left = `${it.x}%`;
      el.style.top = `${it.y}%`;
      el.style.setProperty('--s', it.s.toFixed(3));
      el.style.setProperty('--i', it.i);
      el.style.setProperty('--acc', it.acc);
      el.style.zIndex = String(Math.round(it.y * 10));
      el.setAttribute('aria-label', it.label);
      const enter = el.classList.contains('enter') ? ' enter' : '';
      if (el.dataset.cls !== it.cls) { el.className = `tok ${it.cls}${enter}`; el.dataset.cls = it.cls; }
      if (el.__h !== it.html) { el.innerHTML = it.html; el.__h = it.html; }
    }
    for (const el of existing.values()) {
      if (el.classList.contains('exit')) continue;
      el.classList.add('exit');
      setTimeout(() => el.remove(), 700);
    }
  }

  function patch(id, html) {
    const el = document.getElementById(id);
    if (el && el.__h !== html) {
      const body = el.querySelector('.sheet-body');
      const keep = body ? body.scrollTop : 0;
      const sameSheet = el.__k && el.__k === (S.sheet && S.sheet.type + (S.sheet.id || ''));
      el.innerHTML = html;
      el.__h = html;
      el.__k = S.sheet && S.sheet.type + (S.sheet.id || '');
      const nb = el.querySelector('.sheet-body');
      if (nb && sameSheet) nb.scrollTop = keep;
    }
  }

  const isCandidate = (id) => {
    const vt = S.view.match.vote;
    return !!(vt && vt.candidates.includes(id) && !vt.myVote && S.view.match.myStatus === 'ALIVE');
  };
  const chatOpen = () => S.view.room.settings.CHAT_PHASES.includes(S.view.room.phase) && !S.view.room.paused;

  function updateWorld() {
    const v = S.view, m = v.match, ph = v.room.phase, me = S.user.id;
    const [tod] = todOf(m.round);
    const world = document.getElementById('g-world');
    const map = document.getElementById('g-map');
    const L = layout(m, me, ph);
    const r = m.lastResult;
    const focusId = ph === 'ELIMINATION' && r ? r.eliminatedId || r.savedId : ph === 'VOTE_RESULT' && r && r.savedId ? r.savedId : null;
    const dim = ['LAST_STAND', 'VOTE_RESULT'].includes(ph) || v.room.paused;
    world.className = `world tod-${tod} ph-${ph.toLowerCase()} ${dim ? 'dim' : ''} ${focusId ? 'cine' : ''} ${ph === 'VOTING' && m.vote && !m.vote.myVote && m.myStatus === 'ALIVE' ? 'voting' : ''} ${S.pulseVote ? 'pulse' : ''}`;
    const f = focusId && L.pos.get(focusId);
    map.style.setProperty('--zoom', f ? '1.45' : '1');
    // الكاميرا تتجه للشخصية وتضعها في منتصف الشاشة
    map.style.setProperty('--dx', `${f ? (50 - f.x).toFixed(2) : 0}%`);
    map.style.setProperty('--dy', `${f ? (50 - (f.y - 7)).toFixed(2) : 0}%`);
    map.style.setProperty('--tf', String(L.tf));
    document.getElementById('g-fire').style.zIndex = '510';
    const voted = m.vote && m.vote.myVote;
    const items = L.list.map((p, i) => {
      const o = L.pos.get(p.id);
      const leaving = ph === 'ELIMINATION' && r && p.id === r.eliminatedId;
      const saved = r && r.savedId === p.id && ['VOTE_RESULT', 'ELIMINATION'].includes(ph);
      const cls = [
        p.id === me ? 'me' : '',
        isCandidate(p.id) ? 'votable' : '',
        S.votePick === p.id && isCandidate(p.id) ? 'picked' : '',
        voted === p.id ? 'targeted' : '',
        leaving ? 'leaving' : '',
        saved ? 'saved' : '',
        !p.connected && !p.left ? 'offline' : '',
        S.sheet && S.sheet.id === p.id && ['char', 'profile', 'chat'].includes(S.sheet.type) ? 'focus' : '',
      ].filter(Boolean).join(' ');
      return {
        id: p.id, x: o.x, y: o.y, s: o.s, i, acc: ch(p.characterId).accent || '#3ee6c4', cls,
        label: `${ch(p.characterId).characterName} — ${p.name}`,
        html: tokenHtml(p, { me: p.id === me, unread: S.unread.get(p.id) || 0, voted: voted === p.id }),
      };
    });
    syncTokens(document.getElementById('g-tokens'), items);
  }

  function hudHtml() {
    const v = S.view, m = v.match, ph = v.room.phase;
    const [label] = PHASES[ph] || [ph];
    const [, todLabel] = todOf(m.round);
    const alive = m.myStatus === 'ALIVE';
    return `<div class="hud-top">
        <div class="round-badge" aria-label="الجولة ${m.round}"><div><small>ROUND</small><b>${m.round}</b></div></div>
        <div class="phase-box">
          <div class="phase-name">${v.room.paused ? '⏸ متوقفة مؤقتًا' : label}</div>
          <div class="hud-meta"><button class="alive" data-act="sheet" data-sheet="players">👥 ${m.aliveCount}/${m.players.length}</button><span>·</span><span>${todLabel}</span></div>
        </div>
        ${v.me.isHost ? '<button class="hud-admin" data-act="sheet" data-sheet="admin" aria-label="إدارة الغرفة">⚙️</button>' : '<span></span>'}
        <div class="timer ${once(`t-${S.phaseKey}`) ? 'start' : ''} ${v.room.paused ? 'paused' : ''}" data-timer ${v.room.phaseEndsAt || v.room.paused ? '' : 'hidden'}><svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="27"/><circle class="ring" cx="32" cy="32" r="27" stroke-dasharray="169.6" stroke-dashoffset="0"/></svg><span class="t">${v.room.paused ? '⏸' : '--:--'}</span></div>
      </div>
      ${!alive ? `<div class="spectate"><span>${v.room.settings.ALLOW_SPECTATORS ? '👻 تشاهد فقط' : 'تم إقصاؤك'}</span><button class="gbtn sm ghost" data-act="leave">خروج</button></div>` : ''}`;
  }

  function bannerHtml() {
    const v = S.view, m = v.match, ph = v.room.phase, alive = m.myStatus === 'ALIVE';
    let top = '';
    if (v.room.paused) top = '⏸ اللعبة متوقفة مؤقتًا من الـHost';
    else if (ph === 'PRIVATE_CHAT' && alive) top = '💬 اضغط على شخصية للمحادثة';
    else if (ph === 'ABILITY') top = m.ability && m.ability.canUse ? '👁️ لديك الجاسوس — من الأسفل' : '🌫️ أحدهم قد يتجسس الآن…';
    else if (ph === 'VOTING' && alive && m.vote) top = m.vote.myVote ? `✔ صوّت ${m.vote.votedCount} من ${m.vote.totalVoters}` : '🗳️ اضغط على من يغادر الجزيرة';
    else if (ph === 'VOTING') top = '🗳️ الناجون يصوّتون…';
    let bottom = '';
    const pick = S.votePick && isCandidate(S.votePick) && player(S.votePick);
    if (ph === 'VOTING' && pick) {
      const c = ch(pick.characterId);
      bottom = `<div class="confirm-bar" role="dialog" aria-label="تأكيد التصويت">
        <div class="cb-who">${portrait(pick.characterId)}<div><b class="name-latin">${esc(c.characterName)}</b><small>اللاعب: ${esc(pick.name)}</small></div></div>
        <button class="cb-x" data-act="cancel-pick" aria-label="إلغاء">✕</button>
        <button class="gbtn danger block" data-act="vote">🗳️ CONFIRM VOTE · تأكيد</button>
        <p class="cb-note">صوت واحد، سري، ولا يمكن تغييره.</p></div>`;
    }
    const hint = ph === 'PRIVATE_CHAT' && alive && !v.room.paused ? 'hint' : '';
    return `${top ? `<div class="banner ${hint}" ${once(`b-${S.phaseKey}-${top}`) ? 'data-in' : ''}>${top}</div>` : ''}${bottom}`;
  }

  function layerHtml() {
    const v = S.view, m = v.match, ph = v.room.phase;
    if (S.dismissed === S.phaseKey) return '';
    const anim = once(`ov-${S.phaseKey}`) ? 'anim' : '';
    const x = '<button class="x" data-act="dismiss" aria-label="إغلاق">✕</button>';
    const r = m.lastResult;
    if (ph === 'ROUND_START') {
      const [, todLabel] = todOf(m.round);
      return `<div class="cine-card ${anim}">${x}
        <div class="round-title"><small>ROUND</small><b>${m.round}</b></div><div class="tod-label">${todLabel} على الجزيرة</div>
        <div class="stats-row"><div class="stat"><b>${m.aliveCount}</b><span>ناجون</span></div><div class="stat"><b>${fmt(v.room.settings.CHAT_DURATION * 1000)}</b><span>وقت المحادثات</span></div></div>
        ${m.ability ? '<div class="secret-note spy"><b>👁️ حصلت على الجاسوس هذه الجولة</b><div class="muted small">لا أحد غيرك يعرف.</div></div>' : ''}
        ${m.lastStand && !m.lastStand.used && m.round === 1 ? '<div class="secret-note shield"><b>🛡️ لديك LAST STAND</b><div class="muted small">تنقذك من الإقصاء مرة واحدة. لا أحد يعلم.</div></div>' : ''}
      </div>`;
    }
    if (ph === 'LAST_STAND') {
      const ls = m.lastStand;
      if (ls && ls.canDecide) {
        return `<div class="cine-card ${anim} ls-window"><div class="emblem">🛡️</div><h2 class="display h2">لديك LAST STAND<br>هل تستخدمها؟</h2>
          <p class="muted">أُغلق التصويت ولم تُعلن النتيجة. إن كنت المستهدف تنجو، وإن لم تكن تضيع. مرة واحدة فقط.</p>${lastStandButtons(ls)}</div>`;
      }
      return `<div class="cine-card counting"><div style="font-size:3rem">🗳️</div><h2 class="display h2">أُغلق التصويت</h2><p class="muted">الخادم يحسب النتيجة<span class="dots"></span></p></div>`;
    }
    if (ph === 'VOTE_RESULT' && r) {
      const top = r.tally ? Math.max(0, ...r.tally.map((t) => t.votes)) : 0;
      const max = Math.max(1, top);
      const out = {
        REVOTE: 'تعادل! إعادة تصويت بين المتعادلين.', NO_VOTES: 'لم يصوّت أحد. لا إقصاء.', TIE_NO_ELIMINATION: 'تعادل. لا إقصاء هذه الجولة.',
        TIE_RANDOM: 'تعادل… والقرعة حسمت.', ELIMINATED: '',
        LAST_STAND_SAVED: r.savedId ? `🛡️ ${r.savedId === S.user.id ? 'فعّلت' : `${esc(nameOf(r.savedId))} فعّل`} LAST STAND ونجا!` : '🛡️ أحدهم فعّل LAST STAND ونجا!',
      }[r.outcome];
      return `<div class="result-card ${anim}">${x}<h2 class="display h3">🗳️ نتيجة التصويت</h2>
        ${r.tally ? `<div class="tally">${r.tally.map((t) => { const p = player(t.id); return `<div class="trow ${t.votes === top && top > 0 ? 'top' : ''}">${portrait(p.characterId)}<span>${esc(p.name)}</span><span class="tbar"><i style="width:${(t.votes / max) * 100}%"></i></span><b>${t.votes}</b></div>`; }).join('')}</div>` : ''}
        ${out ? `<p style="font-weight:700;margin:6px 0 0">${out}</p>` : ''}${r.noVoteCount ? `<p class="muted small" style="margin:4px 0 0">${r.noVoteCount} لم يصوّت</p>` : ''}</div>`;
    }
    if (ph === 'ELIMINATION' && r) {
      if (r.someoneSaved) {
        const p = r.savedId && player(r.savedId);
        return `<div class="caption ${anim} gold"><small>LAST STAND</small><div class="cap-name">${p ? esc(ch(p.characterId).characterName) : '؟'}</div><div class="cap-sub">${p ? esc(p.name) + ' صمد!' : 'أحدهم صمد!'} لا إقصاء هذه الجولة.</div></div>`;
      }
      if (!r.someoneEliminated) return `<div class="caption ${anim}"><div class="cap-name">🌊</div><div class="cap-sub">نجا الجميع هذه الجولة</div></div>`;
      if (!r.eliminatedId) return `<div class="caption ${anim}"><div class="cap-sub">أُقصي أحدهم…</div></div>`;
      const p = player(r.eliminatedId), meOut = r.eliminatedId === S.user.id;
      return `<div class="caption ${anim} blood"><div class="cap-name">${esc(ch(p.characterId).characterName)}</div><div class="cap-sub">${esc(p.name)}</div>
        <div class="cap-final">${meOut ? 'تم إقصاؤك' : 'PLAYER ELIMINATED'}<small>${meOut ? (v.room.settings.ALLOW_SPECTATORS ? 'تستطيع المتابعة كمشاهد' : '') : 'غادر الجزيرة'}</small></div></div>`;
    }
    return '';
  }

  // ---------- sheets ----------
  function sheetWrap(title, body, opts = {}) {
    return `<div class="sheet-back ${S._opening ? 'opening' : ''}" data-act="close-sheet"></div>
      <section class="sheet ${opts.cls || ''} ${S._opening ? 'opening' : ''}" role="dialog" aria-label="${esc(title)}">
        <header class="sheet-head">${opts.head || `<h2>${esc(title)}</h2>`}<button class="sheet-x" data-act="close-sheet" aria-label="رجوع للجزيرة">✕</button></header>
        <div class="sheet-body">${body}</div>${opts.foot || ''}
      </section>`;
  }
  function statusLine(p) {
    if (p.status !== 'ALIVE') return `<span class="st dead">● ${p.left ? (p.eliminatedReason === 'REMOVED' ? 'أُزيل من الغرفة' : 'انسحب') : `أُقصي في الجولة ${p.eliminatedRound}`}</span>`;
    return `<span class="st ${p.connected ? 'on' : 'off'}">● ${p.connected ? 'حي · متصل' : 'حي · غير متصل'}</span>`;
  }
  function sheetChar(id) {
    const p = player(id);
    if (!p) return '';
    const c = ch(p.characterId), m = S.view.match, meAlive = m.myStatus === 'ALIVE';
    const msgs = S.chats.get(id) || [];
    const acts = [];
    if (id !== S.user.id && chatOpen() && meAlive && p.status === 'ALIVE') acts.push(`<button class="gbtn primary block" data-act="open-chat" data-id="${id}">💬 PRIVATE CHAT — محادثة خاصة</button>`);
    else if (id !== S.user.id && msgs.length) acts.push(`<button class="gbtn block" data-act="open-chat" data-id="${id}">📜 سجل المحادثة</button>`);
    acts.push(`<button class="gbtn ghost block" data-act="sheet" data-sheet="profile" data-id="${id}">👤 VIEW PROFILE — الملف</button>`);
    if (isCandidate(id)) acts.push(`<button class="gbtn danger block" data-act="select-vote" data-id="${id}">🗳️ SELECT FOR VOTE — اختيار للتصويت</button>`);
    return sheetWrap(c.characterName, `<div class="sc">
        <div class="sc-art" style="--acc:${c.accent}">${portrait(p.characterId)}</div>
        <div class="sc-info"><div class="sc-name">${esc(c.characterName)}</div><div class="muted small">${esc(c.title)}</div>
        <div class="sc-player">اللاعب: <b>${esc(p.name)}</b>${p.isHost ? ' 👑' : ''}</div>${statusLine(p)}</div>
      </div><div class="stack" style="margin-top:14px">${acts.join('')}</div>`, { cls: 'compact' });
  }
  function sheetProfile(id) {
    const p = player(id);
    if (!p) return '';
    const c = ch(p.characterId);
    return sheetWrap('الملف', `<div class="profile" style="--acc:${c.accent}">
        <div class="pf-art">${art(p.characterId)}</div>
        <div class="pf-name">${esc(c.characterName)} <span class="muted">${esc(c.nameAr || '')}</span></div>
        <div class="muted">${esc(c.title)}</div>
        <div class="pf-row">اللاعب: <b>${esc(p.name)}</b>${id === S.user.id ? ' (أنت)' : ''}${p.isHost ? ' · 👑 Host' : ''}</div>
        ${statusLine(p)}
        <p class="muted small" style="margin-top:12px">الشخصية هوية فقط — القدرات السرية توزَّع عشوائيًا ولا تُكشف.</p>
      </div>`);
  }
  function sheetPlayers() {
    const m = S.view.match, me = S.user.id;
    return sheetWrap(`اللاعبون ${m.aliveCount} / ${m.players.length}`, `<ul class="plist">${m.players.map((p) => {
      const c = ch(p.characterId);
      const tag = p.status === 'ALIVE' ? 'button' : 'div';
      return `<li><${tag} class="prow ${p.status !== 'ALIVE' ? 'dead' : ''} ${p.id === me ? 'me' : ''}" ${p.status === 'ALIVE' ? `data-act="sheet" data-sheet="${p.id === me ? 'profile' : 'char'}" data-id="${p.id}"` : ''}>
        ${portrait(p.characterId)}<div class="meta"><b>${esc(p.name)}${p.id === me ? ' (أنت)' : ''}${p.isHost ? ' 👑' : ''}</b><small class="name-latin">${esc(c.characterName)}</small></div>${statusLine(p)}</${tag}></li>`;
    }).join('')}</ul>`);
  }
  function sheetChats() {
    const m = S.view.match, me = S.user.id;
    const partners = m.players.filter((p) => p.id !== me && (p.status === 'ALIVE' || (S.chats.get(p.id) || []).length));
    const body = partners.length ? `<ul class="clist">${partners.map((p) => {
      const msgs = S.chats.get(p.id) || [];
      const last = msgs[msgs.length - 1];
      const un = S.unread.get(p.id) || 0;
      return `<li><button class="citem ${p.status !== 'ALIVE' ? 'gone' : ''}" data-act="open-chat" data-id="${p.id}">
        <span class="av">${portrait(p.characterId)}<i class="${p.connected && p.status === 'ALIVE' ? 'on' : ''}"></i></span><div class="meta"><div class="who">${esc(p.name)} <small class="name-latin muted">${esc(ch(p.characterId).characterName)}</small></div><div class="preview">${last ? esc((last.senderId === me ? 'أنت: ' : '') + last.text) : chatOpen() ? 'ابدأ محادثة…' : 'لا رسائل'}</div></div>
        ${un ? `<span class="unread">${un}</span>` : ''}</button></li>`;
    }).join('')}</ul>` : '<div class="empty"><span class="big-ic">🌊</span>لا أحد لتحادثه.</div>';
    return sheetWrap('المحادثات الخاصة', `${chatOpen() ? '' : '<p class="notice" style="margin:0 0 10px">المحادثات مغلقة الآن — تُفتح في مرحلة المحادثات.</p>'}${body}`);
  }
  // الشات يُبنى من أجزاء: عند وصول رسالة يتحدث جزء الرسائل فقط،
  // وحقل الكتابة لا يُلمس أبدًا (لا تنغلق لوحة المفاتيح ولا يضيع ما تكتبه).
  function chatParts(id) {
    const v = S.view, p = player(id);
    if (!p) return null;
    const c = ch(p.characterId), msgs = S.chats.get(id) || [];
    let lock = '';
    if (v.match.myStatus !== 'ALIVE') lock = 'أنت خارج اللعبة — للقراءة فقط.';
    else if (p.status !== 'ALIVE') lock = `${esc(p.name)} خارج اللعبة.`;
    else if (v.room.paused) lock = 'اللعبة متوقفة مؤقتًا.';
    else if (!chatOpen()) lock = 'المحادثات مغلقة الآن. تُفتح في الجولة القادمة.';
    return {
      head: `<button class="back" data-act="close-sheet" aria-label="رجوع للجزيرة">→</button>
        <span class="av">${portrait(p.characterId)}<i class="${p.connected && p.status === 'ALIVE' ? 'on' : ''}"></i></span>
        <div class="th-meta"><b>${esc(p.name)}</b><small><span class="name-latin">${esc(c.characterName)}</span> · ${p.status !== 'ALIVE' ? 'خارج اللعبة' : p.connected ? 'متصل الآن' : 'غير متصل'}</small></div>`,
      msgs: msgs.length ? messagesHtml(msgs, S.user.id, false) : `<div class="empty"><span class="big-ic">🤫</span>محادثة خاصة بينك وبين ${esc(p.name)} فقط.<br>تذكّر: لا اتفاق ملزم.</div>`,
      footKey: lock || 'composer',
      foot: lock ? `<div class="locked">${lock}</div>` : `<div class="composer"><input id="composer" class="field" maxlength="${v.room.settings.MESSAGE_MAX_LENGTH}" autocomplete="off" enterkeyhint="send" placeholder="اكتب رسالة…" value="${esc(S.drafts[id] || '')}"><button class="send" data-act="send" aria-label="إرسال">➤</button></div>`,
      name: p.name,
    };
  }
  function sheetChat(id) {
    const x = chatParts(id);
    if (!x) return '';
    return `<section class="sheet chat ${S._opening ? 'opening' : ''}" data-partner="${id}" data-foot="${esc(x.footKey)}" role="dialog" aria-label="محادثة ${esc(x.name)}"><header class="sheet-head thead">${x.head}</header><div class="msgs" id="msgs">${x.msgs}</div><div class="chat-foot">${x.foot}</div></section>`;
  }
  function patchChat(id) {
    const root = document.getElementById('g-sheet');
    const cur = root.querySelector('.sheet.chat');
    const x = chatParts(id);
    if (!cur || !x || cur.dataset.partner !== id) return false;
    const head = cur.querySelector('.sheet-head');
    if (head.__h !== x.head) { head.innerHTML = x.head; head.__h = x.head; }
    const box = cur.querySelector('#msgs');
    if (box.__h !== x.msgs) { box.innerHTML = x.msgs; box.__h = x.msgs; }
    if (cur.dataset.foot !== x.footKey) { cur.querySelector('.chat-foot').innerHTML = x.foot; cur.dataset.foot = x.footKey; }
    return true;
  }
  function sheetSpy() {
    const m = S.view.match, ab = m.ability;
    let h = '';
    if (ab) {
      h += `<div class="acard spy"><div class="emblem">👁️</div><div class="kicker">قدرة سرية لهذه الجولة — لا أحد يعلم</div><h2>SPY</h2><p>${esc(ab.description)}</p>`;
      if (ab.canUse && ab.options) {
        h += `<div class="pairs">${ab.options.pairs.map((pr) => {
          const a = player(pr.a), b = player(pr.b);
          const on = S.spyPick && S.spyPick.a === pr.a && S.spyPick.b === pr.b;
          return `<button class="pair" data-act="spy-pick" data-a="${pr.a}" data-b="${pr.b}" aria-pressed="${on}">${portrait(a.characterId)}<span>${esc(a.name)}</span><b class="x">⇄</b><span>${esc(b.name)}</span>${portrait(b.characterId)}</button>`;
        }).join('')}</div>
        <button class="gbtn ability block" style="margin-top:14px" data-act="spy-use" ${S.spyPick ? '' : 'disabled'}>👁️ اقرأ المحادثة</button>`;
      } else h += `<div class="state">${ab.usesLeft > 0 ? 'تُفعَّل في مرحلة الجاسوس بعد المحادثات.' : 'استخدمتها في هذه الجولة.'}</div>`;
      h += '</div>';
    }
    if (m.intel.length) {
      const reveal = S.revealIntel; S.revealIntel = false;
      h += m.intel.slice().reverse().map((it, i) => `<details class="intel ${i === 0 && reveal ? 'reveal' : ''}" ${i === 0 ? 'open' : ''}>
        <summary>👁️ الجولة ${it.round}: ${esc(nameOf(it.a))} ⇄ ${esc(nameOf(it.b))} · ${it.messages.length} رسالة</summary>
        <div class="msgs">${it.messages.length ? messagesHtml(it.messages, it.a, true) : '<div class="empty">لم يتبادلا أي رسالة.</div>'}</div></details>`).join('');
    }
    return sheetWrap('الجاسوس', h || '<div class="empty">لا تملك الجاسوس في هذه الجولة.</div>', { cls: 'spy' });
  }
  function lastStandButtons(ls) {
    if (ls.decision) return `<div class="state">${ls.decision === 'USE' ? '🛡️ قررت تفعيل LAST STAND.' : 'قررت عدم الاستخدام.'} بانتظار النتيجة…</div>`;
    return `<div class="row" style="margin-top:16px"><button class="gbtn ghost" data-act="last-stand" data-use="0">لا أستخدمها</button><button class="gbtn shield" data-act="last-stand" data-use="1">🛡️ فعّلها</button></div>`;
  }
  function sheetShield() {
    const ls = S.view.match.lastStand;
    if (!ls) return '';
    return sheetWrap('LAST STAND', `<div class="acard shield"><div class="emblem">🛡️</div><div class="kicker">قدرة سرية للمباراة كاملة — لا أحد يعلم أنك تملكها</div><h2>LAST STAND</h2>
      <p>${esc(ls.description)}</p><div class="state">${ls.used ? `استُخدمت في الجولة ${ls.usedRound}.` : ls.canDecide ? 'نافذة القرار مفتوحة الآن!' : 'جاهزة — تظهر لك نافذة القرار بعد كل تصويت.'}</div>
      ${ls.canDecide ? lastStandButtons(ls) : ''}</div>`, { cls: 'shield' });
  }
  function sheetAdmin() {
    const v = S.view, m = v.match, r = v.room;
    if (!v.me.isHost) return '';
    const rows = r.members.map((mem) => {
      const p = player(mem.id);
      const status = p ? (p.status === 'ALIVE' ? 'حي' : 'مُقصى') : 'مشاهد';
      return `<li class="arow"><span class="av">${portrait(mem.characterId)}<i class="${mem.connected ? 'on' : ''}"></i></span>
        <div class="meta"><b>${esc(mem.name)}${mem.id === S.user.id ? ' (أنت)' : ''}</b><small>${status} · ${mem.connected ? 'متصل' : `غير متصل منذ ${mem.lastSeenAgo ?? '?'}ث`}</small></div>
        ${mem.id !== S.user.id ? `<button class="gbtn sm danger" data-act="admin-remove" data-id="${mem.id}" data-name="${esc(mem.name)}">إزالة</button>` : ''}</li>`;
    }).join('');
    return sheetWrap('إدارة الغرفة — Host', `
      <p class="muted small" style="margin:0 0 12px">أنت لاعب عادي + مشرف الغرفة. لا ترى الأصوات أو القدرات أو المحادثات.</p>
      <div class="admin-status">
        <div><small>الرمز</small><b class="latin">${esc(r.code)}</b></div><div><small>الجولة</small><b>${m.round}</b></div>
        <div><small>المرحلة</small><b>${esc((PHASES[r.phase] || [r.phase])[0])}</b></div><div><small>الحالة</small><b>${r.paused ? '⏸ متوقفة' : '▶ تعمل'}</b></div>
      </div>
      <h3 class="display h3" style="margin:16px 0 8px">اللاعبون في الغرفة</h3>
      <ul class="alist">${rows}</ul>
      <div class="stack" style="margin-top:16px">
        ${r.settings.HOST_PAUSE_ENABLED ? (r.paused ? '<button class="gbtn primary block" data-act="resume">▶ استئناف اللعبة</button>' : `<button class="gbtn block" data-act="pause" ${r.phaseEndsAt ? '' : 'disabled'}>⏸ إيقاف مؤقت</button>`) : ''}
        <button class="gbtn danger block" data-act="end-game">⛔ END GAME — إنهاء المباراة</button>
      </div>`, { cls: 'admin' });
  }
  function sheetHtml() {
    const s = S.sheet;
    if (!s) return '';
    return ({ char: () => sheetChar(s.id), profile: () => sheetProfile(s.id), players: sheetPlayers, chats: sheetChats, chat: () => sheetChat(s.id), spy: sheetSpy, shield: sheetShield, admin: sheetAdmin }[s.type] || (() => ''))();
  }

  function dockHtml() {
    const v = S.view, m = v.match, ph = v.room.phase, alive = m.myStatus === 'ALIVE';
    const unread = [...S.unread.values()].reduce((a, b) => a + b, 0);
    const b = [];
    b.push(`<button class="dbtn ${ph === 'PRIVATE_CHAT' && alive ? 'hot' : ''}" data-act="sheet" data-sheet="chats"><span class="ic">💬</span><span>CHAT</span>${unread ? `<span class="badge">${unread}</span>` : ''}</button>`);
    const canVote = ph === 'VOTING' && alive && m.vote && !m.vote.myVote;
    b.push(`<button class="dbtn vote ${canVote ? 'hot' : ''} ${m.vote && m.vote.myVote ? 'done' : ''}" data-act="vote-btn"><span class="ic">🗳️</span><span>VOTE</span></button>`);
    if (m.ability || m.intel.length) b.push(`<button class="dbtn ab ${m.ability && m.ability.canUse ? 'hot' : ''} ${m.ability && m.ability.usesLeft === 0 ? 'spent' : ''}" data-act="sheet" data-sheet="spy"><span class="ic">👁️</span><span>SPY</span></button>`);
    if (m.lastStand) b.push(`<button class="dbtn ls ${m.lastStand.canDecide && !m.lastStand.decision ? 'hot' : ''} ${m.lastStand.used ? 'spent' : ''}" data-act="sheet" data-sheet="shield"><span class="ic">🛡️</span><span>LAST STAND</span></button>`);
    b.push(`<button class="dbtn" data-act="sheet" data-sheet="players"><span class="ic">👥</span><span>${m.aliveCount}/${m.players.length}</span></button>`);
    return b.join('');
  }

  function updateGame() {
    if (!document.getElementById('g')) { $app.innerHTML = gameSkeleton(); }
    const s = S.sheet;
    const g = document.getElementById('g');
    g.classList.toggle('chat-open', !!(s && s.type === 'chat'));
    g.classList.toggle('sheet-open', !!s);
    patch('g-hud', hudHtml());
    updateWorld();
    patch('g-banner', bannerHtml());
    patch('g-layer', layerHtml());
    const key = s ? `${s.type}:${s.id || ''}` : '';
    S._opening = key !== S._sheetKey;
    S._sheetKey = key;
    if (!(s && s.type === 'chat' && !S._opening && patchChat(s.id))) {
      patch('g-sheet', sheetHtml());
      const box = document.getElementById('msgs');
      if (box && s && s.type === 'chat') box.__h = chatParts(s.id).msgs;
    }
    patch('g-dock', dockHtml());
  }

  function screenOver() {
    const v = S.view, m = v.match;
    if (m.endReason === 'HOST_ENDED') {
      return `<div class="screen"><div class="wrap center" style="padding-top:14vh">
        <div style="font-size:3.4rem">⛔</div>
        <h1 class="display h1" style="margin-top:8px">GAME ENDED</h1>
        <p class="muted" style="font-size:1.1rem">الـHost أنهى هذه المباراة. لا يوجد فائزون.</p>
        <div class="stack" style="margin-top:26px">
          <button class="gbtn primary block" data-act="leave">🏠 RETURN TO MAIN MENU</button>
          ${v.me.isHost ? '<button class="gbtn ghost block" data-act="to-lobby">العودة للـLobby بنفس اللاعبين</button>' : ''}
        </div></div></div>`;
    }
    const winners = m.winners.map(player).filter(Boolean);
    const won = m.winners.includes(S.user.id);
    const anim = once(`over-${m.id}`) ? 'anim' : '';
    const rows = (m.stats || []).map((s) => {
      const p = player(s.id);
      const fate = p.status === 'ALIVE' ? '🏆 فائز' : p.left ? `انسحب ج${p.eliminatedRound}` : `أُقصي ج${p.eliminatedRound}`;
      return `<tr><td>${portrait(p.characterId)}${esc(p.name)}</td><td>${fate}</td><td>${s.messagesSent}</td><td>${s.votesCast}</td><td>${s.votesReceived}</td><td>${s.abilitiesUsed}</td></tr>`;
    }).join('');
    return `<div class="screen ${anim}"><div class="wrap over">
      <div class="trophy">🏆</div>
      <h1 class="display h1">${won ? 'نجوت من الجزيرة!' : 'انتهت المباراة'}</h1>
      <p class="muted">${winners.length > 1 ? 'آخر اثنين على الجزيرة — كلاهما فائز' : 'آخر من بقي على الجزيرة'} · ${m.round} جولات</p>
      <div class="winners">${winners.map((p) => `<div class="winner">${art(p.characterId)}<div class="nm">${esc(p.name)}</div><div class="muted small latin">${esc(ch(p.characterId).characterName)}</div></div>`).join('')}</div>
      <div class="table-wrap"><table class="stats"><thead><tr><th>اللاعب</th><th>المصير</th><th>رسائل</th><th>أصوات أدلى بها</th><th>أصوات ضده</th><th>قدرات</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div></div>
    <div class="bottom-bar"><div class="inner">
      <button class="gbtn ghost" data-act="leave" style="flex:.7">القائمة</button>
      ${v.me.isHost ? `<button class="gbtn ghost" data-act="to-lobby">الـLobby</button><button class="gbtn primary" data-act="again">العب مجددًا</button>` : '<button class="gbtn" disabled>بانتظار الـHost…</button>'}
    </div></div>`;
  }

  // ---------------- render ----------------
  function render(opt = {}) {
    if (!S.cfg) return;
    const active = document.activeElement;
    const fid = active && active.id;
    const selr = fid && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
    const fval = fid && active.tagName === 'INPUT' ? active.value : null;
    const msgs = document.getElementById('msgs');
    const atBottom = msgs ? msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80 : true;
    const scroller = document.querySelector('.screen');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const prevKind = $app.dataset.kind;

    let html, kind;
    const v = S.view;
    if (!S.user) { html = screenName(); kind = 'name'; }
    else if (v) {
      if (v.room.phase === 'LOBBY') { html = screenLobby(); kind = 'lobby'; }
      else if (v.room.phase === 'GAME_OVER') { html = screenOver(); kind = 'over'; }
      else { html = null; kind = 'game'; }
    } else {
      const sc = !S.user.characterId && S.screen !== 'name' ? 'character' : S.screen;
      kind = sc;
      html = sc === 'name' ? screenName() : sc === 'character' ? screenCharacter() : sc === 'create' && S.draft ? screenCreate() : sc === 'join' ? screenJoin() : screenMenu();
    }
    if (kind === 'game') {
      if (prevKind !== 'game') $app.innerHTML = '';
      updateGame();
    } else if (html !== $app.__h || prevKind !== kind) {
      $app.innerHTML = html;
    }
    $app.__h = kind === 'game' ? null : html;
    $app.dataset.kind = kind;
    document.body.classList.toggle('ingame', kind.startsWith('game') || kind === 'lobby');

    if (fid) {
      const el = document.getElementById(fid);
      if (el) { if (fval !== null && el.tagName === 'INPUT') el.value = fval; el.focus({ preventScroll: true }); if (selr && el.setSelectionRange) try { el.setSelectionRange(selr[0], selr[1]); } catch {} }
    }
    const nm = document.getElementById('msgs');
    if (nm && (atBottom || opt.bottom)) nm.scrollTop = nm.scrollHeight;
    const ns = document.querySelector('.screen');
    if (ns && prevKind === kind && scrollTop) ns.scrollTop = scrollTop;
    if (S.sheet && S.sheet.type === 'chat') S.unread.delete(S.sheet.id);
    tick();
  }

  // ---------------- timer (display only — the server decides) ----------------
  let expiryKey = null, expiryAt = 0;
  function tick() {
    const v = S.view;
    if (!v) return;
    const end = v.room.phaseEndsAt;
    const el = document.querySelector('[data-timer]');
    if (el && v.room.paused) { el.classList.remove('low'); }
    if (end && el) {
      const left = end - now();
      const total = Math.max(1, end - v.room.phaseStartedAt);
      const frac = Math.max(0, Math.min(1, left / total));
      el.querySelector('.t').textContent = fmt(left);
      el.querySelector('.ring').setAttribute('stroke-dashoffset', (169.6 * (1 - frac)).toFixed(1));
      el.classList.toggle('low', left < 10_000);
    }
    // انتهى وقت المرحلة → اطلب من الخادم التقدم (هو من يتحقق من الوقت)
    if (end && now() > end + 200) {
      const key = `${end}`;
      if (expiryKey !== key || Date.now() - expiryAt > 1500) { expiryKey = key; expiryAt = Date.now(); scheduleSync(Math.random() * 250); }
    }
  }
  setInterval(tick, 250);

  // ---------------- lifecycle ----------------
  let heartbeat = null;
  function startHeartbeat() {
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (S.user) sync(); }, (S.cfg && S.cfg.heartbeatMs) || 15000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) scheduleSync(0); });
  window.addEventListener('online', () => S.user && scheduleSync(0));

  // الجوال: التطبيق مثبت على الجزء الظاهر من الشاشة فقط
  // (يحل الفراغ فوق، واختفاء الأزرار تحت، وظهور شريط العنوان/لوحة المفاتيح في سامسونج وآيفون)
  const root = document.documentElement.style;
  function fitViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? Math.max(0, vv.offsetTop) : 0;
    root.setProperty('--app-h', `${Math.round(h)}px`);
    root.setProperty('--app-top', `${Math.round(top)}px`);
    if (window.scrollY) window.scrollTo(0, 0);
    const m = document.getElementById('msgs');
    if (m && document.activeElement && document.activeElement.id === 'composer') m.scrollTop = m.scrollHeight;
  }
  let fitRaf = 0;
  const fitSoon = () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(() => { fitViewport(); if (document.getElementById('g')) updateWorld(); }); };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitSoon);
    window.visualViewport.addEventListener('scroll', fitSoon);
  }
  window.addEventListener('resize', fitSoon);
  window.addEventListener('orientationchange', () => setTimeout(fitSoon, 300));
  document.addEventListener('focusout', () => setTimeout(fitSoon, 50));
  fitViewport();

  (async function boot() {
    try {
      S.cfg = await (await fetch('/api/config')).json();
    } catch {
      $app.innerHTML = '<div class="screen"><div class="wrap"><div class="panel center" style="margin-top:30vh">تعذر الاتصال بالخادم. أعد تحميل الصفحة.</div></div></div>';
      return;
    }
    if (S.token) {
      const r = await api('session/resume');
      if (r.ok) {
        S.user = r.user;
        S.pick = r.user.characterId;
        S.screen = r.user.characterId ? 'menu' : 'character';
        connectRealtime();
        if (r.inRoom) await sync();
      }
    }
    startHeartbeat();
    render();
  })();
})();
