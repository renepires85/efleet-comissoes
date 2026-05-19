// ── CARREGAR VENDEDOR ─────────────────────────────────────────────────────────
async function carregarVendedor(pid, nome) {
  document.getElementById('v-nome').textContent = nome;
  const { data: ext }  = await sb.from('vw_extrato_prestador').select('*').eq('prestador_id', pid).order('periodo_fim', { ascending: false });
  const { data: acum } = await sb.from('vw_acumulado_prestador').select('*').eq('prestador_id', pid).single();
  const { data: vals } = await sb.from('validacoes_mensais').select('*').eq('prestador_id', pid).order('criado_em', { ascending: false });

  if (!ext || !ext.length) {
    document.getElementById('v-periodo').textContent = '—';
    document.getElementById('tbody-vendedor').innerHTML = '<tr><td colspan="7" class="loading">Nenhum dado.</td></tr>';
    return;
  }

  const ult  = ext[0].periodo_fim;
  const recs = ext.filter(e => e.periodo_fim === ult);

  document.getElementById('v-periodo').textContent = formatPeriodo(recs[0].periodo_inicio, ult);

  const tf = recs.filter(e => e.produto === 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
  const tm = recs.filter(e => e.produto !== 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);

  document.getElementById('v-total').textContent = fmtR(tf + tm);
  document.getElementById('v-fuel').textContent  = fmtR(tf);
  document.getElementById('v-mens').textContent  = fmtR(tm);
  document.getElementById('v-acum').textContent  = acum ? fmtR(acum.comissao_acumulada) : '—';

  const clis = new Set(recs.filter(e => e.status === 'calculada').map(e => e.cliente_cnpj)).size;
  document.getElementById('v-clientes-badge').textContent = `${clis} clientes ativos`;

  const vm   = vals?.find(v => v.periodo_fim === ult);
  const card = document.getElementById('validacao-card');
  const btnA = document.getElementById('btn-aprovar');
  const btnC = document.getElementById('btn-contestar');

  if (vm) {
    currentValidacaoId = vm.id;
    card.style.display = 'block';
    card.className = `validacao-card ${vm.status}`;
    if (vm.status === 'pendente') {
      document.getElementById('vc-titulo').textContent = '⏳ Comissões prontas para validação';
      document.getElementById('vc-sub').textContent   = 'Confira o detalhamento abaixo e aprove ou conteste os valores até o dia 20.';
      document.getElementById('v-validacao-badge').textContent  = '⏳ Aguardando aprovação';
      document.getElementById('v-validacao-badge').className    = 'badge badge-yellow';
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

  document.getElementById('tbody-vendedor').innerHTML = recs.map(c => {
    const pct = Math.round(parseFloat(c.fator_ramp) * 100);
    const cs  = c.status === 'suspensa' ? `<span class="td-yellow">Suspensa</span>` : `<span class="td-green">${fmtR(c.comissao_bruta)}</span>`;
    const enc = c.mes_curva >= 11 ? `<span class="badge badge-yellow" style="margin-left:4px;font-size:10px;">⚠</span>` : '';
    return `<tr>
      <td><strong style="color:#fff;">${c.cliente_nome}</strong></td>
      <td><span class="badge ${c.produto === 'FUEL' ? 'badge-blue' : 'badge-green'}">${c.produto}</span></td>
      <td class="td-mono">${c.mes_curva}/12 ${enc}</td>
      <td><div class="ramp-bar"><div class="ramp-track"><div class="ramp-fill ${pct < 100 ? 'partial' : ''}" style="width:${pct}%"></div></div><div class="ramp-label">${pct}%</div></div></td>
      <td class="td-mono">${fmtR(c.base_calculo)}</td>
      <td>${cs}</td>
      <td><span class="badge ${c.status === 'calculada' ? 'badge-green' : 'badge-yellow'}">${c.status}</span></td>
    </tr>`;
  }).join('');
}

// ── APROVAR ───────────────────────────────────────────────────────────────────
async function aprovarComissoes() {
  if (!currentValidacaoId) return;
  const { error } = await sb.from('validacoes_mensais').update({ status: 'aprovado', aprovado_em: new Date().toISOString() }).eq('id', currentValidacaoId);
  if (error) { alert('Erro: ' + error.message); return; }
  await carregarVendedor(currentPrestadorId, document.getElementById('v-nome').textContent);
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
  await carregarVendedor(currentPrestadorId, document.getElementById('v-nome').textContent);
}

// ── EXPORTAR PDF ──────────────────────────────────────────────────────────────
async function exportarExtratoPDF() {
  if (!currentPrestadorId) return;
  const { data: ext }  = await sb.from('vw_extrato_prestador').select('*').eq('prestador_id', currentPrestadorId).order('periodo_fim', { ascending: false });
  const { data: prest } = await sb.from('prestadores').select('*').eq('id', currentPrestadorId).single();
  const { data: acum }  = await sb.from('vw_acumulado_prestador').select('*').eq('prestador_id', currentPrestadorId).single();
  if (!ext || !ext.length) { alert('Nenhum dado para exportar.'); return; }
  const ult  = ext[0].periodo_fim;
  const recs = ext.filter(e => e.periodo_fim === ult);
  const tf   = recs.filter(e => e.produto === 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
  const tm   = recs.filter(e => e.produto !== 'FUEL' && e.status === 'calculada').reduce((s, e) => s + parseFloat(e.comissao_bruta || 0), 0);
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
    <div><h1>eFleet · Extrato de Comissões</h1><div class="sub">${prest?.nome || '—'} · ${formatPeriodo(recs[0]?.periodo_inicio, ult)}</div></div>
    <div style="text-align:right;"><div style="font-size:13px;opacity:.8;">Total do mês</div><div class="total-val">R$ ${(tf + tm).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
  </div>
  <div class="info-grid">
    <div class="info-card"><div class="info-label">Comissão FUEL</div><div class="info-value" style="color:#5a8a20;">R$ ${tf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
    <div class="info-card"><div class="info-label">Mensalidades</div><div class="info-value" style="color:#245091;">R$ ${tm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
    <div class="info-card"><div class="info-label">Acumulado histórico</div><div class="info-value" style="color:#8a6000;">R$ ${acum ? acum.comissao_acumulada.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</div></div>
  </div>
  <table>
    <thead><tr><th>Cliente</th><th>Produto</th><th>Mês curva</th><th>Ramp</th><th>Base</th><th>Comissão</th><th>Status</th></tr></thead>
    <tbody>${recs.map(c => {
      const pct = Math.round(parseFloat(c.fator_ramp) * 100);
      const cs  = c.status === 'suspensa' ? `<span class="yellow">Suspensa</span>` : `<span class="green">R$ ${parseFloat(c.comissao_bruta).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>`;
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
