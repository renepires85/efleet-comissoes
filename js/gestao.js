// ── CARREGAR GESTÃO ───────────────────────────────────────────────────────────
async function carregarGestao() {
  const { ini, fim } = getPeriodoDates(periodoAtual);
  const { data: resumos } = await sb.from('vw_resumo_prestador').select('*')
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim))
    .order('periodo_fim', { ascending: false });

  if (!resumos || !resumos.length) {
    document.getElementById('tbody-parceiros').innerHTML = '<tr><td colspan="9" class="loading">Nenhum dado no período.</td></tr>';
    document.getElementById('g-total').textContent = 'R$ 0';
    document.getElementById('g-sub1').textContent = '—';
    document.getElementById('g-ativas').textContent = '0';
    document.getElementById('g-suspensas').textContent = 'R$ 0';
    document.getElementById('g-pendentes').textContent = '0';
    await carregarValidacoesGestao();
    await carregarSelectParceiros();
    return;
  }

  const tp = resumos.reduce((s, r) => s + parseFloat(r.comissao_total || 0), 0);
  const ts = resumos.reduce((s, r) => s + parseFloat(r.comissao_suspensa || 0), 0);
  const ta = resumos.reduce((s, r) => s + parseInt(r.clientes_ativos || 0), 0);
  const enc = resumos.reduce((s, r) => s + parseInt(r.clientes_encerrando || 0), 0);
  const inadimp = resumos.reduce((s, r) => s + parseInt(r.clientes_inadimplentes || 0), 0);

  const porParceiro = {};
  resumos.forEach(r => {
    if (!porParceiro[r.prestador_id]) porParceiro[r.prestador_id] = { id: r.prestador_id, nome: r.prestador_nome, fuel: 0, mens: 0, total: 0, susp: 0, clis: 0 };
    porParceiro[r.prestador_id].fuel  += parseFloat(r.comissao_fuel || 0);
    porParceiro[r.prestador_id].mens  += parseFloat(r.comissao_mensalidades || 0);
    porParceiro[r.prestador_id].total += parseFloat(r.comissao_total || 0);
    porParceiro[r.prestador_id].susp  += parseFloat(r.comissao_suspensa || 0);
    porParceiro[r.prestador_id].clis  += parseInt(r.clientes_ativos || 0);
  });

  document.getElementById('g-total').textContent = fmtR(tp);
  document.getElementById('g-sub1').textContent = `${Object.keys(porParceiro).length} parceiros`;
  document.getElementById('g-ativas').textContent = ta;
  document.getElementById('g-suspensas').textContent = fmtR(ts);

 const { data: valsPend } = await sb.from('validacoes_mensais').select('status').in('status', ['pendente', 'contestado']);
const nPend = (valsPend || []).filter(v => v.status === 'pendente').length;
const nCont = (valsPend || []).filter(v => v.status === 'contestado').length;
const ab = document.getElementById('g-alerts');
const al = [];
if (nPend > 0) al.push(`⏳ ${nPend} validação(ões) aguardando aprovação`);
if (nCont > 0) al.push(`✗ ${nCont} contestação(ões) pendente(s)`);
if (inadimp > 0) al.push(`⚠ ${inadimp} inadimplente(s)`);
if (enc > 0) al.push(`⚠ ${enc} encerrando`);
if (al.length > 0) { ab.style.display = 'flex'; ab.textContent = al.join(' · '); ab.style.color = nCont > 0 ? 'var(--efl-red)' : 'var(--efl-yellow)'; }
else { ab.style.display = 'none'; }

  const { data: vals } = await sb.from('validacoes_mensais').select('*').eq('status', 'pendente');
  const valsMap = {};
  (vals || []).forEach(v => {
    const diasPend = Math.floor((new Date() - new Date(v.criado_em)) / (1000 * 60 * 60 * 24));
    valsMap[v.prestador_id] = diasPend;
  });

  document.getElementById('tbody-parceiros').innerHTML = Object.entries(porParceiro).map(([pid, p]) => {
    const dias = valsMap[pid];
    const diasLabel = dias != null ? `<span class="badge ${dias > 5 ? 'badge-red' : 'badge-yellow'}">${dias}d</span>` : '<span class="td-muted">—</span>';
    return `<tr>
      <td><strong style="color:#fff;font-family:var(--efl-font-head);">${p.nome}</strong></td>
      <td class="td-mono">${p.clis}</td>
      <td class="td-green">${fmtR(p.fuel)}</td>
      <td class="td-green">${fmtR(p.mens)}</td>
      <td class="td-green">${fmtR(p.total)}</td>
      <td class="${p.susp > 0 ? 'td-yellow' : 'td-muted'}">${fmtR(p.susp)}</td>
      <td><span class="badge ${p.susp > 0 ? 'badge-yellow' : 'badge-green'}">${p.susp > 0 ? 'suspensa' : '✓ Ok'}</span></td>
      <td>${diasLabel}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm" onclick="notificarParceiro('${pid}')">📧</button>
      </td>
    </tr>`;
  }).join('');

  const ultimo = resumos[0].periodo_fim;
  await carregarTabelaClientes(ultimo);
  await carregarValidacoesGestao();
  await carregarSelectParceiros();
  document.getElementById('alertas-content').innerHTML = buildAlertasHTML(inadimp, enc);
}

// ── TABELA CLIENTES ───────────────────────────────────────────────────────────
async function carregarTabelaClientes(pFim) {
  const { data } = await sb.from('vw_extrato_prestador').select('*,prestadores(nome)').eq('periodo_fim', pFim).order('cliente_nome');
  if (!data) return;
  document.getElementById('tbody-clientes').innerHTML = data.map(c => {
    const pct = Math.round(parseFloat(c.fator_ramp) * 100);
    const cs = c.status === 'suspensa' ? `<span class="td-yellow">Suspensa</span>` : `<span class="td-green">${fmtR(c.comissao_bruta)}</span>`;
    return `<tr>
      <td><strong style="color:#fff;">${c.cliente_nome}</strong></td>
      <td class="td-mono td-muted">${c.cliente_cnpj}</td>
      <td>${c.prestadores?.nome || '—'}</td>
      <td><span class="badge ${c.produto === 'FUEL' ? 'badge-blue' : 'badge-green'}">${c.produto}</span></td>
      <td class="td-mono">${c.mes_curva}/12</td>
      <td><div class="ramp-bar"><div class="ramp-track"><div class="ramp-fill ${pct < 100 ? 'partial' : ''}" style="width:${pct}%"></div></div><div class="ramp-label">${pct}%</div></div></td>
      <td class="td-mono">${fmtR(c.base_calculo)}</td>
      <td>${cs}</td>
      <td><span class="badge ${c.status === 'calculada' ? 'badge-green' : 'badge-yellow'}">${c.status}</span></td>
    </tr>`;
  }).join('');
}

// ── VALIDAÇÕES GESTÃO ─────────────────────────────────────────────────────────
async function carregarValidacoesGestao() {
  const { data } = await sb.from('validacoes_mensais').select('*,prestadores(nome)').order('criado_em', { ascending: false });
  const pend = (data || []).filter(v => v.status === 'pendente').length;
  document.getElementById('g-pendentes').textContent = pend;
  const cont = (data || []).filter(v => v.status === 'contestado').length;
const tabBtn = document.getElementById('tab-btn-validacoes');
if (tabBtn) {
  const total = pend + cont;
  tabBtn.innerHTML = total > 0
    ? `Validações <span style="background:var(--efl-red);color:#fff;border-radius:999px;font-size:10px;font-weight:700;padding:2px 7px;margin-left:6px;">${total}</span>`
    : 'Validações';
}
  if (!data || !data.length) { document.getElementById('tbody-validacoes').innerHTML = '<tr><td colspan="8" class="loading">Nenhuma validação.</td></tr>'; return; }
  document.getElementById('tbody-validacoes').innerHTML = data.map(v => {
    const diasPend = v.status === 'pendente' ? Math.floor((new Date() - new Date(v.criado_em)) / (1000 * 60 * 60 * 24)) : null;
    const stBadge = v.status === 'aprovado' ? 'badge-green' : v.status === 'contestado' ? 'badge-red' : v.status === 'pago' ? 'badge-teal' : 'badge-yellow';
    const stLabel = v.status === 'aprovado' ? '✓ Aprovado' : v.status === 'contestado' ? '✗ Contestado' : v.status === 'pago' ? '💰 Pago' : '⏳ Pendente';
    const acoes = v.status === 'aprovado' || v.status === 'contestado'
  ? `<button class="btn btn-teal btn-sm" onclick="abrirModalPagamento('${v.id}')">💰 Pagar</button>`
  : v.status === 'pendente'
  ? `<button class="btn btn-ghost btn-sm" onclick="notificarParceiroValidacao('${v.prestador_id}')">📧 Notificar</button>`
  : '';
    return `<tr>
      <td><strong style="color:#fff;font-family:var(--efl-font-head);">${v.prestadores?.nome || '—'}</strong></td>
      <td class="td-muted">${formatPeriodo(v.periodo_inicio, v.periodo_fim)}</td>
      <td><span class="badge ${stBadge}">${stLabel}</span></td>
      <td>${diasPend != null ? `<span class="badge ${diasPend > 5 ? 'badge-red' : 'badge-yellow'}">${diasPend}d</span>` : '—'}</td>
      <td class="td-muted">${v.aprovado_em ? new Date(v.aprovado_em).toLocaleDateString('pt-BR') : '—'}</td>
      <td class="td-muted">${v.pago_em ? new Date(v.pago_em).toLocaleDateString('pt-BR') : '—'}</td>
      <td class="td-muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${v.observacao || '—'}</td>
      <td>${acoes}</td>
    </tr>`;
  }).join('');
}

// ── SELECT PARCEIROS ──────────────────────────────────────────────────────────
async function carregarSelectParceiros() {
  const { data } = await sb.from('prestadores').select('id,nome').eq('ativo', true).order('nome');
  const sel = document.getElementById('select-parceiro');
  if (!data) return;
  sel.innerHTML = '<option value="">Todos os parceiros</option>' + data.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
}

async function filtrarPorParceiro() {
  const sel = document.getElementById('select-parceiro');
  const pid = sel.value;
  const pnome = pid ? sel.options[sel.selectedIndex].text : null;
  document.getElementById('g-titulo-parceiro').textContent = pid ? `· ${pnome}` : '';
  if (pid) { await carregarExtratoParceiro(pid); }
  else { document.getElementById('extrato-parceiro-content').innerHTML = '<div class="loading">Selecione um parceiro acima</div>'; }
}

async function carregarExtratoParceiro(pid) {
  const ct = document.getElementById('extrato-parceiro-content');
  ct.innerHTML = '<div class="loading">Carregando...</div>';
  const { ini, fim } = getPeriodoDates(periodoAtual);
  const { data } = await sb.from('vw_extrato_prestador').select('*').eq('prestador_id', pid)
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim))
    .order('periodo_fim', { ascending: false });
  const { data: acum } = await sb.from('vw_acumulado_prestador').select('*').eq('prestador_id', pid).single();
  if (!data || !data.length) { ct.innerHTML = '<div class="loading">Nenhum dado no período.</div>'; return; }
  const tf = data.filter(d => d.produto === 'FUEL' && d.status === 'calculada').reduce((s, d) => s + parseFloat(d.comissao_bruta || 0), 0);
  const tm = data.filter(d => d.produto !== 'FUEL' && d.status === 'calculada').reduce((s, d) => s + parseFloat(d.comissao_bruta || 0), 0);
  ct.innerHTML = `
    <div style="padding:16px 22px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:24px;flex-wrap:wrap;">
      <div><div class="kpi-label">FUEL</div><div style="font-family:var(--efl-font-head);font-size:20px;font-weight:800;color:var(--efl-green-400);">${fmtR(tf)}</div></div>
      <div><div class="kpi-label">Mensalidades</div><div style="font-family:var(--efl-font-head);font-size:20px;font-weight:800;color:var(--efl-navy-300);">${fmtR(tm)}</div></div>
      <div><div class="kpi-label">Total período</div><div style="font-family:var(--efl-font-head);font-size:20px;font-weight:800;color:#fff;">${fmtR(tf + tm)}</div></div>
      <div><div class="kpi-label">Acumulado histórico</div><div style="font-family:var(--efl-font-head);font-size:20px;font-weight:800;color:var(--efl-yellow);">${acum ? fmtR(acum.comissao_acumulada) : '—'}</div></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Período</th><th>Cliente</th><th>Produto</th><th>Mês</th><th>Ramp</th><th>Base</th><th>Comissão</th><th>Status</th></tr></thead>
      <tbody>${data.map(c => {
        const pct = Math.round(parseFloat(c.fator_ramp) * 100);
        const cs = c.status === 'suspensa' ? `<span class="td-yellow">Suspensa</span>` : `<span class="td-green">${fmtR(c.comissao_bruta)}</span>`;
        return `<tr>
          <td class="td-muted td-mono">${formatPeriodo(c.periodo_inicio, c.periodo_fim)}</td>
          <td><strong style="color:#fff;">${c.cliente_nome}</strong></td>
          <td><span class="badge ${c.produto === 'FUEL' ? 'badge-blue' : 'badge-green'}">${c.produto}</span></td>
          <td class="td-mono">${c.mes_curva}/12</td>
          <td><div class="ramp-bar"><div class="ramp-track"><div class="ramp-fill ${pct < 100 ? 'partial' : ''}" style="width:${pct}%"></div></div><div class="ramp-label">${pct}%</div></div></td>
          <td class="td-mono">${fmtR(c.base_calculo)}</td>
          <td>${cs}</td>
          <td><span class="badge ${c.status === 'calculada' ? 'badge-green' : 'badge-yellow'}">${c.status}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

// ── ALERTAS ───────────────────────────────────────────────────────────────────
function buildAlertasHTML(inadimp, enc) {
  let h = '';
  if (inadimp > 0) h += `<div style="padding:16px;background:rgba(232,64,64,0.08);border:1px solid rgba(232,64,64,0.2);border-radius:var(--efl-r-md);margin-bottom:12px;font-size:13px;color:var(--efl-red);font-weight:600;">🔴 ${inadimp} cliente(s) inadimplente(s)</div>`;
  if (enc > 0) h += `<div style="padding:16px;background:rgba(240,192,64,0.08);border:1px solid rgba(240,192,64,0.2);border-radius:var(--efl-r-md);margin-bottom:12px;font-size:13px;color:var(--efl-yellow);font-weight:600;">⚠ ${enc} cliente(s) no mês 11</div>`;
  if (!h) h = `<div style="padding:16px;background:rgba(164,197,87,0.08);border:1px solid rgba(164,197,87,0.2);border-radius:var(--efl-r-md);font-size:13px;color:var(--efl-green-400);">✓ Nenhum alerta</div>`;
  return h;
}

// ── PAGAMENTO ─────────────────────────────────────────────────────────────────
function abrirModalPagamento(validacaoId) {
  currentPagamentoId = validacaoId;
  document.getElementById('pag-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('pag-obs').value = '';
  document.getElementById('modal-pagamento').style.display = 'flex';
}
function fecharModalPagamento() { document.getElementById('modal-pagamento').style.display = 'none'; }

async function confirmarPagamento() {
  if (!currentPagamentoId) return;
  const data = document.getElementById('pag-data').value;
  const obs  = document.getElementById('pag-obs').value;
  if (!data) { alert('Informe a data do pagamento.'); return; }
  const { error } = await sb.from('validacoes_mensais').update({
    status: 'pago',
    pago_em: new Date(data + 'T12:00:00').toISOString(),
    pago_por: currentUser.id,
    observacao: obs || null
  }).eq('id', currentPagamentoId);
  if (error) { alert('Erro: ' + error.message); return; }
  fecharModalPagamento();
  const { data: val } = await sb.from('validacoes_mensais').select('*,prestadores(nome,email)').eq('id', currentPagamentoId).single();
  if (val?.prestadores?.email) {
    await notificarEmail(val.prestador_id, formatPeriodo(val.periodo_inicio, val.periodo_fim));
  }
  await carregarValidacoesGestao();
}

// ── EXPORTAR RELATÓRIO ────────────────────────────────────────────────────────
async function exportarRelatorio() {
  const { ini, fim } = getPeriodoDates(periodoAtual);
  const { data: vals } = await sb.from('validacoes_mensais')
    .select('*,prestadores(nome,banco,agencia,conta,tipo_conta,pix,email)')
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim))
    .order('periodo_fim', { ascending: false });
  if (!vals || !vals.length) { alert('Nenhum dado no período.'); return; }
  const { data: resumos } = await sb.from('vw_resumo_prestador').select('*')
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim));
  const totMap = {};
  (resumos || []).forEach(r => {
    if (!totMap[r.prestador_id]) totMap[r.prestador_id] = 0;
    totMap[r.prestador_id] += parseFloat(r.comissao_total || 0);
  });
  const wb = XLSX.utils.book_new();
  const rows = [
    ['RELATÓRIO DE PAGAMENTO — eFleet Digital'],
    [`Período: ${new Date(fmtDate(ini)).toLocaleDateString('pt-BR')} a ${new Date(fmtDate(fim)).toLocaleDateString('pt-BR')}`],
    [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
    [],
    ['Parceiro', 'E-mail', 'Banco', 'Agência', 'Conta', 'Tipo', 'PIX', 'Status', 'Total a pagar'],
  ];
  const prestadoresVistos = new Set();
  vals.forEach(v => {
    const pid = v.prestador_id;
    if (prestadoresVistos.has(pid)) return;
    prestadoresVistos.add(pid);
    const p = v.prestadores || {};
    rows.push([p.nome || '—', p.email || '—', p.banco || '—', p.agencia || '—', p.conta || '—', p.tipo_conta || '—', p.pix || '—', v.status, totMap[pid] || 0]);
  });
  rows.push([]);
  const total = Object.values(totMap).reduce((s, v) => s + v, 0);
  rows.push(['', '', '', '', '', '', '', 'TOTAL', total]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
  XLSX.writeFile(wb, `relatorio_pagamento_${fmtDate(fim)}.xlsx`);
}
