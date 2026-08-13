// ── ALERTAS (independente de período) ─────────────────────────────────────────
// Alertas cobrem TODAS as validações em aberto, de qualquer mês — nunca podem
// ficar reféns de o período selecionado (ex: "Último mês") ter algum resumo
// calculado. Virou função própria, chamada nos dois ramos de carregarGestao,
// depois de um bug real: mês novo sem nenhum fechamento calculado ainda fazia
// vw_resumo_prestador vir vazia, batia no `return` antecipado, e pulava os
// alertas inteiros — mesmo eles não tendo nada a ver com o período do KPI.
async function carregarAlertas() {
  const { data: todasVals } = await sb.from('validacoes_mensais')
    .select('*,prestadores(nome,ativo)')
    .not('status', 'eq', 'pago')
    .order('periodo_fim', { ascending: false });

  const { data: baixados } = await sb.from('alertas_baixados').select('validacao_id,tipo');
  const baixadoSet = new Set((baixados || []).map(b => `${b.validacao_id}|${b.tipo}`));
  const estaBaixado = (id, tipo) => baixadoSet.has(`${id}|${tipo}`);

  const hoje = new Date();
  const alertas = { contestadas: [], aprovadas: [], prazoVencendo: [], pagamentoAtrasado: [] };

  (todasVals || [])
    .filter(v => v.prestadores?.ativo !== false) // vendedor/indicador inativo não gera alerta
    .forEach(v => {
      const periodoFim = new Date(v.periodo_fim + 'T12:00:00');
      const m1 = new Date(periodoFim.getFullYear(), periodoFim.getMonth() + 1, 1);
      const m2 = new Date(periodoFim.getFullYear(), periodoFim.getMonth() + 2, 1);
      const prazoPagamento = new Date(m2.getFullYear(), m2.getMonth(), 10);

      if (v.status === 'contestado') {
        if (!estaBaixado(v.id, 'contestada')) alertas.contestadas.push(v);
      } else if (v.status === 'aprovado') {
        if (hoje > prazoPagamento) {
          if (!estaBaixado(v.id, 'pagamento_atrasado')) alertas.pagamentoAtrasado.push(v);
        } else {
          if (!estaBaixado(v.id, 'aprovada_aguardando_pagamento')) alertas.aprovadas.push(v);
        }
      } else if (v.status === 'pendente') {
        const alertaA = new Date(m1.getFullYear(), m1.getMonth(), 15);
        if (hoje >= alertaA) {
          if (!estaBaixado(v.id, 'prazo_vencendo')) alertas.prazoVencendo.push(v);
        }
      }
    });

  const ab = document.getElementById('g-alerts');
  const al = [];
  if (alertas.contestadas.length > 0) al.push(`✗ ${alertas.contestadas.length} contestação(ões)`);
  if (alertas.pagamentoAtrasado.length > 0) al.push(`🚨 ${alertas.pagamentoAtrasado.length} pagamento(s) atrasado(s)`);
  if (alertas.prazoVencendo.length > 0) al.push(`⏰ ${alertas.prazoVencendo.length} prazo vencendo`);
  if (alertas.aprovadas.length > 0) al.push(`✅ ${alertas.aprovadas.length} aguardando pagamento`);

  if (al.length > 0) {
    ab.style.display = 'flex';
    ab.textContent = al.join(' · ');
    ab.style.color = (alertas.contestadas.length > 0 || alertas.pagamentoAtrasado.length > 0)
      ? 'var(--efl-red)' : 'var(--efl-yellow)';
  } else {
    ab.style.display = 'none';
  }

  const tabBtn = document.getElementById('tab-btn-alertas');
  if (tabBtn) {
    const totalBadge = alertas.contestadas.length + alertas.pagamentoAtrasado.length + alertas.prazoVencendo.length;
    tabBtn.innerHTML = totalBadge > 0
      ? `Alertas <span style="background:var(--efl-red);color:#fff;border-radius:999px;font-size:10px;font-weight:700;padding:2px 7px;margin-left:6px;">${totalBadge}</span>`
      : 'Alertas';
  }

  document.getElementById('alertas-content').innerHTML = buildAlertasHTML(alertas);
}

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
    await carregarAlertas();
    await carregarValidacoesGestao();
    await carregarSelectParceiros();
    return;
  }
 
  const tp      = resumos.reduce((s, r) => s + parseFloat(r.comissao_total || 0), 0);
  const ts      = resumos.reduce((s, r) => s + parseFloat(r.comissao_suspensa || 0), 0);
  const ta      = resumos.reduce((s, r) => s + parseInt(r.clientes_ativos || 0), 0);
  const enc     = resumos.reduce((s, r) => s + parseInt(r.clientes_encerrando || 0), 0);
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
 
  const { data: vals } = await sb.from('validacoes_mensais').select('*')
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim))
    .eq('status', 'pendente');
  const valsMap = {};
  (vals || []).forEach(v => {
    const diasPend = Math.floor((new Date() - new Date(v.criado_em)) / (1000 * 60 * 60 * 24));
    valsMap[v.prestador_id] = diasPend;
  });
 
  document.getElementById('tbody-parceiros').innerHTML = Object.entries(porParceiro).map(([pid, p]) => {
    const dias = valsMap[pid];
    const diasLabel = dias != null
      ? `<span class="badge ${dias > 5 ? 'badge-red' : 'badge-yellow'}">${dias}d</span>`
      : '<span class="td-muted">—</span>';
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
  await carregarAlertas();
  await carregarValidacoesGestao();
  await carregarSelectParceiros();
}
 
// ── TABELA CLIENTES ───────────────────────────────────────────────────────────
async function carregarTabelaClientes(pFim) {
  const { data } = await sb.from('vw_extrato_prestador').select('*,prestadores(nome,tipo_parceiro)').eq('periodo_fim', pFim).order('cliente_nome');
  if (!data) return;
  document.getElementById('tbody-clientes').innerHTML = data.map(c => {
    const pct = Math.round(parseFloat(c.fator_ramp) * 100);
    const cs = c.status === 'suspensa'
      ? `<span class="td-yellow">Suspensa</span>`
      : `<span class="td-green">${fmtR(c.comissao_bruta)}</span>`;
    const ehIndicador = c.prestadores?.tipo_parceiro === 'indicador';
    return `<tr>
      <td><strong style="color:#fff;">${c.cliente_nome}</strong></td>
      <td class="td-mono td-muted">${c.cliente_cnpj}</td>
      <td>${c.prestadores?.nome || '—'}</td>
      <td><span class="badge ${ehIndicador ? 'badge-purple' : 'badge-blue'}">${ehIndicador ? 'Indicador' : 'Vendedor'}</span></td>
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
  const { data } = await sb.from('validacoes_mensais')
    .select('*,prestadores(nome)')
    .order('criado_em', { ascending: false });
 
  const pend = (data || []).filter(v => v.status === 'pendente').length;
  document.getElementById('g-pendentes').textContent = pend;
 
  if (!data || !data.length) {
    document.getElementById('tbody-validacoes').innerHTML = '<tr><td colspan="9" class="loading">Nenhuma validação.</td></tr>';
    renderBotoesLote([], []);
    return;
  }
 
  const idsPagarDisponiveis     = data.filter(v => v.status === 'aprovado' || v.status === 'contestado').map(v => v.id);
  const idsNotificarDisponiveis = data.filter(v => v.status === 'pendente').map(v => v.id);
 
  renderBotoesLote(idsPagarDisponiveis, idsNotificarDisponiveis, data);
 
  document.getElementById('tbody-validacoes').innerHTML = data.map(v => {
    const diasPend = v.status === 'pendente'
      ? Math.floor((new Date() - new Date(v.criado_em)) / (1000 * 60 * 60 * 24))
      : null;
    const stBadge = v.status === 'aprovado'   ? 'badge-green'
                  : v.status === 'contestado' ? 'badge-red'
                  : v.status === 'pago'       ? 'badge-teal'
                  : 'badge-yellow';
    const stLabel = v.status === 'aprovado'   ? '✓ Aprovado'
                  : v.status === 'contestado' ? '✗ Contestado'
                  : v.status === 'pago'       ? '💰 Pago'
                  : '⏳ Pendente';
 
    const podePagar     = v.status === 'aprovado' || v.status === 'contestado';
    const podeNotificar = v.status === 'pendente';
 
    const checkboxCell = (podePagar || podeNotificar)
      ? `<input type="checkbox" class="val-check" data-id="${v.id}" data-acao="${podePagar ? 'pagar' : 'notificar'}" style="width:16px;height:16px;cursor:pointer;accent-color:var(--efl-green-500);">`
      : `<span class="td-muted">—</span>`;
 
    const acoes = podePagar
      ? `<button class="btn btn-teal btn-sm" onclick="abrirModalPagamento('${v.id}')">💰 Pagar</button>`
      : podeNotificar
      ? `<button class="btn btn-ghost btn-sm" onclick="notificarParceiroValidacao('${v.prestador_id}')">📧 Notificar</button>`
      : '';
 
    return `<tr>
      <td>${checkboxCell}</td>
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
 
// ── BOTÕES DE LOTE ────────────────────────────────────────────────────────────
function renderBotoesLote(idsPagar, idsNotificar, data) {
  const container = document.getElementById('validacoes-acoes-lote');
  if (!container) return;
 
  const temPagar     = idsPagar.length > 0;
  const temNotificar = idsNotificar.length > 0;
 
  if (!temPagar && !temNotificar) { container.innerHTML = ''; return; }
 
  container.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      ${temPagar ? `
        <button class="btn btn-ghost btn-sm" onclick="selecionarTodos('pagar')" style="border-color:var(--efl-teal);color:var(--efl-teal);">
          ☑ Selecionar pagáveis (${idsPagar.length})
        </button>
      ` : ''}
      ${temNotificar ? `
        <button class="btn btn-ghost btn-sm" onclick="selecionarTodos('notificar')" style="border-color:var(--efl-navy-300);color:var(--efl-navy-300);">
          ☑ Selecionar pendentes (${idsNotificar.length})
        </button>
      ` : ''}
      <button class="btn btn-ghost btn-sm" onclick="desmarcarTodos()" style="color:var(--efl-gray-400);">
        ✕ Desmarcar todos
      </button>
      <button class="btn btn-teal btn-sm" onclick="confirmarAcoesLote()" id="btn-confirmar-lote" style="display:none;">
        ✓ Confirmar selecionados
      </button>
    </div>
  `;
}
 
function selecionarTodos(acao) {
  const checks = document.querySelectorAll(`.val-check[data-acao="${acao}"]`);
  checks.forEach(c => c.checked = true);
  atualizarBotaoLote();
}
 
function desmarcarTodos() {
  document.querySelectorAll('.val-check').forEach(c => c.checked = false);
  atualizarBotaoLote();
}
 
function atualizarBotaoLote() {
  const selecionados = document.querySelectorAll('.val-check:checked').length;
  const btn = document.getElementById('btn-confirmar-lote');
  if (btn) btn.style.display = selecionados > 0 ? 'inline-flex' : 'none';
}
 
document.addEventListener('change', function(e) {
  if (e.target.classList.contains('val-check')) atualizarBotaoLote();
});
 
async function confirmarAcoesLote() {
  const checks = document.querySelectorAll('.val-check:checked');
  if (!checks.length) return;
 
  const paraPagar     = [...checks].filter(c => c.dataset.acao === 'pagar').map(c => c.dataset.id);
  const paraNotificar = [...checks].filter(c => c.dataset.acao === 'notificar').map(c => c.dataset.id);
 
  if (paraPagar.length > 0 && paraNotificar.length > 0) {
    alert('Selecione apenas pagáveis OU apenas pendentes de uma vez, não misture os dois tipos.');
    return;
  }
 
  if (paraPagar.length > 0) {
    currentPagamentoIds = paraPagar;
    currentPagamentoId  = null;
    document.getElementById('pag-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('pag-obs').value = '';
    document.getElementById('modal-pagamento').style.display = 'flex';
    return;
  }
 
  if (paraNotificar.length > 0) {
    const { data: vals } = await sb.from('validacoes_mensais')
      .select('*,prestadores(nome,email)')
      .in('id', paraNotificar);
    let ok = 0, err = 0;
    for (const v of (vals || [])) {
      if (v?.prestadores?.email) {
        try {
          await notificarEmail(v.prestador_id, formatPeriodo(v.periodo_inicio, v.periodo_fim));
          ok++;
          await new Promise(r => setTimeout(r, 500));
        } catch { err++; }
      }
    }
    alert(`Notificações enviadas: ${ok} OK${err > 0 ? `, ${err} com erro` : ''}.`);
    await carregarValidacoesGestao();
  }
}
 
// ── SELECT PARCEIROS ──────────────────────────────────────────────────────────
async function carregarSelectParceiros() {
  const { data } = await sb.from('prestadores').select('id,nome').eq('ativo', true).order('nome');
  const sel = document.getElementById('select-parceiro');
  if (!data) return;
  sel.innerHTML = '<option value="">Todos os parceiros</option>' + data.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
}
 
async function filtrarPorParceiro() {
  const sel   = document.getElementById('select-parceiro');
  const pid   = sel.value;
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
        const cs = c.status === 'suspensa'
          ? `<span class="td-yellow">Suspensa</span>`
          : `<span class="td-green">${fmtR(c.comissao_bruta)}</span>`;
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
// Alerta não é uma entidade própria — é recalculado a cada carregamento a
// partir de validacoes_mensais. "Dar baixa" não resolve o ponto em aberto na
// origem, só silencia aquele alerta específico (chave: validação + tipo) até
// a situação mudar de verdade — com justificativa obrigatória, registrada.
function linhaAlerta(v, tipo, cor) {
  const nome = (v.prestadores?.nome || '—').replace(/'/g, "\\'");
  const periodo = formatPeriodo(v.periodo_inicio, v.periodo_fim);
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.07);">
    <span style="font-size:13px;color:${cor};"><strong>${v.prestadores?.nome || '—'}</strong> — ${periodo}</span>
    <button class="btn btn-ghost btn-sm" style="flex:none;padding:2px 10px;font-size:12px;" onclick="abrirModalBaixaAlerta('${v.id}','${tipo}','${nome}','${periodo}')">Dar baixa</button>
  </div>`;
}

function blocoAlerta(icone, titulo, lista, tipo, cor, fundo, borda) {
  if (!lista.length) return '';
  return `<div style="padding:16px;background:${fundo};border:1px solid ${borda};border-radius:var(--efl-r-md);margin-bottom:12px;">
    <div style="font-size:13px;color:${cor};margin-bottom:2px;">${icone} <strong>${lista.length} ${titulo}</strong></div>
    ${lista.map(v => linhaAlerta(v, tipo, cor)).join('')}
  </div>`;
}

function buildAlertasHTML(alertas) {
  let h = '';
  h += blocoAlerta('✗', 'contestação(ões) pendente(s) — acesse a aba Validações para revisar', alertas.contestadas, 'contestada', 'var(--efl-red)', 'rgba(232,64,64,0.08)', 'rgba(232,64,64,0.2)');
  h += blocoAlerta('🚨', 'pagamento(s) atrasado(s) — prazo (dia 10) já passou', alertas.pagamentoAtrasado, 'pagamento_atrasado', 'var(--efl-red)', 'rgba(232,64,64,0.08)', 'rgba(232,64,64,0.2)');
  h += blocoAlerta('⏰', 'validação(ões) com prazo vencendo — parceiro(s) precisam aprovar até o dia 20', alertas.prazoVencendo, 'prazo_vencendo', 'var(--efl-yellow)', 'rgba(240,192,64,0.08)', 'rgba(240,192,64,0.2)');
  h += blocoAlerta('✅', 'validação(ões) aprovada(s) aguardando pagamento', alertas.aprovadas, 'aprovada_aguardando_pagamento', 'var(--efl-teal)', 'rgba(32,184,160,0.08)', 'rgba(32,184,160,0.2)');

  if (!h) h = `<div style="padding:16px;background:rgba(164,197,87,0.08);border:1px solid rgba(164,197,87,0.2);border-radius:var(--efl-r-md);font-size:13px;color:var(--efl-green-400);">✔ Nenhum alerta no momento. Tudo em dia!</div>`;
  h += `<div style="margin-top:4px;"><button class="btn btn-ghost btn-sm" onclick="toggleBaixados()" id="btn-ver-baixados">Ver alertas baixados</button><div id="lista-baixados" style="display:none;margin-top:10px;"></div></div>`;
  return h;
}

// ── DAR BAIXA EM ALERTA ────────────────────────────────────────────────────────
let baixaAlertaAtual = null;

function abrirModalBaixaAlerta(validacaoId, tipo, nomeParceiro, periodo) {
  baixaAlertaAtual = { validacaoId, tipo };
  document.getElementById('baixa-alerta-resumo').textContent = `${nomeParceiro} — ${periodo}`;
  document.getElementById('baixa-alerta-justificativa').value = '';
  document.getElementById('modal-baixa-alerta').style.display = 'flex';
}

function fecharModalBaixaAlerta() {
  document.getElementById('modal-baixa-alerta').style.display = 'none';
  baixaAlertaAtual = null;
}

async function confirmarBaixaAlerta() {
  const justificativa = document.getElementById('baixa-alerta-justificativa').value.trim();
  if (!justificativa) { alert('Descreva o motivo da baixa.'); return; }
  if (!baixaAlertaAtual) return;
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('alertas_baixados').insert({
    validacao_id: baixaAlertaAtual.validacaoId,
    tipo: baixaAlertaAtual.tipo,
    justificativa,
    baixado_por: user?.id ?? null
  });
  if (error) { alert('Erro ao dar baixa: ' + error.message); return; }
  fecharModalBaixaAlerta();
  await carregarGestao();
}

async function toggleBaixados() {
  const box = document.getElementById('lista-baixados');
  const btn = document.getElementById('btn-ver-baixados');
  if (box.style.display === 'block') { box.style.display = 'none'; btn.textContent = 'Ver alertas baixados'; return; }

  const { data } = await sb.from('alertas_baixados')
    .select('*,validacoes_mensais(periodo_inicio,periodo_fim,prestadores(nome))')
    .order('baixado_em', { ascending: false });

  const rotuloTipo = { contestada: 'Contestação', pagamento_atrasado: 'Pagamento atrasado', prazo_vencendo: 'Prazo vencendo', aprovada_aguardando_pagamento: 'Aguardando pagamento' };

  box.innerHTML = !data?.length
    ? `<div style="font-size:12.5px;color:var(--efl-gray-500);padding:8px 0;">Nenhum alerta baixado ainda.</div>`
    : data.map(b => {
        const v = b.validacoes_mensais;
        const periodo = v ? formatPeriodo(v.periodo_inicio, v.periodo_fim) : '—';
        return `<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:var(--efl-r-sm);margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">
            <span style="font-size:12.5px;color:#fff;"><strong>${v?.prestadores?.nome || '—'}</strong> · ${periodo} · <span class="td-muted">${rotuloTipo[b.tipo] || b.tipo}</span></span>
            <button class="btn btn-ghost btn-sm" style="flex:none;padding:2px 8px;font-size:11px;" onclick="reabrirAlerta('${b.id}')">Reabrir</button>
          </div>
          <div style="font-size:12px;color:var(--efl-gray-400);margin-top:4px;">"${b.justificativa}" — ${new Date(b.baixado_em).toLocaleDateString('pt-BR')}</div>
        </div>`;
      }).join('');

  box.style.display = 'block';
  btn.textContent = 'Ocultar alertas baixados';
}

async function reabrirAlerta(id) {
  if (!confirm('Reabrir este alerta? Ele volta a aparecer na lista.')) return;
  const { error } = await sb.from('alertas_baixados').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  await carregarGestao();
  await toggleBaixados(); // fecha; reabre ao clicar de novo, já com dado fresco
}
 
// ── PAGAMENTO ─────────────────────────────────────────────────────────────────
let currentPagamentoIds = [];
 
function abrirModalPagamento(validacaoId) {
  currentPagamentoId  = validacaoId;
  currentPagamentoIds = [];
  document.getElementById('pag-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('pag-obs').value = '';
  document.getElementById('modal-pagamento').style.display = 'flex';
}
 
function fecharModalPagamento() {
  document.getElementById('modal-pagamento').style.display = 'none';
  currentPagamentoId  = null;
  currentPagamentoIds = [];
}
 
async function confirmarPagamento() {
  const data = document.getElementById('pag-data').value;
  const obs  = document.getElementById('pag-obs').value;
  if (!data) { alert('Informe a data do pagamento.'); return; }
 
  const ids = currentPagamentoIds.length > 0 ? currentPagamentoIds : (currentPagamentoId ? [currentPagamentoId] : []);
  if (!ids.length) return;
 
  const pagoEm = new Date(data + 'T12:00:00').toISOString();
  let erros = 0;
 
  for (const id of ids) {
    const { data: updated, error } = await sb.from('validacoes_mensais').update({
      status: 'pago',
      pago_em: pagoEm,
      pago_por: currentUser.id,
      observacao: obs || null
    }).eq('id', id).select();
 
    if (error) { console.error('Erro ao pagar id', id, error); erros++; continue; }
    if (!updated || updated.length === 0) { console.warn('Update não afetou nenhuma linha para id', id); erros++; continue; }
 
    const { data: val } = await sb.from('validacoes_mensais')
      .select('*,prestadores(nome,email)')
      .eq('id', id).single();
 
    if (val?.prestadores?.email) {
      const emailPromise = notificarEmail(val.prestador_id, formatPeriodo(val.periodo_inicio, val.periodo_fim));
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
      await Promise.race([emailPromise, timeout]).catch(e => {
        console.warn('Notificacao falhou ou timeout:', e);
      });
    }
  }
 
  fecharModalPagamento();
  const total = ids.length - erros;
  if (total === 1) {
    alert('Pagamento registrado com sucesso!');
  } else if (total > 1) {
    alert(`${total} pagamentos registrados com sucesso!`);
  }
  if (erros > 0) alert(`${erros} pagamento(s) nao foram processados.`);
  await carregarValidacoesGestao();
}
 
// ── EXPORTAR RELATÓRIO ────────────────────────────────────────────────────────
async function exportarRelatorio() {
  const { ini, fim } = getPeriodoDates(periodoAtual);
  const { data: vals } = await sb.from('validacoes_mensais')
    .select('*,prestadores(nome,banco,agencia,conta,tipo_conta,pix,email)')
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim))
    .order('periodo_fim', { ascending: false });
  if (!vals || !vals.length) { alert('Nenhum dado no periodo.'); return; }
  const { data: resumos } = await sb.from('vw_resumo_prestador').select('*')
    .gte('periodo_fim', fmtDate(ini)).lte('periodo_fim', fmtDate(fim));
  const totMap = {};
  (resumos || []).forEach(r => {
    if (!totMap[r.prestador_id]) totMap[r.prestador_id] = 0;
    totMap[r.prestador_id] += parseFloat(r.comissao_total || 0);
  });
  const wb = XLSX.utils.book_new();
  const rows = [
    ['RELATORIO DE PAGAMENTO - eFleet Digital'],
    [`Periodo: ${new Date(fmtDate(ini)).toLocaleDateString('pt-BR')} a ${new Date(fmtDate(fim)).toLocaleDateString('pt-BR')}`],
    [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
    [],
    ['Parceiro', 'E-mail', 'Banco', 'Agencia', 'Conta', 'Tipo', 'PIX', 'Status', 'Total a pagar'],
  ];
  const prestadoresVistos = new Set();
  vals.forEach(v => {
    const pid = v.prestador_id;
    if (prestadoresVistos.has(pid)) return;
    prestadoresVistos.add(pid);
    const p = v.prestadores || {};
    rows.push([p.nome || '-', p.email || '-', p.banco || '-', p.agencia || '-', p.conta || '-', p.tipo_conta || '-', p.pix || '-', v.status, totMap[pid] || 0]);
  });
  rows.push([]);
  const total = Object.values(totMap).reduce((s, v) => s + v, 0);
  rows.push(['', '', '', '', '', '', '', 'TOTAL', total]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  XLSX.writeFile(wb, `relatorio_pagamento_${fmtDate(fim)}.xlsx`);
}
