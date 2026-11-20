/**
 * Manutenção da Casa (Home Upkeep): controle de manutenções recorrentes da casa.
 * A planilha guarda os dados. Este script funciona só como uma API JSON (chamada via JSONP
 * pelo app, que é hospedado separadamente no GitHub Pages para poder ser instalado no celular).
 * Gatilhos diários enviam os alertas por e-mail e as notificações push.
 *
 * Este arquivo é mantido no repositório do app no GitHub (Code.gs) e copiado para o
 * editor do Apps Script. Depois de colar: salvar e Implantar → Gerenciar implantações → Nova versão.
 *
 * Primeira vez: rode setup() uma vez pelo editor do Apps Script.
 */

const SHEET_TASKS = 'Tasks';
const SHEET_HISTORY = 'History';
const SHEET_SETTINGS = 'Settings';
const UNITS = ['days', 'weeks', 'months', 'years']; // códigos técnicos — não traduzir
const WHO = ['DIY', 'Pro']; // códigos técnicos — não traduzir

// Chave simples para evitar que alguém descubra a URL do script por acaso e consiga ler/editar
// os dados. Não é segurança forte (fica visível no código do app), só uma trava mínima.
// Tem que ser IDÊNTICA à API_KEY em app.js do app hospedado no GitHub Pages.
const API_KEY = 'EAymKiJNwWXufQInoUQjJxl7hVin';

// Login com Google. O ID do cliente OAuth é público (fica no app também). Quem pode entrar é
// definido em "allowed_emails" na aba Settings. A sessão do app dura SESSION_DAYS dias por aparelho.
const GOOGLE_CLIENT_ID = '826797750892-obk3k8ikci93idmlj75jtv3ql0k9fs2j.apps.googleusercontent.com';
const SESSION_DAYS = 90;

// Notificações push (Firebase Cloud Messaging), projeto do Firebase/Google Cloud.
const FIREBASE_PROJECT_ID = 'home-upkeep-d770c';
const SHEET_PUSH = 'Push';

// Colunas da aba Tasks (1-based). A coluna G (Próximo Vencimento) é uma fórmula para a planilha ficar legível;
// o script nunca escreve nela e calcula as datas de vencimento por conta própria.
const C = { ID: 1, TASK: 2, CAT: 3, EVERY: 4, UNIT: 5, LAST: 6, NEXT: 7, WHO: 8, NOTES: 9, ACTIVE: 10, POSTPONE: 11 };
const NCOLS = 11;

// Próximo vencimento = Feito em + intervalo; se a tarefa foi adiada (coluna K) para depois disso, vale a data adiada.
const NEXT_DUE_FORMULA =
  '={"Próximo Vencimento";ARRAYFORMULA(IF((B2:B="")+(F2:F="")+(D2:D=""),,' +
  'LET(x,IF(E2:E="days",F2:F+D2:D,IF(E2:E="weeks",F2:F+7*D2:D,' +
  'IF(E2:E="years",EDATE(F2:F,12*D2:D),EDATE(F2:F,D2:D)))),IF(K2:K>x,K2:K,x))))}';
// Mesma fórmula com a sintaxe do locale pt_BR da planilha (a versão com vírgulas dá erro de análise).
const NEXT_DUE_FORMULA_PTBR = NEXT_DUE_FORMULA.replace(/,/g, ';');

// [tarefa, categoria, a cada, unidade (técnica, não traduzir), quem (técnico, não traduzir), notas]
const SEED_TASKS = [
  ['Despejar vinagre no dreno do ar-condicionado', 'Ar-condicionado', 1, 'months', 'DIY', 'Cerca de 1 xícara de vinagre branco na abertura de acesso do dreno, perto da unidade interna. Evita entupimento por mofo/algas.'],
  ['Trocar o filtro do ar-condicionado', 'Ar-condicionado', 2, 'months', 'DIY', 'A cada 1-3 meses. Tamanho do filtro: ______'],
  ['Fazer a manutenção profissional do ar-condicionado', 'Ar-condicionado', 1, 'years', 'Pro', 'Serpentinas, gás refrigerante, bandeja de dreno. Fornecedor: ______'],
  ['Quebrar o sal do amaciador de água', 'Água', 1, 'months', 'DIY', 'Bata no sal com um macete para quebrar crostas, depois complete o nível.'],
  ['Limpeza profissional do tanque do amaciador de água', 'Água', 1, 'years', 'Pro', 'Fornecedor: ______'],
  ['Fazer a purga do aquecedor de água', 'Água', 6, 'months', 'DIY', 'Desligue a energia/gás e drene pela válvula inferior até a água sair limpa.'],
  ['Lubrificar a porta da garagem', 'Garagem', 6, 'months', 'DIY', 'Spray de silicone ou lítio nas dobradiças, roldanas e molas. Não aplique nos trilhos.'],
  ['Testar a reversão automática da porta da garagem', 'Garagem', 6, 'months', 'DIY', 'Coloque uma tábua sob a porta; ela deve reverter ao tocá-la.'],
  ['Trocar o filtro de água da geladeira', 'Cozinha', 6, 'months', 'DIY', 'Modelo do filtro: ______'],
  ['Limpar o filtro da lava-louças', 'Cozinha', 1, 'months', 'DIY', ''],
  ['Limpar o triturador de resíduos', 'Cozinha', 1, 'months', 'DIY', 'Gelo + sal grosso, depois cascas de cítricos.'],
  ['Limpar os filtros da coifa', 'Cozinha', 6, 'months', 'DIY', 'Água quente e desengordurante, ou na lava-louças.'],
  ['Testar detectores de fumaça e monóxido de carbono', 'Segurança', 1, 'months', 'DIY', ''],
  ['Trocar as pilhas dos detectores de fumaça', 'Segurança', 1, 'years', 'DIY', ''],
  ['Verificar o extintor de incêndio', 'Segurança', 1, 'years', 'DIY', 'Manômetro na faixa verde, pino intacto, dentro da validade.'],
  ['Testar as tomadas com DR/GFCI', 'Segurança', 3, 'months', 'DIY', 'Aperte TEST e depois RESET nas tomadas da cozinha, banheiro e áreas externas.'],
  ['Limpar o duto da secadora', 'Lavanderia', 1, 'years', 'Pro', 'O duto completo até a saída externa, não só o filtro de fiapos.'],
  ['Verificar vazamentos embaixo das pias', 'Encanamento', 3, 'months', 'DIY', ''],
  ['Inspecionar o rejunte/silicone de banheiras, boxes e pias', 'Encanamento', 6, 'months', 'DIY', 'Reaplique onde estiver rachado ou mofado.'],
  ['Dedetização', 'Área externa', 3, 'months', 'Pro', 'Fornecedor: ______'],
  ['Inspecionar o telhado e limpar as calhas', 'Área externa', 1, 'years', 'Pro', ''],
  ['Verificar o sistema de irrigação', 'Área externa', 1, 'years', 'DIY', 'Aspersores quebrados, vazamentos, cobertura.'],
];

const DEFAULT_SETTINGS = [
  ['alert_emails', '', 'E-mails que recebem alertas, separados por vírgula'],
  ['people', '', 'Nomes que aparecem no app e no histórico: pares e-mail=Nome, separados por vírgula (ex: pessoa1@exemplo.com=Nome1,pessoa2@exemplo.com=Nome2)'],
  ['daily_alert_hour', 7, 'Hora (0-23) da checagem diária. Depois de alterar, use o menu Manutenção da Casa > Reinstalar alertas diários'],
  ['weekly_digest_day', 'Monday', 'Dia do resumo semanal'],
  ['digest_window_days', 7, 'O resumo semanal lista tarefas que vencem dentro desses dias'],
  ['remind_overdue_every_days', 3, 'Repete lembretes de atraso a cada N dias (0 = só no resumo semanal)'],
  ['pro_heads_up_days', 14, 'Para tarefas profissionais, envia e-mail com essa antecedência para dar tempo de contratar alguém'],
  ['app_url', '', 'URL do app no GitHub Pages, para os e-mails linkarem para o app'],
  ['allowed_emails', '', 'Contas Google que podem usar o app, separadas por vírgula'],
  ['push_hour', 18, 'Hora (0-23) da notificação push diária. Depois de alterar, use o menu Manutenção da Casa > Reinstalar alertas diários'],
  ['push_days_before', 1, 'A notificação push avisa as tarefas que vencem daqui a N dias (1 = amanhã)'],
];

/* ───────────────────────── Setup ───────────────────────── */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetLocale('pt_BR');
  ss.setSpreadsheetTimeZone('America/New_York');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());

  const tasks = getOrCreateSheet_(ss, SHEET_TASKS);
  if (lastDataRow_(tasks) <= 1 && String(tasks.getRange(1, 1).getValue()) === '') {
    tasks.getRange(1, 1, 1, 6).setValues([['ID', 'Tarefa', 'Categoria', 'A cada', 'Unidade', 'Feito em']]);
    tasks.getRange(1, C.NEXT).setFormula(NEXT_DUE_FORMULA);
    tasks.getRange(1, C.WHO, 1, 3).setValues([['Quem', 'Notas', 'Ativo']]);
    const rows = SEED_TASKS.map((t, i) => ['T' + String(i + 1).padStart(3, '0'), t[0], t[1], t[2], t[3], '']);
    tasks.getRange(2, 1, rows.length, 6).setValues(rows);
    tasks.getRange(2, C.WHO, rows.length, 3).setValues(SEED_TASKS.map(t => [t[4], t[5], true]));
  }
  formatTasks_(tasks);

  const hist = getOrCreateSheet_(ss, SHEET_HISTORY);
  if (hist.getLastRow() === 0) {
    hist.getRange(1, 1, 1, 6).setValues([['Registrado em', 'ID da Tarefa', 'Tarefa', 'Data Feita', 'Feito por', 'Nota']]);
    hist.setFrozenRows(1);
    hist.getRange(1, 1, 1, 6).setFontWeight('bold');
    hist.getRange('A2:A').setNumberFormat('dd/mm/yyyy hh:mm');
    hist.getRange('D2:D').setNumberFormat('dd/mm/yyyy');
  }

  const set = getOrCreateSheet_(ss, SHEET_SETTINGS);
  if (set.getLastRow() === 0) {
    set.getRange(1, 1, 1, 3).setValues([['Chave', 'Valor', 'Notas']]);
    set.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    set.setFrozenRows(1);
    set.getRange(1, 1, 1, 3).setFontWeight('bold');
    set.setColumnWidth(1, 200); set.setColumnWidth(2, 320); set.setColumnWidth(3, 520);
  }

  installTriggers();
  Logger.log('Setup concluído. Próximo passo: preencha a aba Settings, depois Deploy > New deployment > Web app.');
}

// Atualiza os textos visíveis (cabeçalhos, tarefas, notas) de uma planilha já configurada
// para português, sem mexer nos códigos técnicos (Unidade, Quem) nem nos valores que você
// já preencheu em Settings (e-mails, URL do app etc.).
function localizeToPTBR() {
  const ss = openSS_();
  ss.setSpreadsheetLocale('pt_BR');

  const tasks = ss.getSheetByName(SHEET_TASKS);
  tasks.getRange(1, 1, 1, 10).setValues([['ID', 'Tarefa', 'Categoria', 'A cada', 'Unidade', 'Feito em', 'Próximo Vencimento', 'Quem', 'Notas', 'Ativo']]);
  const n = SEED_TASKS.length;
  tasks.getRange(2, C.TASK, n, 1).setValues(SEED_TASKS.map(t => [t[0]]));
  tasks.getRange(2, C.CAT, n, 1).setValues(SEED_TASKS.map(t => [t[1]]));
  tasks.getRange(2, C.NOTES, n, 1).setValues(SEED_TASKS.map(t => [t[5]]));

  const hist = ss.getSheetByName(SHEET_HISTORY);
  if (hist) hist.getRange(1, 1, 1, 6).setValues([['Registrado em', 'ID da Tarefa', 'Tarefa', 'Data Feita', 'Feito por', 'Nota']]);

  const set = ss.getSheetByName(SHEET_SETTINGS);
  if (set) {
    set.getRange(1, 1, 1, 3).setValues([['Chave', 'Valor', 'Notas']]);
    set.getRange(2, 3, DEFAULT_SETTINGS.length, 1).setValues(DEFAULT_SETTINGS.map(s => [s[2]]));
  }
  Logger.log('Planilha traduzida para PT-BR (cabeçalhos, tarefas, categorias e notas).');
}

// Instala os dois gatilhos diários: e-mails (daily_alert_hour) e push (push_hour).
// Os gatilhos chamam versões "uma vez por dia" das funções, porque o Google às vezes dispara o
// mesmo gatilho duas vezes em seguida (foi o que causou o e-mail duplicado de 16/11/2026).
function installTriggers() {
  const ss = openSS_();
  const s = getSettings_(ss);
  const tz = ss.getSpreadsheetTimeZone();
  const hourOf = (v, d) => { const n = Number(v); return Math.min(23, Math.max(0, isNaN(n) || v === '' ? d : n)); };
  const handlers = ['runDailyAlerts', 'runDailyAlertsOnce', 'runDailyPush', 'runDailyPushOnce'];
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runDailyAlertsOnce').timeBased().everyDays(1).atHour(hourOf(s.daily_alert_hour, 7)).inTimezone(tz).create();
  ScriptApp.newTrigger('runDailyPushOnce').timeBased().everyDays(1).atHour(hourOf(s.push_hour, 18)).inTimezone(tz).create();
}

function runDailyAlertsOnce() { if (claimToday_('alerts')) runDailyAlerts(); }
function runDailyPushOnce() { if (claimToday_('push')) runDailyPush(); }

// Garante que cada tarefa diária rode no máximo uma vez por dia, mesmo se o gatilho disparar duas vezes.
function claimToday_(name) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const today = todayIso_(openSS_().getSpreadsheetTimeZone());
    const key = 'last_run_' + name;
    if (props.getProperty(key) === today) return false;
    props.setProperty(key, today);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Rode uma vez depois de atualizar o código: cria a coluna K (Adiado até), atualiza a fórmula de
// Próximo Vencimento, cria a aba Push e acrescenta as novas chaves na aba Settings. Pode rodar de novo sem problema.
function migrate() {
  const ss = openSS_();
  const tasks = ss.getSheetByName(SHEET_TASKS);
  if (tasks.getMaxColumns() < NCOLS) tasks.insertColumnsAfter(tasks.getMaxColumns(), NCOLS - tasks.getMaxColumns());
  tasks.getRange(1, C.POSTPONE).setValue('Adiado até').setFontWeight('bold');
  tasks.getRange(2, C.POSTPONE, tasks.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  // A fórmula de Próximo Vencimento (G1) foi digitada direto na planilha, com a sintaxe do locale pt_BR
  // (separador ";"). Só é recriada aqui se a célula estiver sem fórmula.
  if (!tasks.getRange(1, C.NEXT).getFormula()) tasks.getRange(1, C.NEXT).setFormula(NEXT_DUE_FORMULA_PTBR);
  tasks.getRange(2, C.NEXT, tasks.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  pushSheet_(ss);
  const set = ss.getSheetByName(SHEET_SETTINGS);
  const have = set.getRange(2, 1, Math.max(1, set.getLastRow() - 1), 1).getValues().map(r => String(r[0]).trim());
  DEFAULT_SETTINGS.filter(d => have.indexOf(d[0]) < 0).forEach(d => set.appendRow(d));
  Logger.log('Migração concluída.');
}

function pushSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_PUSH);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PUSH);
    sh.getRange(1, 1, 1, 5).setValues([['Token', 'Conta', 'Aparelho', 'Criado em', 'Visto em']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 260);
  }
  return sh;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Manutenção da Casa')
    .addItem('Enviar resumo por e-mail agora (teste)', 'sendSummaryNow')
    .addItem('Enviar notificação push de teste', 'sendPushTest')
    .addItem('Reinstalar alertas diários', 'installTriggers')
    .addItem('Traduzir planilha para PT-BR', 'localizeToPTBR')
    .addToUi();
}

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  const sheets = ss.getSheets();
  if (name === SHEET_TASKS && sheets.length === 1 && sheets[0].getLastRow() === 0) {
    return sheets[0].setName(name);
  }
  return ss.insertSheet(name);
}

function formatTasks_(sh) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 10).setFontWeight('bold');
  sh.getRange('F2:G').setNumberFormat('dd/mm/yyyy');
  sh.getRange('E2:E').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(UNITS, true).setAllowInvalid(false).build());
  sh.getRange('H2:H').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(WHO, true).build());
  sh.getRange('J2:J').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.setColumnWidth(C.TASK, 300);
  sh.setColumnWidth(C.NOTES, 380);
}

/* ───────────────────────── API JSON (chamada via JSONP pelo app no GitHub Pages) ─────────────────────────
 * Tudo via GET + callback=nomeDaFuncao (JSONP). Ações:
 *   login         idToken=<login do Google>  → devolve uma sessão do app (90 dias)
 *   getData       t=<sessão>
 *   getHistory    t, id
 *   markDone      t, id, dateIso, note
 *   saveTask      t, task=<JSON>
 *   postpone      t, id, untilIso (vazio = remove o adiamento)
 *   savePushToken t, token, device
 */

// O Apps Script web app bloqueia fetch()/XHR entre domínios (erro 503 só para chamadas CORS) e
// também bloqueia qualquer navegação de página inteira pra dentro dele — inclusive um <form> POST
// enviado a um <iframe> escondido: o Google exige uma tela de autorização OAuth interativa nesse
// caso, que nunca completa sozinha. A única forma que funciona sem nenhuma interação da pessoa é uma
// tag <script src="..."> (JSONP). Por isso leituras E escritas usam GET + JSONP.
function doGet(e) {
  const p = (e && e.parameter) || {};
  return withApi_(p.key, () => {
    if (p.action === 'login') return login_(p.idToken);
    auth_(p.t); // daqui pra baixo, só quem está em allowed_emails
    if (p.action === 'getData') return getData();
    if (p.action === 'getHistory') return getHistory(p.id);
    if (p.action === 'markDone') return markDone(p.id, p.dateIso, p.note, ME_.name);
    if (p.action === 'saveTask') {
      let task = {};
      if (p.task) { try { task = JSON.parse(p.task); } catch (err) { /* saveTask valida e lança erro */ } }
      return saveTask(task, ME_.name);
    }
    if (p.action === 'postpone') return postpone(p.id, p.untilIso, ME_.name);
    if (p.action === 'savePushToken') return savePushToken(p.token, p.device);
    throw new Error('Ação desconhecida: ' + p.action);
  }, p.callback);
}

// Mantido só por compatibilidade (nada mais chama via POST), delega pro mesmo tratamento do GET.
function doPost(e) { return doGet(e); }

function withApi_(key, fn, callback) {
  let result;
  try {
    if (key !== API_KEY) {
      result = { ok: false, error: 'Não autorizado.' };
    } else {
      result = { ok: true, data: fn() };
    }
  } catch (err) {
    result = { ok: false, error: (err && err.message) || String(err) };
    if (err && err.auth) result.auth = true;
  }
  return output_(result, callback);
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback && /^[\w$.]+$/.test(String(callback))) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  // Sem callback válido (chamada direta/manual): devolve o JSON puro.
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────── Login (Google) e sessões ───────────────────────── */

let ME_ = null; // { email, name } de quem está usando o app nesta chamada

function authErr_(msg) { const e = new Error(msg); e.auth = true; return e; }

// Recebe o login do Google (ID token), confere com o Google e devolve uma sessão do app.
function login_(idToken) {
  if (!idToken) throw authErr_('Entre com sua conta Google.');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw authErr_('Não foi possível confirmar o login do Google. Tente de novo.');
  const info = JSON.parse(r.getContentText());
  if (info.aud !== GOOGLE_CLIENT_ID) throw authErr_('Login do Google inválido para este app.');
  if (String(info.email_verified) !== 'true') throw authErr_('E-mail do Google não verificado.');
  const email = String(info.email || '').toLowerCase();
  const ss = openSS_();
  if (!isAllowed_(ss, email)) throw authErr_('A conta ' + email + ' não tem acesso a este app.');
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return { token: signSession_(email, exp), exp: exp, email: email, name: nameFor_(ss, email) };
}

function auth_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw authErr_('Entre com sua conta Google.');
  if (sign_(parts[0]) !== parts[1]) throw authErr_('Sessão inválida. Entre de novo.');
  const raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(pad_(parts[0]))).getDataAsString();
  const i = raw.lastIndexOf('|');
  const email = raw.slice(0, i), exp = Number(raw.slice(i + 1));
  if (!(exp * 1000 > Date.now())) throw authErr_('Sua sessão expirou. Entre de novo.');
  const ss = openSS_();
  if (!isAllowed_(ss, email)) throw authErr_('A conta ' + email + ' não tem mais acesso a este app.');
  ME_ = { email: email, name: nameFor_(ss, email) };
  return ME_;
}

function signSession_(email, exp) {
  const payload = Utilities.base64EncodeWebSafe(email + '|' + exp).replace(/=+$/, '');
  return payload + '.' + sign_(payload);
}

function sign_(payload) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret)).replace(/=+$/, '');
}

function pad_(b64) { return b64 + '==='.slice((b64.length + 3) % 4); }

function isAllowed_(ss, email) {
  const list = String(getSettings_(ss).allowed_emails || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  return !!email && list.indexOf(String(email).toLowerCase()) >= 0;
}

// "people" na aba Settings: email=Nome,email=Nome
function nameFor_(ss, email) {
  const map = {};
  String(getSettings_(ss).people || '').split(',').forEach(pair => {
    const i = pair.indexOf('=');
    if (i > 0) map[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
  });
  return map[String(email).toLowerCase()] || String(email).split('@')[0];
}


function getData() {
  const ss = openSS_();
  const tz = ss.getSpreadsheetTimeZone();
  const tasks = readTasks_(ss).map(t => { const o = Object.assign({}, t); delete o.row; return o; });
  return { today: todayIso_(tz), tasks: tasks, me: ME_ };
}

function markDone(id, dateIso, note, who) {
  const ss = openSS_();
  const tz = ss.getSpreadsheetTimeZone();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) throw new Error('Escolha uma data válida.');
  if (dateIso > todayIso_(tz)) throw new Error('A data não pode ser no futuro.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTasks_(ss).find(x => x.id === id);
    if (!t) throw new Error('Tarefa não encontrada. Atualize a página.');
    const sh = ss.getSheetByName(SHEET_TASKS);
    // Registrar uma data antiga (para atualizar o histórico) nunca atrasa a contagem.
    if (!t.lastDone || dateIso >= t.lastDone) {
      sh.getRange(t.row, C.LAST).setValue(dateIso);
      sh.getRange(t.row, C.POSTPONE).clearContent(); // feito: o próximo vencimento conta a partir desta data
    }
    ss.getSheetByName(SHEET_HISTORY).appendRow([new Date(), id, t.task, dateIso, String(who || 'Alguém').slice(0, 60), String(note || '').slice(0, 500)]);
  } finally {
    lock.releaseLock();
  }
  return getData();
}

function saveTask(input, who) {
  const ss = openSS_();
  const task = String(input.task || '').trim();
  const every = Math.floor(Number(input.every));
  const unit = String(input.unit || '');
  const taskWho = WHO.indexOf(input.who) >= 0 ? input.who : '';
  const lastDone = String(input.lastDone || '');
  if (!task) throw new Error('Dê um nome à tarefa.');
  if (!(every >= 1)) throw new Error('O campo "A cada" deve ser 1 ou mais.');
  if (UNITS.indexOf(unit) < 0) throw new Error('Escolha dias, semanas, meses ou anos.');
  if (lastDone && !/^\d{4}-\d{2}-\d{2}$/.test(lastDone)) throw new Error('A data informada não é válida.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss.getSheetByName(SHEET_TASKS);
    let row;
    let id = String(input.id || '');
    const isNew = !id;
    if (id) {
      const t = readTasks_(ss).find(x => x.id === id);
      if (!t) throw new Error('Tarefa não encontrada. Atualize a página.');
      row = t.row;
    } else {
      id = 'T' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
      row = lastDataRow_(sh) + 1;
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);
      sh.getRange(row, C.ID).setValue(id);
    }
    sh.getRange(row, C.TASK, 1, 4).setValues([[task, String(input.category || '').trim(), every, unit]]);
    sh.getRange(row, C.LAST).setValue(lastDone);
    sh.getRange(row, C.WHO, 1, 3).setValues([[taskWho, String(input.notes || ''), input.active !== false]]);
    if (isNew) {
      ss.getSheetByName(SHEET_HISTORY).appendRow([new Date(), id, task, '', String(who || 'Alguém').slice(0, 60), 'Tarefa criada']);
    }
  } finally {
    lock.releaseLock();
  }
  return getData();
}

// Adia o vencimento atual de uma tarefa até untilIso (vazio = remove o adiamento).
// Ao marcar como feita, o adiamento some e o próximo vencimento conta a partir da data em que foi feita.
function postpone(id, untilIso, who) {
  const ss = openSS_();
  const tz = ss.getSpreadsheetTimeZone();
  untilIso = String(untilIso || '');
  if (untilIso && !/^\d{4}-\d{2}-\d{2}$/.test(untilIso)) throw new Error('Escolha uma data válida.');
  if (untilIso && untilIso <= todayIso_(tz)) throw new Error('Escolha uma data a partir de amanhã.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTasks_(ss).find(x => x.id === id);
    if (!t) throw new Error('Tarefa não encontrada. Atualize a página.');
    if (untilIso && !t.lastDone) throw new Error('Defina primeiro quando a tarefa foi feita.');
    const sh = ss.getSheetByName(SHEET_TASKS);
    if (untilIso) sh.getRange(t.row, C.POSTPONE).setValue(untilIso);
    else sh.getRange(t.row, C.POSTPONE).clearContent();
    ss.getSheetByName(SHEET_HISTORY).appendRow([new Date(), id, t.task, '', String(who || 'Alguém').slice(0, 60),
      untilIso ? 'Adiada para ' + prettyDate_(untilIso, tz) : 'Adiamento removido']);
  } finally {
    lock.releaseLock();
  }
  return getData();
}

// Guarda (ou atualiza) o token de notificação push de um aparelho na aba Push.
function savePushToken(token, device) {
  token = String(token || '').trim();
  if (!token || token.length > 4096) throw new Error('Token de notificação inválido.');
  const ss = openSS_();
  const sh = pushSheet_(ss);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
    const i = rows.findIndex(r => String(r[0]) === token);
    const who = ME_ ? ME_.email : '';
    if (i >= 0) sh.getRange(i + 2, 2, 1, 4).setValues([[who, String(device || '').slice(0, 60), sh.getRange(i + 2, 4).getValue(), new Date()]]);
    else sh.appendRow([token, who, String(device || '').slice(0, 60), new Date(), new Date()]);
  } finally {
    lock.releaseLock();
  }
  return true;
}

function getHistory(id) {
  const ss = openSS_();
  const tz = ss.getSpreadsheetTimeZone();
  const sh = ss.getSheetByName(SHEET_HISTORY);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 6).getValues()
    .filter(r => String(r[1]) === String(id))
    .map(r => ({ date: toIso_(r[3], tz) || toIso_(r[0], tz), by: String(r[4] || ''), note: String(r[5] || ''), at: r[0] instanceof Date ? r[0].getTime() : 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at))
    .slice(0, 25);
}

/* ───────────────────────── Alertas por e-mail ───────────────────────── */

function runDailyAlerts() { sendAlerts_(false); }   // chamado pelo gatilho diário
function sendSummaryNow() { sendAlerts_(true); }    // item de menu, para teste

function sendAlerts_(forceSummary) {
  const ss = openSS_();
  const s = getSettings_(ss);
  const to = String(s.alert_emails || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!to.length) { Logger.log('Nenhum e-mail em alert_emails na aba Settings.'); return; }

  const tz = ss.getSpreadsheetTimeZone();
  const tasks = readTasks_(ss).filter(t => t.active && t.nextDue).sort((a, b) => a.daysUntil - b.daysUntil);
  const weekday = Utilities.formatDate(new Date(), tz, 'EEEE').toLowerCase();
  const isSummary = forceSummary || weekday === String(s.weekly_digest_day || 'Monday').trim().toLowerCase();
  const windowDays = Number(s.digest_window_days) || 7;
  const overdueEvery = Number(s.remind_overdue_every_days) || 0;
  const proLead = Number(s.pro_heads_up_days) || 0;

  const overdue = tasks.filter(t => t.daysUntil < 0);
  const today = tasks.filter(t => t.daysUntil === 0);
  const sections = [];

  if (isSummary) {
    const soon = tasks.filter(t => t.daysUntil > 0 && t.daysUntil <= windowDays);
    const book = tasks.filter(t => t.who === 'Pro' && t.daysUntil > windowDays && t.daysUntil <= proLead);
    if (overdue.length) sections.push(['Atrasadas', overdue]);
    if (today.length) sections.push(['Vencem hoje', today]);
    if (soon.length) sections.push(['Chegando nos próximos ' + windowDays + ' dias', soon]);
    if (book.length) sections.push(['Hora de contratar um profissional', book]);
    if (!sections.length && !forceSummary) return;
  } else {
    const nudge = overdueEvery > 0 ? overdue.filter(t => (-t.daysUntil) % overdueEvery === 0) : [];
    const book = proLead > 0 ? tasks.filter(t => t.who === 'Pro' && t.daysUntil === proLead) : [];
    if (today.length) sections.push(['Vencem hoje', today]);
    if (nudge.length) sections.push(['Ainda atrasadas', nudge]);
    if (book.length) sections.push(['Hora de contratar um profissional', book]);
    if (!sections.length) return;
  }

  const count = sections.reduce((n, sec) => n + sec[1].length, 0);
  const subject = isSummary
    ? (count ? 'Manutenção da casa nesta semana: ' + count + ' tarefa' + (count === 1 ? '' : 's') : 'Manutenção da casa: nada pendente esta semana')
    : 'Manutenção da casa: ' + sections.map(sec => sec[1].length + ' ' + sec[0].toLowerCase()).join(', ');

  MailApp.sendEmail({
    to: to.join(','),
    subject: subject,
    name: 'Manutenção da Casa',
    htmlBody: emailHtml_(sections, s.app_url || safeUrl_(), tz),
  });
}

function emailHtml_(sections, url, tz) {
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const label = t => t.daysUntil < 0 ? 'atrasada há ' + (-t.daysUntil) + 'd'
    : t.daysUntil === 0 ? 'hoje' : 'em ' + t.daysUntil + 'd · ' + prettyDate_(t.nextDue, tz);
  let html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1c1a;max-width:560px">';
  if (!sections.length) html += '<p>Nada pendente no momento. 👍</p>';
  sections.forEach(sec => {
    html += '<h3 style="margin:20px 0 6px;font-size:15px">' + esc(sec[0]) + '</h3>' +
      '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">';
    sec[1].forEach(t => {
      html += '<tr><td style="padding:8px 0;border-bottom:1px solid #eee">' + esc(t.task) +
        (t.who === 'Pro' ? ' <span style="color:#6d6b64;font-size:12px">(Pro)</span>' : '') +
        '</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#6d6b64;white-space:nowrap">' +
        esc(label(t)) + '</td></tr>';
    });
    html += '</table>';
  });
  if (url) {
    html += '<p style="margin-top:24px"><a href="' + esc(url) + '" style="background:#2e6b5b;color:#fff;' +
      'text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">Abrir Manutenção da Casa</a></p>';
  }
  return html + '</div>';
}

function safeUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/* ───────────────────────── Notificações push (Firebase Cloud Messaging) ───────────────────────── */

// Chamado pelo gatilho diário (via runDailyPushOnce): avisa no celular as tarefas que vencem em push_days_before dias.
function runDailyPush() {
  const ss = openSS_();
  const s = getSettings_(ss);
  const days = Number(s.push_days_before) || 1;
  const due = readTasks_(ss).filter(t => t.active && t.nextDue && t.daysUntil === days)
    .sort((a, b) => a.task.localeCompare(b.task));
  if (!due.length) return;
  const when = days === 1 ? 'amanhã' : 'em ' + days + ' dias';
  const title = due.length === 1 ? 'Vence ' + when + ': ' + due[0].task : due.length + ' tarefas vencem ' + when;
  const body = due.length === 1 ? (due[0].who === 'Pro' ? 'Tarefa Pro: já combinou com o profissional?' : 'Toque para abrir o app.')
    : due.map(t => '• ' + t.task).join('\n');
  sendPush_(title, body);
}

// Item de menu: manda uma notificação de teste para todos os aparelhos cadastrados.
function sendPushTest() {
  const n = sendPush_('Manutenção da Casa', 'Notificação de teste 🔔 Está funcionando!');
  try { SpreadsheetApp.getUi().alert('Notificação enviada para ' + n + ' aparelho(s).'); } catch (e) { Logger.log('Enviado para ' + n); }
}

function sendPush_(title, body) {
  const ss = openSS_();
  const sh = pushSheet_(ss);
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const tokens = sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0]).trim());
  const url = String(getSettings_(ss).app_url || '');
  const auth = 'Bearer ' + ScriptApp.getOAuthToken();
  const reqs = tokens.map(tok => ({
    url: 'https://fcm.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/messages:send',
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: auth },
    muteHttpExceptions: true,
    payload: JSON.stringify({ message: { token: tok, webpush: {
      headers: { TTL: '86400', Urgency: 'high' },
      data: { title: title, body: body, url: url },
    } } }),
  }));
  const res = UrlFetchApp.fetchAll(reqs);
  let sent = 0;
  const dead = [];
  res.forEach((r, i) => {
    const code = r.getResponseCode();
    if (code === 200) { sent++; return; }
    const txt = r.getContentText();
    Logger.log('Push falhou (' + code + '): ' + txt.slice(0, 300));
    if (code === 404 || /UNREGISTERED|registration-token-not-registered/.test(txt)) dead.push(i + 2);
  });
  dead.reverse().forEach(row => sh.deleteRow(row)); // aparelho desinstalou/desativou: tira da lista
  return sent;
}

/* ───────────────────────── Funções auxiliares de dados ───────────────────────── */

function openSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Rode setup() primeiro.');
  return ss;
}

function readTasks_(ss) {
  const sh = ss.getSheetByName(SHEET_TASKS);
  const tz = ss.getSpreadsheetTimeZone();
  const last = lastDataRow_(sh);
  if (last < 2) return [];
  const today = todayIso_(tz);
  const vals = sh.getRange(2, 1, last - 1, NCOLS).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const task = String(r[C.TASK - 1] || '').trim();
    if (!task) return;
    let id = String(r[C.ID - 1] || '').trim();
    if (!id) { // linha adicionada direto na planilha: cria um ID
      id = 'T' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
      sh.getRange(i + 2, C.ID).setValue(id);
    }
    const every = Math.floor(Number(r[C.EVERY - 1])) || 0;
    const unit = UNITS.indexOf(String(r[C.UNIT - 1]).trim().toLowerCase()) >= 0
      ? String(r[C.UNIT - 1]).trim().toLowerCase() : 'months';
    const lastDone = toIso_(r[C.LAST - 1], tz);
    const computedDue = lastDone && every ? addInterval_(lastDone, every, unit) : '';
    // Adiamento (coluna K) só vale se for depois do vencimento calculado.
    let postponedUntil = toIso_(r[C.POSTPONE - 1], tz);
    if (!computedDue || postponedUntil <= computedDue) postponedUntil = '';
    const nextDue = postponedUntil || computedDue;
    const activeRaw = r[C.ACTIVE - 1];
    out.push({
      row: i + 2,
      id: id,
      task: task,
      category: String(r[C.CAT - 1] || ''),
      every: every,
      unit: unit,
      lastDone: lastDone,
      nextDue: nextDue,
      postponedUntil: postponedUntil,
      originalDue: postponedUntil ? computedDue : '',
      daysUntil: nextDue ? daysBetween_(today, nextDue) : null,
      who: String(r[C.WHO - 1] || ''),
      notes: String(r[C.NOTES - 1] || ''),
      active: !(activeRaw === false || String(activeRaw).toUpperCase() === 'FALSE'),
    });
  });
  return out;
}

// Última linha com nome de tarefa (coluna B). Ignora a fórmula de Próximo Vencimento e a caixa de seleção.
function lastDataRow_(sh) {
  const n = sh.getMaxRows();
  const v = sh.getRange(1, C.TASK, n, 1).getValues();
  for (let i = n - 1; i >= 0; i--) if (String(v[i][0]).trim() !== '') return i + 1;
  return 1;
}

function getSettings_(ss) {
  const sh = ss.getSheetByName(SHEET_SETTINGS);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (r[0]) out[String(r[0]).trim()] = r[1];
  });
  return out;
}

/* ───────────────────────── Funções de data (strings ISO, à prova de fuso) ───────────────────────── */

function todayIso_(tz) { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); }

function toIso_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function isoUTC_(d) { return d.toISOString().slice(0, 10); }

function addInterval_(iso, n, unit) {
  const p = iso.split('-').map(Number);
  if (unit === 'days' || unit === 'weeks') {
    return isoUTC_(new Date(Date.UTC(p[0], p[1] - 1, p[2]) + (unit === 'weeks' ? 7 * n : n) * 864e5));
  }
  const total = (p[1] - 1) + (unit === 'years' ? 12 * n : n);
  const y = p[0] + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return isoUTC_(new Date(Date.UTC(y, m, Math.min(p[2], dim))));
}

function daysBetween_(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5);
}

function prettyDate_(iso, tz) {
  const p = iso.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)), 'UTC', 'dd/MM');
}
