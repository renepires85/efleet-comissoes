// ── ESTADO ────────────────────────────────────────────────────────────────────
let vendedorPeriodoAtual = 'mes-atual';
let vendedorPeriodoCustomIni = null;
let vendedorPeriodoCustomFim = null;
let graficoPeriodo = 6; // meses para os gráficos
 
// ── CARREGAR VENDEDOR ─────────────────────────────────────────────────────────
async function carregarVendedor(pid, nome) {
  document.getElementById('v-nome').textContent = nome;
  renderSeletorPeriodoVendedor();
  await carregarPendencias(pid);
  await carregarPrevia(pid);
  await carregarExtratoPeriodo(pid);
  await carregarGraficos(pid);
}

// ── PENDÊNCIAS DE APROVAÇÃO (qualquer período) ────────────────────────────────
// O card de validação abaixo é filtrado pelo período selecionado, e o parceiro
// entra sempre no mês atual. Uma comissão de mês anterior esperando aprovação
// ficava invisível até ele pensar em navegar até lá — e ninguém navega atrás de
// algo que não sabe que existe. Este aviso busca as pendentes SEM filtro de
// período e leva direto ao mês certo.
async function carregarPendencias(pid) {
  const alvo = document.getElementById('alerta-pendencias');
  const { data } = await sb.from('validacoes_mensais')
    .select('id,periodo_inicio,periodo_fim,status')
    .eq('prestador_id', pid)
    .eq('status', 'pendente')
    .order('periodo_fim', { ascending: false });

  if (!data || !data.length) { alvo.innerHTML = ''; return; }

  const hojeIni = new Date(); hojeIni.setDate(1);
  const mesAtual = hojeIni.toISOString().slice(0, 7);

  const itens = data.map(v => {
    const rotulo = formatPeriodo(v.periodo_inicio, v.periodo_fim);
    // Se a pendência é do mês anterior ao atual, o botão "Mês anterior" resolve;
    // qualquer outra exige período personalizado.
    const ehMesAnterior = (() => {
      const d = new Date(mesAtual + '-01T12:00:00'); d.setMonth(d.getMonth() - 1);
      return v.periodo_inicio.slice(0, 7) === d.toISOString().slice(0, 7);
    })();
    const acao = ehMesAnterior
      ? `setPeriodoVendedor('mes-anterior')`
      : `irParaPeriodo('${v.periodo_inicio}','${v.periodo_fim}')`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;">
      <div style="font-size:13.5px;color:var(--efl-gray-300);">
        Comissão de <strong style="color:#fff;">${rotulo}</strong> aguardando sua aprovação
      </div>
      <button class="btn btn-primary btn-sm" onclick="${acao}">Ver e aprovar →</button>
    </div>`;
  }).join('<div style="height:1px;background:rgba(255,255,255,0.06);"></div>');

  alvo.innerHTML = `
    <div class="section alerta-aprovacao">
      <div class="section-header">
        <div>
          <div class="section-title">⚠️ ${data.length === 1 ? 'Você tem 1 comissão' : `Você tem ${data.length} comissões`} para aprovar</div>
          <div class="section-sub">Enquanto não aprovar, o pagamento não avança</div>
        </div>
        <span class="badge badge-red">${data.length}</span>
      </div>
      <div style="padding:6px 22px 14px;">${itens}</div>
    </div>`;
}

// Leva o extrato a um período específico (usado pelos avisos de pendência).
// O período personalizado é guiado pelas globais vendedorPeriodoCustom*, no
// formato YYYY-MM — os selects são só o reflexo delas.
async function irParaPeriodo(ini, fim) {
  vendedorPeriodoAtual   = 'custom';
  vendedorPeriodoCustomIni = ini.slice(0, 7);
  vendedorPeriodoCustomFim = fim.slice(0, 7);
  renderSeletorPeriodoVendedor();
  await carregarExtratoPeriodo(currentPrestadorId);
  document.getElementById('validacao-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── PRÉVIA DO MÊS ─────────────────────────────────────────────────────────────
// Alimentada diariamente pela Edge Function previa-comissoes (Metabase →
// Postgres). É estimativa do mês em andamento: muda com novas transações e
// não inclui, no validado, cliente bloqueado/inadimplente/cancelado.
async function carregarPrevia(pid) {
  const secao = document.getElementById('secao-previa');
  const { data } = await sb.from('previa_comissoes')
    .select('*')
    .eq('prestador_id', pid)
    .order('comissao_prevista', { ascending: false });

  if (!data || !data.length) { secao.style.display = 'none'; return; }

  const total     = data.reduce((s, r) => s + parseFloat(r.comissao_prevista || 0), 0);
  const bloqueado = data.filter(r => r.bloqueada).reduce((s, r) => s + parseFloat(r.comissao_prevista || 0), 0);
  const validado  = total - bloqueado;
  const qtdBloq   = data.filter(r => r.bloqueada).length;

  const ini = new Date(data[0].periodo_inicio + 'T12:00:00');
  document.getElementById('previa-mes').textContent =
    ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  document.getElementById('previa-atualizado').textContent =
    'Atualizado em ' + new Date(data[0].atualizado_em).toLocaleString('pt-BR');

  document.getElementById('previa-total').textContent     = fmtR(total);
  document.getElementById('previa-validado').textContent  = fmtR(validado);
  document.getElementById('previa-bloqueado').textContent = fmtR(bloqueado);
  document.getElementById('previa-bloqueado-sub').textContent =
    qtdBloq === 0 ? 'nenhum cliente com pendência'
                  : `${qtdBloq} linha(s) — não entra no validado`;

  // Guarda as linhas para a ficha do cliente montar sem ir ao banco de novo.
  previaLinhas = data;

  document.getElementById('tbody-previa').innerHTML = data.map(r => {
    const pct = r.fator_ramp != null ? Math.round(parseFloat(r.fator_ramp) * 100) : null;
    return `<tr${r.bloqueada ? ' style="opacity:.65;"' : ''}>
      <td><button class="link-cliente" onclick="abrirFichaCliente('${r.cliente_cnpj}')">${r.cliente_nome}</button></td>
      <td><span class="badge ${r.produto === 'FUEL' ? 'badge-blue' : 'badge-green'}">${r.produto}</span></td>
      <td class="td-mono">${r.mes_curva != null ? `${r.mes_curva}/12${pct != null ? ` · ${pct}%` : ''}` : '—'}</td>
      <td class="td-mono">${fmtR(r.base_calculo)}</td>
      <td class="${r.bloqueada ? 'td-yellow' : 'td-green'}">${fmtR(r.comissao_prevista)}</td>
      <td>${r.bloqueada
        ? `<span class="badge badge-yellow">${r.status_cliente || 'Pendência'}</span>`
        : `<span class="badge badge-green">Regular</span>`}</td>
    </tr>`;
  }).join('');

  secao.style.display = 'block';
  aplicarEstadoPrevia();
}

// Recolher a lista de clientes. O cabeçalho, o aviso de que é prévia e as três
// caixas de valor ficam sempre visíveis — são o resumo; a lista é o detalhe.
// Começa FECHADA: quem abre a tela quer o número do mês, não a lista linha a
// linha; quem quer o detalhe pede.
let previaAberta = false;

function aplicarEstadoPrevia() {
  document.getElementById('previa-lista').style.display = previaAberta ? '' : 'none';
  document.getElementById('previa-toggle-sinal').textContent = previaAberta ? '−' : '+';
  document.getElementById('previa-toggle-txt').textContent   =
    previaAberta ? 'Ocultar clientes' : `Ver clientes (${previaLinhas.length})`;
  document.getElementById('btn-previa-toggle').setAttribute('aria-expanded', String(previaAberta));
}

function togglePreviaLista() {
  previaAberta = !previaAberta;
  aplicarEstadoPrevia();
}

// ── FICHA DO CLIENTE ──────────────────────────────────────────────────────────
// Um cliente pode ter várias linhas na prévia (uma por produto), então a ficha
// junta todas: TPV e receita vêm do FUEL, mensalidades somam PASS/FINES/PREMIUM,
// e o percentual é mostrado por produto, porque cada um tem taxa e rampa própria.
// Três telas alimentam a ficha, com formatos ligeiramente diferentes:
//   previa   → previa_comissoes (comissao_prevista, bloqueada, status_cliente)
//   extrato  → vw_extrato_prestador (comissao_bruta, status)
//   gestao   → a mesma view, na tabela por cliente
// A ficha normaliza os dois formatos num só, para não existir em duplicata.
let previaLinhas = [];
let extratoLinhas = [];

function normalizarLinha(r) {
  return {
    cliente_cnpj: r.cliente_cnpj, cliente_nome: r.cliente_nome, produto: r.produto,
    data_ativacao: r.data_ativacao, tpv: r.tpv, base_calculo: r.base_calculo,
    taxa_comissao: r.taxa_comissao, fator_ramp: r.fator_ramp, mes_curva: r.mes_curva,
    valor: parseFloat(r.comissao_prevista ?? r.comissao_bruta ?? 0),
    // Na prévia a pendência vem em `bloqueada`; na comissão fechada, em `status`.
    pendente: r.bloqueada === true || r.status === 'suspensa',
    rotuloSituacao: r.status_cliente
      || (r.status === 'suspensa' ? 'Suspensa'
        : r.status === 'zerada'   ? 'Zerada' : null),
    zerada: r.status === 'zerada'
  };
}

function abrirFichaCliente(cnpj, origem = 'previa') {
  const fonte  = origem === 'previa' ? previaLinhas : extratoLinhas;
  const linhas = fonte.filter(r => r.cliente_cnpj === cnpj).map(normalizarLinha);
  if (!linhas.length) return;

  const fuel  = linhas.find(r => r.produto === 'FUEL');
  const mens  = linhas.filter(r => r.produto !== 'FUEL');
  const total = linhas.reduce((s, r) => s + r.valor, 0);
  const dt    = d => d ? new Date(String(d).slice(0,10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

  document.getElementById('fc-nome').textContent = linhas[0].cliente_nome;
  document.getElementById('fc-cnpj').textContent = 'CNPJ ' + fmtCnpj(cnpj);

  const linha = (rotulo, valor, dica) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:13px;color:var(--efl-gray-400);">${rotulo}${dica ? `<div style="font-size:11.5px;color:var(--efl-gray-500);margin-top:2px;">${dica}</div>` : ''}</div>
      <div style="font-size:14.5px;color:#fff;font-weight:600;text-align:right;white-space:nowrap;">${valor}</div>
    </div>`;

  const pctDe = r => `${(parseFloat(r.taxa_comissao) * (r.fator_ramp != null ? parseFloat(r.fator_ramp) : 1) * 100).toFixed(2).replace('.', ',')}%`;

  let html = '';
  if (fuel) {
    html += linha('1ª transação', dt(fuel.data_ativacao));
    if (fuel.tpv != null) html += linha('TPV do mês', fmtR(fuel.tpv), 'volume transacionado pelo cliente');
    html += linha('Receita FUEL', fmtR(fuel.base_calculo), 'base do cálculo da comissão');
    // "mês 40 de 12" não quer dizer nada. Passado o 12º mês o cliente saiu da
    // janela da Curva C, e é isso que precisa ser dito.
    const m = fuel.mes_curva;
    html += linha('% aplicado no FUEL', pctDe(fuel),
      m == null ? ''
        : m > 12 ? `mês ${m} — fora da janela de 12 meses`
        : `mês ${m} de 12 · rampa ${Math.round(parseFloat(fuel.fator_ramp) * 100)}%`);
  }
  if (mens.length) {
    const primeira = mens.map(r => r.data_ativacao).filter(Boolean).sort()[0];
    const somaMens = mens.reduce((s, r) => s + parseFloat(r.base_calculo || 0), 0);
    if (primeira) html += linha('1ª mensalidade', dt(primeira));
    html += linha('Mensalidades no mês', fmtR(somaMens),
      mens.map(r => `${r.produto} ${fmtR(r.base_calculo)} a ${pctDe(r)}`).join(' · '));
  }

  const l0 = linhas[0];
  html += linha('Situação', l0.pendente
    ? `<span class="badge badge-yellow">${l0.rotuloSituacao || 'Pendência'}</span>`
    : l0.zerada
      ? '<span class="badge">Zerada</span>'
      : '<span class="badge badge-green">Regular</span>');

  const ehPrevia = origem === 'previa';
  html += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 0 4px;">
      <div style="font-size:13px;color:var(--efl-gray-300);font-weight:600;">${ehPrevia ? 'Prévia deste cliente' : 'Comissão deste cliente'}</div>
      <div style="font-size:20px;font-weight:800;color:var(--efl-green-400);">${fmtR(total)}</div>
    </div>`;
  if (ehPrevia) {
    html += `<div style="font-size:11.5px;color:var(--efl-gray-500);padding-top:6px;">Valor estimado — muda conforme novas transações entram.</div>`;
  }

  document.getElementById('fc-corpo').innerHTML = html;
  document.getElementById('modal-cliente').style.display = 'flex';
}

function fecharFichaCliente() {
  document.getElementById('modal-cliente').style.display = 'none';
}

// CNPJ (14) ou CPF (11); qualquer outro tamanho volta como veio — a origem tem
// casos como o CNPJ com zero extra do cadastro recriado após churn.
function fmtCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return v;
}
 
// ── SELETOR DE PERÍODO ────────────────────────────────────────────────────────
function renderSeletorPeriodoVendedor() {
  const container = document.getElementById('v-periodo-seletor');
  if (!container) return;
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual - 1, anoAtual, anoAtual + 1];
  const selMes = (id, val) => `<select id="${id}-mes" class="input" style="padding:6px 10px;font-size:13px;" onchange="atualizarCustomVendedor()">
    ${meses.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}" ${val === String(i+1).padStart(2,'0') ? 'selected' : ''}>${m}</option>`).join('')}
  </select>`;
  const selAno = (id, val) => `<select id="${id}-ano" class="input" style="padding:6px 10px;font-size:13px;" onchange="atualizarCustomVendedor()">
    ${anos.map(a => `<option value="${a}" ${val === String(a) ? 'selected' : ''}>${a}</option>`).join('')}
  </select>`;
  const iniMes = vendedorPeriodoCustomIni?.split('-')[1] || String(new Date().getMonth()).padStart(2,'0') || '01';
  const iniAno = vendedorPeriodoCustomIni?.split('-')[0] || String(new Date().getFullYear());
  const fimMes = vendedorPeriodoCustomFim?.split('-')[1] || String(new Date().getMonth() + 1).padStart(2,'0');
  const fimAno = vendedorPeriodoCustomFim?.split('-')[0] || String(new Date().getFullYear());
  container.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      <button class="btn btn-sm ${vendedorPeriodoAtual === 'mes-atual' ? 'btn-primary' : 'btn-ghost'}" onclick="setPeriodoVendedor('mes-atual')">Mês atual</button>
      <button class="btn btn-sm ${vendedorPeriodoAtual === 'mes-anterior' ? 'btn-primary' : 'btn-ghost'}" onclick="setPeriodoVendedor('mes-anterior')">Mês anterior</button>
      <button class="btn btn-sm ${vendedorPeriodoAtual === 'ultimos-3' ? 'btn-primary' : 'btn-ghost'}" onclick="setPeriodoVendedor('ultimos-3')">Últimos 3 meses</button>
      <button class="btn btn-sm ${vendedorPeriodoAtual === 'custom' ? 'btn-primary' : 'btn-ghost'}" onclick="setPeriodoVendedor('custom')">Personalizado</button>
      ${vendedorPeriodoAtual === 'custom' ? `
        ${selMes('v-custom-ini', iniMes)} ${selAno('v-custom-ini', iniAno)}
        <span style="color:var(--efl-gray-400);font-size:13px;">até</span>
        ${selMes('v-custom-fim', fimMes)} ${selAno('v-custom-fim', fimAno)}
      ` : ''}
    </div>
  `;
}
async function setPeriodoVendedor(periodo) {
  vendedorPeriodoAtual = periodo;
  renderSeletorPeriodoVendedor();
  if (periodo !== 'custom') {
    await carregarExtratoPeriodo(currentPrestadorId);
  }
}

async function atualizarCustomVendedor() {
  const iniMes = document.getElementById('v-custom-ini-mes')?.value;
  const iniAno = document.getElementById('v-custom-ini-ano')?.value;
  const fimMes = document.getElementById('v-custom-fim-mes')?.value;
  const fimAno = document.getElementById('v-custom-fim-ano')?.value;
  if (iniMes && iniAno) vendedorPeriodoCustomIni = `${iniAno}-${iniMes}`;
  if (fimMes && fimAno) vendedorPeriodoCustomFim = `${fimAno}-${fimMes}`;
  if (vendedorPeriodoCustomIni && vendedorPeriodoCustomFim) {
    await carregarExtratoPeriodo(currentPrestadorId);
  }
}
function getVendedorDates() {
  const hoje = new Date();
  let ini, fim;
  if (vendedorPeriodoAtual === 'mes-atual') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  } else if (vendedorPeriodoAtual === 'mes-anterior') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  } else if (vendedorPeriodoAtual === 'ultimos-3') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  } else if (vendedorPeriodoAtual === 'custom' && vendedorPeriodoCustomIni && vendedorPeriodoCustomFim) {
    // 'T12:00:00' é obrigatório: new Date('2026-06-01') é lido como meia-noite
    // UTC, mas getMonth()/getFullYear() devolvem valor LOCAL — em UTC-3 isso
    // vira 31/05 21h e o período inteiro escorrega um mês para trás. As outras
    // opções usam new Date(ano, mês, dia), que já é local e não sofre disso.
    ini = new Date(vendedorPeriodoCustomIni + '-01T12:00:00');
    fim = new Date(vendedorPeriodoCustomFim + '-01T12:00:00');
    fim = new Date(fim.getFullYear(), fim.getMonth() + 1, 0);
  } else {
    ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  }
  return { ini, fim };
}
 
// ── EXTRATO POR PERÍODO ───────────────────────────────────────────────────────
async function carregarExtratoPeriodo(pid) {
  const { ini, fim } = getVendedorDates();
  const fmtIni = fmtDate(ini);
  const fmtFim = fmtDate(fim);
 
  const { data: ext } = await sb.from('vw_extrato_prestador').select('*')
    .eq('prestador_id', pid)
    .gte('periodo_fim', fmtIni)
    .lte('periodo_fim', fmtFim)
    .order('periodo_fim', { ascending: false });
 
  const { data: acum } = await sb.from('vw_acumulado_prestador').select('*').eq('prestador_id', pid).single();
  const { data: vals } = await sb.from('validacoes_mensais').select('*')
    .eq('prestador_id', pid)
    .gte('periodo_fim', fmtIni)
    .lte('periodo_fim', fmtFim)
    .order('criado_em', { ascending: false });
 
  if (!ext || !ext.length) {
    document.getElementById('v-periodo').textContent = '—';
    document.getElementById('tbody-vendedor').innerHTML = '<tr><td colspan="7" class="loading">Nenhum dado no período.</td></tr>';
    document.getElementById('v-total').textContent = 'R$ 0';
    document.getElementById('v-fuel').textContent  = 'R$ 0';
    document.getElementById('v-mens').textContent  = 'R$ 0';
    document.getElementById('v-acum').textContent  = acum ? fmtR(acum.comissao_acumulada) : '—';
    // Sem esta limpeza, o card e os botões continuavam com o estado do período
    // anterior — a tela dizia "Comissões de julho prontas para validação"
    // enquanto exibia um período vazio de outro mês.
    document.getElementById('validacao-card').style.display = 'none';
    document.getElementById('btn-aprovar').style.display    = 'none';
    document.getElementById('btn-contestar').style.display  = 'none';
    document.getElementById('v-validacao-badge').textContent = '—';
    document.getElementById('v-validacao-badge').className   = 'badge';
    currentValidacaoId = null;
    return;
  }
 
  const ult  = ext[0].periodo_fim;
  const periodoLabel = vendedorPeriodoAtual === 'mes-atual' || vendedorPeriodoAtual === 'mes-anterior'
    ? formatPeriodo(ext[ext.length - 1].periodo_inicio, ult)
    : `${new Date(fmtIni + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })} – ${new Date(fmtFim + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`;
 
  document.getElementById('v-periodo').textContent = periodoLabel;
 
  const tf = ext.filter(e => e.produto === 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
  const tm = ext.filter(e => e.produto !== 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
 
  document.getElementById('v-total').textContent = fmtR(tf + tm);
  document.getElementById('v-fuel').textContent  = fmtR(tf);
  document.getElementById('v-mens').textContent  = fmtR(tm);
  document.getElementById('v-acum').textContent  = acum ? fmtR(acum.comissao_acumulada) : '—';
 
  const clis = new Set(ext.filter(e => e.status === 'calculada').map(e => e.cliente_cnpj)).size;
  document.getElementById('v-clientes-badge').textContent = `${clis} clientes ativos`;
 
  // Validação — usa a mais recente do período
  const vm   = vals?.[0];
  const card = document.getElementById('validacao-card');
  const btnA = document.getElementById('btn-aprovar');
  const btnC = document.getElementById('btn-contestar');
  const periodoValidacao = vm ? formatPeriodo(vm.periodo_inicio, vm.periodo_fim) : '—';
  const totalPeriodo = ext.filter(e => e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);

  if (vm) {
    currentValidacaoId = vm.id;
    card.style.display = 'block';
    card.className = `validacao-card ${vm.status}`;
    if (vm.status === 'pendente') {
      document.getElementById('vc-titulo').textContent = `⏳ Comissões de ${periodoValidacao} prontas para validação`;
      // Bug #4 — alerta de urgência
      document.getElementById('vc-sub').innerHTML = '⚠️ <strong>Ação necessária:</strong> Confira o detalhamento abaixo e aprove ou conteste os valores até o dia 20.';
      document.getElementById('v-validacao-badge').textContent = '⏳ Aguardando aprovação';
      document.getElementById('v-validacao-badge').className   = 'badge badge-yellow';
      btnA.style.display = 'inline-flex'; btnC.style.display = 'inline-flex';
    } else if (vm.status === 'aprovado') {
      document.getElementById('vc-titulo').textContent = '✓ Comissões aprovadas';
      document.getElementById('vc-sub').textContent   = `Aprovado em ${new Date(vm.aprovado_em).toLocaleDateString('pt-BR')}. Pagamento no próximo mês.`;
      document.getElementById('v-validacao-badge').textContent = '✓ Aprovado';
      document.getElementById('v-validacao-badge').className   = 'badge badge-green';
      btnA.style.display = 'none'; btnC.style.display = 'none';
    } else if (vm.status === 'contestado') {
      document.getElementById('vc-titulo').textContent = '✗ Comissões contestadas';
      document.getElementById('vc-sub').textContent   = vm.observacao || 'Aguardando revisão.';
      document.getElementById('v-validacao-badge').textContent = '✗ Contestado';
      document.getElementById('v-validacao-badge').className   = 'badge badge-red';
      btnA.style.display = 'none'; btnC.style.display = 'none';
    } else if (vm.status === 'pago') {
      document.getElementById('vc-titulo').textContent = '💰 Comissão paga';
      document.getElementById('vc-sub').textContent   = `Pago em ${new Date(vm.pago_em).toLocaleDateString('pt-BR')}.`;
      document.getElementById('v-validacao-badge').textContent = '💰 Pago';
      document.getElementById('v-validacao-badge').className   = 'badge badge-teal';
      btnA.style.display = 'none'; btnC.style.display = 'none';
    }
  } else {
    card.style.display = 'none'; btnA.style.display = 'none'; btnC.style.display = 'none';
  }

  extratoLinhas = ext;
  document.getElementById('tbody-vendedor').innerHTML = ext.map(c => {
    const pct = Math.round(parseFloat(c.fator_ramp) * 100);
    // Bug #1 — badge de suspensão com motivo
    const cs = c.status === 'suspensa'
  ? `<span class="td-yellow">Suspensa</span><span class="badge badge-yellow" style="margin-left:6px;font-size:10px;">Cliente inadimplente</span>`
  : c.status === 'zerada'
  ? `<span class="td-muted">R$ 0,00</span><span class="badge badge-red" style="margin-left:6px;font-size:10px;">Cliente em churn</span>`
  : `<span class="td-green">${fmtR(c.comissao_bruta)}</span>`;
    const enc = c.mes_curva >= 11 ? `<span class="badge badge-yellow" style="margin-left:4px;font-size:10px;cursor:pointer;position:relative;" onclick="toggleTooltip(this)">⚠<span style="display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1a2535;color:#fff;font-size:11px;font-weight:400;padding:8px 12px;border-radius:6px;white-space:nowrap;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);">⏳ Cliente encerrando em breve.<br>Janela de comissão termina no mês 12.</span></span>` : '';
    return `<tr>
      <td><button class="link-cliente" onclick="abrirFichaCliente('${c.cliente_cnpj}','extrato')">${c.cliente_nome}</button></td>
      <td><span class="badge ${c.produto === 'FUEL' ? 'badge-blue' : 'badge-green'}">${c.produto}</span></td>
      <td class="td-mono">${c.mes_curva}/12 ${enc}</td>
      <td><div class="ramp-bar"><div class="ramp-track"><div class="ramp-fill ${pct < 100 ? 'partial' : ''}" style="width:${pct}%"></div></div><div class="ramp-label">${pct}%</div></div></td>
      <td><span class="badge ${c.status === 'calculada' ? 'badge-green' : c.status === 'zerada' ? 'badge-red' : 'badge-yellow'}">${c.status}</span></td>
      <td>${cs}</td>
    </tr>`;
  }).join('');
}

// ── GRÁFICOS ──────────────────────────────────────────────────────────────────
async function carregarGraficos(pid) {
  const container = document.getElementById('v-graficos');
  if (!container) return;
 
  const hoje = new Date();
  const iniGrafico = new Date(hoje.getFullYear(), hoje.getMonth() - (graficoPeriodo - 1), 1);
  const fimGrafico = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
 
  const { data: ext } = await sb.from('vw_extrato_prestador').select('*')
    .eq('prestador_id', pid)
    .gte('periodo_fim', fmtDate(iniGrafico))
    .lte('periodo_fim', fmtDate(fimGrafico))
    .order('periodo_fim', { ascending: true });
 
  if (!ext || !ext.length) { container.innerHTML = '<div class="loading">Sem dados para os gráficos.</div>'; return; }
 
  const porMes = {};
  ext.forEach(e => {
    const key = e.periodo_fim.substring(0, 7);
    if (!porMes[key]) porMes[key] = { total: 0, FUEL: 0, PASS: 0, FINES: 0, PREMIUM: 0 };
    if (e.status === 'calculada') {
      const val = parseFloat(e.comissao_bruta || 0);
      porMes[key].total += val;
      if (['FUEL', 'PASS', 'FINES', 'PREMIUM'].includes(e.produto)) {
        porMes[key][e.produto] += val;
      }
    }
  });
 
  const meses   = Object.keys(porMes).sort();
  const totais  = meses.map(m => porMes[m].total);
  const labels  = meses.map(m => {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  });
 
  const prodTotais = { FUEL: 0, PASS: 0, FINES: 0, PREMIUM: 0 };
  meses.forEach(m => {
    Object.keys(prodTotais).forEach(p => { prodTotais[p] += porMes[m][p]; });
  });
 
  const maxVal = Math.max(...totais, 1);
  const cores  = { FUEL: '#4a7fc8', PASS: '#A4C557', FINES: '#F0C040', PREMIUM: '#8060D0' };
 
  const W = 500, H = 180, pad = 40;
  const pts = totais.map((v, i) => {
    const x = pad + (i / Math.max(meses.length - 1, 1)) * (W - pad * 2);
    const y = H - pad - (v / maxVal) * (H - pad * 2);
    return { x, y, v };
  });
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${pts[pts.length-1].x} ${H - pad} L ${pts[0].x} ${H - pad} Z`;
 
  const svgLinha = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;">
    <defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#A4C557" stop-opacity="0.3"/><stop offset="100%" stop-color="#A4C557" stop-opacity="0"/></linearGradient></defs>
    ${[0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = H - pad - f * (H - pad * 2);
      return `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
              <text x="${pad - 6}" y="${y + 4}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="end">${fmtR(maxVal * f).replace('R$\u00a0', '')}</text>`;
    }).join('')}
    <path d="${areaD}" fill="url(#grad)"/>
    <path d="${pathD}" fill="none" stroke="#A4C557" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `
      <circle cx="${p.x}" cy="${p.y}" r="4" fill="#A4C557" stroke="#0B1929" stroke-width="2"/>
      <text x="${p.x}" y="${H - 8}" font-size="9" fill="rgba(255,255,255,0.5)" text-anchor="middle">${labels[i]}</text>
    `).join('')}
  </svg>`;
 
  const prodAtivos = Object.entries(prodTotais).filter(([, v]) => v > 0);
  const totalPizza = prodAtivos.reduce((s, [, v]) => s + v, 0);
  let angulo = -Math.PI / 2;
  const cx = 80, cy = 80, r = 65;
  const slices = prodAtivos.map(([prod, val]) => {
    const frac  = val / totalPizza;
    const start = angulo;
    angulo += frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(angulo);
    const y2 = cy + r * Math.sin(angulo);
    const large = frac > 0.5 ? 1 : 0;
    return { prod, val, frac, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, mid: start + frac * Math.PI };
  });
 
  const svgPizza = `<svg viewBox="0 0 260 160" style="width:100%;max-width:260px;">
    ${slices.map(s => `<path d="${s.path}" fill="${cores[s.prod]}" stroke="#0B1929" stroke-width="2" opacity="0.9"/>`).join('')}
    ${slices.map((s, i) => `
      <rect x="170" y="${12 + i * 22}" width="12" height="12" rx="3" fill="${cores[s.prod]}"/>
      <text x="188" y="${22 + i * 22}" font-size="11" fill="rgba(255,255,255,0.8)">${s.prod}</text>
      <text x="250" y="${22 + i * 22}" font-size="11" fill="rgba(255,255,255,0.5)" text-anchor="end">${Math.round(s.frac * 100)}%</text>
    `).join('')}
  </svg>`;
 
  container.innerHTML = `
    <div style="margin-bottom:16px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:12px;color:var(--efl-gray-400);">Período dos gráficos:</span>
      ${[3, 6, 12].map(n => `<button class="btn btn-sm ${graficoPeriodo === n ? 'btn-primary' : 'btn-ghost'}" onclick="setGraficoPeriodo(${n})">${n} meses</button>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;flex-wrap:wrap;">
      <div>
        <div style="font-size:12px;color:var(--efl-gray-400);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">Evolução mensal</div>
        ${svgLinha}
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="font-size:12px;color:var(--efl-gray-400);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;align-self:flex-start;">Distribuição por produto</div>
        ${totalPizza > 0 ? svgPizza : '<div class="loading">Sem dados.</div>'}
      </div>
    </div>
  `;
}
 
async function setGraficoPeriodo(n) {
  graficoPeriodo = n;
  await carregarGraficos(currentPrestadorId);
}
 
// ── APROVAR ───────────────────────────────────────────────────────────────────
function aprovarComissoes() {
  if (!currentValidacaoId) return;
  const titulo = document.getElementById('vc-titulo').textContent;
  const total  = document.getElementById('v-total').textContent;
  const periodo = document.getElementById('v-periodo').textContent;
  document.getElementById('modal-aprovar-titulo').textContent  = `Confirmar aprovação — ${periodo}`;
  document.getElementById('modal-aprovar-total').textContent   = total;
  document.getElementById('modal-aprovar').style.display = 'flex';
}

function fecharModalAprovar() {
  document.getElementById('modal-aprovar').style.display = 'none';
}

async function confirmarAprovacao() {
  if (!currentValidacaoId) return;
  const { error } = await sb.from('validacoes_mensais').update({
    status: 'aprovado',
    aprovado_em: new Date().toISOString()
  }).eq('id', currentValidacaoId);
  if (error) { alert('Erro: ' + error.message); return; }
  fecharModalAprovar();
  await carregarPendencias(currentPrestadorId);
  await carregarExtratoPeriodo(currentPrestadorId);
}
 
// ── CONTESTAR ─────────────────────────────────────────────────────────────────
function abrirModalContestar() { document.getElementById('obs-contestar').value = ''; document.getElementById('modal-contestar').style.display = 'flex'; }
function fecharModalContestar() { document.getElementById('modal-contestar').style.display = 'none'; }
 
async function confirmarContestacao() {
  if (!currentValidacaoId) return;
  const obs = document.getElementById('obs-contestar').value.trim();
  if (!obs) { alert('Descreva o motivo.'); return; }
  const { error } = await sb.from('validacoes_mensais').update({ status: 'contestado', observacao: obs }).eq('id', currentValidacaoId);
  if (error) { alert('Erro: ' + error.message); return; }
  fecharModalContestar();
  await carregarPendencias(currentPrestadorId);
  await carregarExtratoPeriodo(currentPrestadorId);
}
 
// ── EXPORTAR PDF ──────────────────────────────────────────────────────────────
async function exportarExtratoPDF() {
  if (!currentPrestadorId) return;
  const { ini, fim } = getVendedorDates();
  const { data: ext }   = await sb.from('vw_extrato_prestador').select('*')
    .eq('prestador_id', currentPrestadorId)
    .gte('periodo_fim', fmtDate(ini))
    .lte('periodo_fim', fmtDate(fim))
    .order('periodo_fim', { ascending: false });
  const { data: prest } = await sb.from('prestadores').select('*').eq('id', currentPrestadorId).single();
  const { data: acum }  = await sb.from('vw_acumulado_prestador').select('*').eq('prestador_id', currentPrestadorId).single();
  if (!ext || !ext.length) { alert('Nenhum dado para exportar.'); return; }
  const tf = ext.filter(e => e.produto === 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
  const tm = ext.filter(e => e.produto !== 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;color:#1a1a1a;margin:0;padding:32px;}
    .header{background:#245091;color:#fff;padding:24px 32px;border-radius:8px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;}
    .header h1{font-size:20px;margin:0;}.sub{font-size:13px;opacity:.8;margin-top:4px;}
    .total-val{font-size:28px;font-weight:700;color:#A4C557;}
    .info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px;}
    .info-card{background:#f5f7fa;border-radius:6px;padding:14px 18px;}
    .info-label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;}
    .info-value{font-size:18px;font-weight:700;color:#245091;}
    table{width:100%;border-collapse:collapse;font-size:13px;}
    th{background:#245091;color:#fff;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;}
    td{padding:10px 12px;border-bottom:1px solid #eee;}
    tr:last-child td{border-bottom:none;}tr:nth-child(even) td{background:#f9f9f9;}
    .green{color:#5a8a20;font-weight:700;}.yellow{color:#c8960a;}
    .footer{margin-top:24px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:16px;}
  </style></head><body>
  <div class="header">
    <div><h1>eFleet · Extrato de Comissões</h1><div class="sub">${prest?.nome || '—'} · ${document.getElementById('v-periodo').textContent}</div></div>
    <div style="text-align:right;"><div style="font-size:13px;opacity:.8;">Total do período</div><div class="total-val">R$ ${(tf + tm).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
  </div>
  <div class="info-grid">
    <div class="info-card"><div class="info-label">Comissão FUEL</div><div class="info-value" style="color:#5a8a20;">R$ ${tf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
    <div class="info-card"><div class="info-label">Mensalidades</div><div class="info-value" style="color:#245091;">R$ ${tm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
    <div class="info-card"><div class="info-label">Acumulado histórico</div><div class="info-value" style="color:#8a6000;">R$ ${acum ? acum.comissao_acumulada.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</div></div>
  </div>
  <table>
    <thead><tr><th>Cliente</th><th>Produto</th><th>Mês curva</th><th>Ramp</th><th>Base</th><th>Comissão</th><th>Status</th></tr></thead>
    <tbody>${ext.map(c => {
      const pct = Math.round(parseFloat(c.fator_ramp) * 100);
      const cs  = c.status === 'suspensa' ? `<span class="yellow">Suspensa — Cliente inadimplente</span>` : `<span class="green">R$ ${parseFloat(c.comissao_bruta).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>`;
      return `<tr><td>${c.cliente_nome}</td><td>${c.produto}</td><td>${c.mes_curva}/12</td><td>${pct}%</td><td>R$ ${parseFloat(c.base_calculo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td>${cs}</td><td>${c.status}</td></tr>`;
    }).join('')}</tbody>
  </table>
  <div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')} · eFleet Digital · efleet-comissoes.vercel.app</div>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.print();
}

function toggleTooltip(el) {
  const tip = el.querySelector('span');
  if (!tip) return;
  const visible = tip.style.display === 'block';
  document.querySelectorAll('.badge-yellow span').forEach(t => t.style.display = 'none');
  tip.style.display = visible ? 'none' : 'block';
}
