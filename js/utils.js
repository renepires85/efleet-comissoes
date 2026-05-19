// ── FORMATAÇÃO ────────────────────────────────────────────────────────────────
function fmtR(v) {
  return 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

function formatPeriodo(i, f) {
  if (!f) return '—';
  return new Date(f + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ── PERÍODO ───────────────────────────────────────────────────────────────────
function getPeriodoDates(tipo) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (tipo) {
    case 'mes_atual':  return { ini: new Date(y, m, 1),    fim: new Date(y, m + 1, 0) };
    case 'ultimo_mes': return { ini: new Date(y, m - 1, 1), fim: new Date(y, m, 0) };
    case '3m':         return { ini: new Date(y, m - 3, 1), fim: new Date(y, m + 1, 0) };
    case '6m':         return { ini: new Date(y, m - 6, 1), fim: new Date(y, m + 1, 0) };
    case '12m':        return { ini: new Date(y, m - 12, 1),fim: new Date(y, m + 1, 0) };
    case 'ano_atual':  return { ini: new Date(y, 0, 1),     fim: new Date(y, 11, 31) };
    case 'tudo':       return { ini: new Date('2000-01-01'), fim: new Date('2099-12-31') };
    default:           return { ini: new Date(y, m - 1, 1), fim: new Date(y, m, 0) };
  }
}

function togglePeriodoMenu() {
  const m = document.getElementById('periodo-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

function setPeriodo(tipo, label) {
  periodoAtual = tipo;
  document.getElementById('periodo-label').textContent = label;
  document.getElementById('periodo-menu').style.display = 'none';
  document.querySelectorAll('.periodo-opt').forEach(o => o.classList.remove('active'));
  const el = document.getElementById('opt-' + tipo);
  if (el) el.classList.add('active');
  carregarGestao();
}

// ── STATUS BOX ────────────────────────────────────────────────────────────────
function showStatus(msg, tipo, target) {
  const el = document.getElementById(target || 'upload-status');
  if (!el) return;
  el.className = `status-box status-${tipo}`;
  el.style.display = 'block';
  el.textContent = msg;
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────────────────────
function switchNav(tab) {
  document.querySelectorAll('#nav-tabs .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-' + tab).classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  if (tab === 'comissoes')    { document.getElementById('view-gestao').classList.add('active');        carregarGestao(); }
  else if (tab === 'arquivos')     { document.getElementById('view-arquivos').classList.add('active');      carregarArquivos(); }
  else if (tab === 'checkpoints')  { document.getElementById('view-checkpoints').classList.add('active');   carregarCheckpoints(); }
  else if (tab === 'prestadores')  { document.getElementById('view-prestadores').classList.add('active');   carregarPrestadores(); }
  else if (tab === 'solicitacoes') { document.getElementById('view-solicitacoes').classList.add('active');  carregarSolicitacoes(); }
}

function switchTab(btn, tabId) {
  btn.closest('.section').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  btn.closest('.section').querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
}
