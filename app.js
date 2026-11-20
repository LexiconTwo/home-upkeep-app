// Home Upkeep — app shell hospedado no GitHub Pages.
// A planilha do Google continua sendo a única fonte de dados; este arquivo só fala
// com o Apps Script (uma API JSON), sempre via JSONP (ver comentário abaixo).

const API_URL = 'https://script.google.com/macros/s/AKfycbxcb1I03e6wfoBXzfX8bvSi41yph45Eo96QlisnYF6ypkmpDEP3lCNzpbDojWX2IOebSA/exec';
const API_KEY = 'EAymKiJNwWXufQInoUQjJxl7hVin';

// Login com Google: só os e-mails listados em "allowed_emails" (aba Settings) conseguem usar o app.
// O ID do cliente OAuth é público por natureza (não é segredo).
const GOOGLE_CLIENT_ID = '826797750892-obk3k8ikci93idmlj75jtv3ql0k9fs2j.apps.googleusercontent.com';

// Notificações push (Firebase Cloud Messaging). Também são valores públicos.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA7Z1FuLiibfTXo4PObG-8Vvkipo5Le-Jc',
  authDomain: 'home-upkeep-d770c.firebaseapp.com',
  projectId: 'home-upkeep-d770c',
  storageBucket: 'home-upkeep-d770c.firebasestorage.app',
  messagingSenderId: '826797750892',
  appId: '1:826797750892:web:78d907bcb08f100c70b649',
};
const FIREBASE_VAPID_KEY = 'BEhn67RNhQvdRQK_GWLDmby3mdau_s54v1amD1d_p45ZCyDQF9oqbdkHE4Ov90izSmW6WihzBpXEz79Bh6M__h4';
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

// O Apps Script web app bloqueia fetch()/XHR entre domínios (erro 503 só pra chamadas CORS) e
// também bloqueia qualquer navegação de página inteira pra dentro dele. A única forma que funciona
// sem interação é uma tag <script src="..."> (JSONP). Por isso leituras E escritas usam JSONP:
// escritas também viram um GET, com os dados na querystring.
let __seq = 0;

function jsonp(action, params) {
  return new Promise((resolve, reject) => {
    const cbName = '__huCb' + (__seq++);
    const qs = new URLSearchParams(Object.assign({ action, key: API_KEY, t: TOKEN || '', callback: cbName }, params || {}));
    const script = document.createElement('script');
    const cleanup = () => { delete window[cbName]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Tempo esgotado.')); }, 20000);
    window[cbName] = (json) => {
      clearTimeout(timer); cleanup();
      if (!json || !json.ok) {
        const err = new Error((json && json.error) || 'Erro desconhecido.');
        err.auth = !!(json && json.auth);
        reject(err);
      } else resolve(json.data);
    };
    script.src = API_URL + '?' + qs.toString();
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('Erro de rede.')); };
    document.body.appendChild(script);
  });
}

// Garante um login válido antes de chamar a API; se o servidor recusar o login, pede de novo uma vez.
function apiCall(action, params) {
  return ensureToken()
    .then(() => jsonp(action, params))
    .catch(err => {
      if (!err.auth) throw err;
      clearToken();
      return ensureToken().then(() => jsonp(action, params));
    });
}

function apiGet(action, params) { return apiCall(action, params); }

function apiPost(action, payload) {
  const p = Object.assign({}, payload);
  if (p.task && typeof p.task === 'object') p.task = JSON.stringify(p.task);
  return apiCall(action, p);
}

/* ───────────────────────── Login com Google ───────────────────────── */
// Fluxo: a pessoa entra com Google UMA vez por aparelho. O Apps Script confere o login do Google,
// verifica se o e-mail está em "allowed_emails" e devolve uma sessão própria, válida por 90 dias,
// que fica guardada no aparelho. Assim ninguém precisa entrar de novo toda vez que abre o app
// (inclusive no iPhone). Tirar o e-mail de allowed_emails bloqueia o acesso na hora.

let TOKEN = null, TOKEN_EXP = 0, gisReady = null, tokenWaiters = [];

(function restoreToken() {
  try {
    const t = localStorage.getItem('huSession'), exp = Number(localStorage.getItem('huSessionExp'));
    if (t && exp * 1000 > Date.now() + 60000) { TOKEN = t; TOKEN_EXP = exp; }
    localStorage.removeItem('huToken'); localStorage.removeItem('huTokenExp');
  } catch (e) {}
})();

function tokenValid() { return TOKEN && TOKEN_EXP * 1000 > Date.now() + 60000; }

function clearToken() {
  TOKEN = null; TOKEN_EXP = 0;
  try { localStorage.removeItem('huSession'); localStorage.removeItem('huSessionExp'); } catch (e) {}
}

function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: true,
        use_fedcm_for_prompt: true,
        cancel_on_tap_outside: false,
        itp_support: true,
      });
      resolve();
    };
    s.onerror = () => { gisReady = null; reject(new Error('Não foi possível carregar o login do Google.')); };
    document.head.appendChild(s);
  });
  return gisReady;
}

// Recebe o login do Google e troca por uma sessão do app.
function onCredential(resp) {
  const idToken = resp && resp.credential;
  if (!idToken) return;
  $('#signinMsg').textContent = 'Entrando…';
  jsonp('login', { idToken: idToken }).then(sess => {
    TOKEN = sess.token; TOKEN_EXP = sess.exp;
    try { localStorage.setItem('huSession', TOKEN); localStorage.setItem('huSessionExp', String(TOKEN_EXP)); } catch (e) {}
    $('#signinSheet').hidden = true; document.body.style.overflow = '';
    const w = tokenWaiters; tokenWaiters = [];
    w.forEach(f => f());
  }).catch(err => {
    $('#signinMsg').textContent = err.message;
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    showSignin(true);
  });
}

function ensureToken() {
  if (tokenValid()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    tokenWaiters.push(resolve);
    if (tokenWaiters.length > 1) return; // já tem um login em andamento
    loadGis().then(() => {
      // Tenta o login de um toque. Se o Google não mostrar nada, mostra o botão.
      google.accounts.id.prompt(n => {
        if ((n.isNotDisplayed && n.isNotDisplayed()) || (n.isSkippedMoment && n.isSkippedMoment())) showSignin();
      });
      setTimeout(() => { if (!tokenValid()) showSignin(); }, 3500);
    }).catch(err => { tokenWaiters = []; reject(err); });
  });
}

function showSignin(force) {
  const el = $('#signinSheet');
  if (!el.hidden && !force) return;
  $('#list').innerHTML = '';
  $('#summary').textContent = 'Entre com sua conta Google para continuar.';
  $('#gBtn').innerHTML = '';
  google.accounts.id.renderButton($('#gBtn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', locale: 'pt-BR' });
  open(el);
}

/* ───────────────────────── Tela ───────────────────────── */

const $ = s => document.querySelector(s);
let DATA = null, filter = 'All', showArchived = false, doneId = null, editId = null, toastTimer = null;

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(iso){
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  const opts = {month:'short', day:'numeric'};
  if (!DATA || iso.slice(0,4) !== DATA.today.slice(0,4)) opts.year = 'numeric';
  return d.toLocaleDateString('pt-BR', opts);
}
function addDaysIso(iso, n){
  const p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 864e5).toISOString().slice(0, 10);
}
function everyLabel(t){
  if (t.every === 1) return {days:'Diário', weeks:'Semanal', months:'Mensal', years:'Anual'}[t.unit];
  const unitWords = {days:'dias', weeks:'semanas', months:'meses', years:'anos'};
  return 'A cada ' + t.every + ' ' + (unitWords[t.unit] || t.unit);
}
function status(t){
  if (!t.lastDone) return ['start', 'Defina quando foi feito'];
  const d = t.daysUntil;
  const pre = t.postponedUntil ? 'Adiada · ' : '';
  if (d < 0) return ['over', pre + 'Atrasada há ' + (-d) + ' dia' + (d === -1 ? '' : 's')];
  if (d === 0) return ['soon', pre + 'Vence hoje'];
  if (d === 1) return ['soon', pre + 'Vence amanhã'];
  if (d <= 7) return ['soon', pre + 'Vence em ' + d + ' dias'];
  return ['later', pre + 'Vence em ' + fmt(t.nextDue)];
}
function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3600);
}
function fail(e){ setBusy(false); toast((e && e.message) || String(e)); }
function setBusy(b){ document.querySelectorAll('.sheet .btn').forEach(x => x.disabled = b); }

function load(){ apiGet('getData').then(render).catch(fail); }

function card(t){
  const st = status(t);
  const meta = [everyLabel(t), t.category, t.who].filter(Boolean).map(esc).join(' · ');
  return '<div class="card ' + (st[0] === 'over' ? 'over' : '') + '">' +
    '<div class="main" data-open="' + esc(t.id) + '">' +
      '<div class="title">' + esc(t.task) + '</div><div class="meta">' + meta + '</div>' +
      '<div class="row"><span class="pill ' + st[0] + '">' + esc(st[1]) + '</span>' +
      (t.lastDone ? '<span class="last">Feito em ' + esc(fmt(t.lastDone)) + '</span>' : '') + '</div>' +
    '</div>' +
    (t.active ? '<button class="btn" data-done="' + esc(t.id) + '">' + (t.lastDone ? 'Feito' : 'Iniciar') + '</button>' : '') +
  '</div>';
}

function render(d){
  if (d) DATA = d;
  setBusy(false);
  $('#whoBtn').textContent = (DATA.me && DATA.me.name) || '';
  updatePushBtn();
  const all = DATA.tasks;
  const cats = Array.from(new Set(all.map(t => t.category).filter(Boolean))).sort();
  $('#cats').innerHTML = cats.map(c => '<option value="' + esc(c) + '">').join('');

  const filterDefs = [{code:'All', label:'Tudo'}, {code:'DIY', label:'DIY'}, {code:'Pro', label:'Pro'}]
    .concat(cats.map(c => ({code: c, label: c})));
  if (filterDefs.findIndex(c => c.code === filter) < 0) filter = 'All';
  $('#filterSelect').innerHTML = filterDefs.map(c => '<option value="' + esc(c.code) + '"' + (c.code === filter ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('');

  const pass = t => filter === 'All' || t.who === filter || t.category === filter;
  const active = all.filter(t => t.active && pass(t));
  const by = (a, b) => a.daysUntil - b.daysUntil || a.task.localeCompare(b.task);
  const groups = [
    ['Atrasadas', active.filter(t => t.lastDone && t.daysUntil < 0).sort(by)],
    ['Esta semana', active.filter(t => t.lastDone && t.daysUntil >= 0 && t.daysUntil <= 7).sort(by)],
    ['Precisa de data inicial', active.filter(t => !t.lastDone).sort((a, b) => a.task.localeCompare(b.task))],
    ['Mais tarde', active.filter(t => t.lastDone && t.daysUntil > 7).sort(by)],
  ];

  const allActive = all.filter(t => t.active);
  const over = allActive.filter(t => t.lastDone && t.daysUntil < 0).length;
  const week = allActive.filter(t => t.lastDone && t.daysUntil >= 0 && t.daysUntil <= 7).length;
  $('#summary').textContent = over + ' atrasada(s) · ' + week + ' esta semana · ' + allActive.length + ' tarefa(s)';

  let html = groups.filter(g => g[1].length).map(g => '<h2>' + g[0] + ' · ' + g[1].length + '</h2>' + g[1].map(card).join('')).join('');
  if (!active.length) html = '<div class="empty">Nada por aqui.</div>';

  const archived = all.filter(t => !t.active && pass(t));
  if (archived.length) {
    html += '<button class="linkbtn" id="archToggle">' + (showArchived ? 'Ocultar' : 'Mostrar') + ' arquivadas (' + archived.length + ')</button>';
    if (showArchived) html += '<h2>Arquivadas</h2>' + archived.map(card).join('');
  }
  $('#list').innerHTML = html;
}

function find(id){ return DATA.tasks.find(t => t.id === id); }
function open(el){ el.hidden = false; document.body.style.overflow = 'hidden'; }
function closeAll(){ document.querySelectorAll('.overlay:not(#signinSheet)').forEach(o => o.hidden = true); document.body.style.overflow = ''; }

function openDone(id){
  const t = find(id); doneId = id;
  $('#doneTitle').textContent = t.task;
  $('#doneMeta').textContent = t.lastDone ? everyLabel(t) + ' · feito pela última vez em ' + fmt(t.lastDone) : 'Quando foi feito pela última vez? Uma estimativa está ok.';
  $('#doneDate').value = DATA.today; $('#doneDate').max = DATA.today;
  $('#doneNote').value = '';
  $('#doneSave').textContent = t.lastDone ? 'Marcar como feito' : 'Salvar data inicial';

  // Adiar só faz sentido para tarefas que já têm data.
  const canPostpone = !!(t.lastDone && t.nextDue);
  $('#postponeBox').hidden = !canPostpone;
  if (canPostpone) {
    const base = t.nextDue > DATA.today ? t.nextDue : DATA.today;
    $('#postponeDate').min = addDaysIso(DATA.today, 1);
    $('#postponeDate').value = addDaysIso(base, 7);
    $('#postponeInfo').textContent = t.postponedUntil
      ? 'Adiada para ' + fmt(t.postponedUntil) + ' (vencimento original: ' + fmt(t.originalDue) + ').'
      : 'Vencimento atual: ' + fmt(t.nextDue) + ' · ao adiar, os lembretes esperam a nova data.';
    $('#postponeClear').hidden = !t.postponedUntil;
  }
  open($('#doneSheet'));
}

function openEdit(id){
  const t = id ? find(id) : null; editId = id || null;
  $('#editTitle').textContent = t ? 'Detalhes da tarefa' : 'Nova tarefa';
  $('#fTask').value = t ? t.task : '';
  $('#fEvery').value = t ? t.every : 1;
  $('#fUnit').value = t ? t.unit : 'months';
  $('#fWho').value = t && t.who === 'Pro' ? 'Pro' : 'DIY';
  $('#fCat').value = t ? t.category : '';
  $('#fLast').value = t ? t.lastDone : ''; $('#fLast').max = DATA.today;
  $('#fNotes').value = t ? t.notes : '';
  $('#fActive').checked = t ? t.active : true;
  $('#fActiveWrap').style.display = t ? '' : 'none';
  $('#hist').innerHTML = '';
  open($('#editSheet'));
  if (t) {
    $('#hist').innerHTML = '<h2>Histórico</h2><div class="last">Carregando…</div>';
    apiGet('getHistory', { id: t.id }).then(rows => {
      $('#hist').innerHTML = '<h2>Histórico</h2>' + (rows.length
        ? rows.map(r => '<div>' + (r.date ? esc(fmt(r.date)) : '') + ' <small>· ' + esc(r.by) + '</small>' + (r.note ? '<br><small>' + esc(r.note) + '</small>' : '') + '</div>').join('')
        : '<div class="last">Ainda sem histórico.</div>');
    }).catch(() => { $('#hist').innerHTML = ''; });
  } else {
    setTimeout(() => $('#fTask').focus(), 50);
  }
}

/* ───────────────────────── Notificações push ───────────────────────── */

let swReg = null, fbLoaded = null;

function pushSupported(){ return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && FIREBASE_CONFIG && FIREBASE_CONFIG.projectId; }

function updatePushBtn(){
  const b = $('#pushBtn');
  if (!pushSupported()) { b.hidden = true; return; }
  b.hidden = false;
  const on = Notification.permission === 'granted' && localStorage.getItem('huPushToken');
  b.textContent = on ? '🔔 Notificações ativas' : '🔕 Ativar notificações';
  b.classList.toggle('on', !!on);
}

function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src)); document.head.appendChild(s); });
}

function loadFirebase(){
  if (!fbLoaded) {
    fbLoaded = loadScript(FIREBASE_SDK + 'firebase-app-compat.js')
      .then(() => loadScript(FIREBASE_SDK + 'firebase-messaging-compat.js'))
      .then(() => { if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG); return firebase.messaging(); });
  }
  return fbLoaded;
}

// Pega (ou renova) o token do aparelho e registra na planilha se mudou.
function syncPushToken(force){
  return Promise.all([loadFirebase(), navigator.serviceWorker.ready])
    .then(([messaging, reg]) => messaging.getToken({ vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg }))
    .then(tok => {
      if (!tok) throw new Error('Não foi possível ativar as notificações.');
      if (!force && localStorage.getItem('huPushToken') === tok) return false;
      return apiPost('savePushToken', { token: tok, device: deviceLabel() }).then(() => { localStorage.setItem('huPushToken', tok); return true; });
    });
}

function deviceLabel(){
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Outro';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return os + (standalone ? ' (app)' : ' (navegador)');
}

function enablePush(){
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !standalone) return toast('No iPhone, primeiro adicione o app à tela inicial e abra por lá.');
  if (Notification.permission === 'denied') return toast('As notificações estão bloqueadas nas configurações do navegador para este site.');
  Notification.requestPermission().then(p => {
    if (p !== 'granted') throw new Error('Permissão de notificação não concedida.');
    toast('Ativando…');
    return syncPushToken(true);
  }).then(() => { updatePushBtn(); toast('🔔 Pronto! Você vai receber um aviso 1 dia antes de cada vencimento.'); })
    .catch(fail);
}

/* ───────────────────────── Eventos ───────────────────────── */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-done],[data-open],[data-close],#archToggle,#addBtn,#pushBtn');
  if (e.target.classList.contains('overlay') && e.target.id !== 'signinSheet') return closeAll();
  if (!el) return;
  if (el.dataset.done) openDone(el.dataset.done);
  else if (el.dataset.open) openEdit(el.dataset.open);
  else if (el.hasAttribute('data-close')) closeAll();
  else if (el.id === 'archToggle') { showArchived = !showArchived; render(); }
  else if (el.id === 'addBtn') openEdit(null);
  else if (el.id === 'pushBtn') {
    if (el.classList.contains('on')) toast('Notificações já estão ativas neste aparelho.');
    else enablePush();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
document.addEventListener('change', e => { if (e.target.id === 'filterSelect') { filter = e.target.value; render(); } });

$('#doneSave').addEventListener('click', () => {
  const date = $('#doneDate').value;
  if (!date) return toast('Escolha uma data.');
  const t = find(doneId);
  setBusy(true);
  apiPost('markDone', { id: doneId, dateIso: date, note: $('#doneNote').value }).then(d => {
    closeAll(); render(d);
    const nt = find(doneId);
    toast(nt && nt.nextDue ? '✓ ' + t.task + ' · próximo vencimento em ' + fmt(nt.nextDue) : '✓ Salvo');
  }).catch(fail);
});

function postpone(untilIso){
  const t = find(doneId);
  setBusy(true);
  apiPost('postpone', { id: doneId, untilIso: untilIso }).then(d => {
    closeAll(); render(d);
    toast(untilIso ? '⏸ ' + t.task + ' adiada para ' + fmt(untilIso) : 'Adiamento removido');
  }).catch(fail);
}
$('#postponeSave').addEventListener('click', () => {
  const v = $('#postponeDate').value;
  if (!v || v <= DATA.today) return toast('Escolha uma data a partir de amanhã.');
  postpone(v);
});
$('#postponeClear').addEventListener('click', () => postpone(''));

$('#editSave').addEventListener('click', () => {
  const payload = {
    id: editId, task: $('#fTask').value, every: $('#fEvery').value, unit: $('#fUnit').value,
    who: $('#fWho').value, category: $('#fCat').value, lastDone: $('#fLast').value,
    notes: $('#fNotes').value, active: $('#fActive').checked,
  };
  setBusy(true);
  apiPost('saveTask', { task: payload }).then(d => { closeAll(); render(d); toast('✓ Salvo'); }).catch(fail);
});

// Atualiza quando o app volta a ficar em primeiro plano (ex: a outra pessoa marcou algo como feito).
document.addEventListener('visibilitychange', () => { if (!document.hidden && DATA) load(); });

try { localStorage.removeItem('homeUpkeepWho'); } catch (e) {} // não é mais usado: o nome vem do login
load();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    // Se as notificações já estão permitidas, renova o token em silêncio (o Google troca de vez em quando).
    if (pushSupported() && Notification.permission === 'granted' && localStorage.getItem('huPushToken')) {
      setTimeout(() => syncPushToken(false).catch(() => {}), 3000);
    }
  }).catch(() => {});
}
