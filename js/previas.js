// ── PRÉVIAS DO MÊS (visão da gestão) ──────────────────────────────────────────
// A prévia já existia, mas só na tela de cada parceiro: a gestão via o mês
// corrente somente depois do fechamento, no dia 03 do mês seguinte. Ou seja,
// o mês inteiro corria às cegas — não dava para perceber a tempo um parceiro
// despencando, um cliente grande bloqueado, ou um mês que vai fechar muito
// diferente do anterior.
//
// É ESTIMATIVA e a tela repete isso: os dados vêm da carga diária do Data Lake,
// mudam até o último dia, e comissão de cliente bloqueado/inadimplente/cancelado
// não é paga enquanto a situação não se regularizar.

let previasCache = [];
let previaExpandido = new Set();

async function carregarPrevias() {
  const alvo = document.getElementById('tbody-previas');
  if (!alvo) return;

  // Sem filtro de período: a tabela guarda só o mês corrente, reescrita a cada
  // carga diária. Filtrar por data aqui só criaria uma forma de a tela mentir
  // se o cron atrasar.
  const { data, error } = await sb.from('previa_comissoes')
    .select('*, prestadores(nome, tipo_parceiro, ativo)')
    .order('comissao_prevista', { ascending: false });

  if (error) {
    alvo.innerHTML = `<tr><td colspan="7" class="loading">Não foi possível carregar: ${error.message}</td></tr>`;
    return;
  }

  previasCache = data || [];
  renderPrevias();
}

function renderPrevias() {
  const alvo = document.getElementById('tbody-previas');
  const soComValor = document.getElementById('pv-f-valor')?.checked ?? true;
  const busca = chaveBusca(document.getElementById('pv-f-busca')?.value.trim() ?? '');

  // Agrupa por parceiro. Um parceiro aparece uma vez, com os clientes dentro —
  // a lista crua tem uma linha por produto por cliente e não se lê.
  const porParceiro = new Map();
  for (const l of previasCache) {
    const p = l.prestadores;
    if (!p) continue;
    const atual = porParceiro.get(l.prestador_id) ?? {
      id: l.prestador_id, nome: p.nome, tipo: p.tipo_parceiro || 'vendedor',
      ativo: p.ativo, total: 0, bloqueado: 0, clientes: new Map(),
    };
    const v = Number(l.comissao_prevista || 0);
    atual.total += v;
    if (l.bloqueada) atual.bloqueado += v;

    const c = atual.clientes.get(l.cliente_cnpj) ?? {
      nome: l.cliente_nome, cnpj: l.cliente_cnpj, valor: 0, tpv: 0,
      bloqueada: l.bloqueada, status: l.status_cliente, produtos: [],
    };
    c.valor += v;
    c.tpv += Number(l.tpv || 0);
    c.produtos.push(`${l.produto} ${fmtR(v)}`);
    atual.clientes.set(l.cliente_cnpj, c);
    porParceiro.set(l.prestador_id, atual);
  }

  let linhas = [...porParceiro.values()].sort((a, b) => b.total - a.total);
  if (soComValor) linhas = linhas.filter(p => p.total > 0);
  if (busca) linhas = linhas.filter(p => chaveBusca(p.nome).includes(busca));

  // Os totais somam o que está EM TELA. Se somassem tudo, o rodapé não bateria
  // com as linhas e a gestão perderia a confiança nos dois números.
  const total = linhas.reduce((s, p) => s + p.total, 0);
  const bloqueado = linhas.reduce((s, p) => s + p.bloqueado, 0);
  document.getElementById('pv-total').textContent     = fmtR(total);
  document.getElementById('pv-validado').textContent  = fmtR(total - bloqueado);
  document.getElementById('pv-bloqueado').textContent = fmtR(bloqueado);
  document.getElementById('pv-parceiros').textContent = linhas.length;

  if (!linhas.length) {
    alvo.innerHTML = '<tr><td colspan="7" class="loading">Nenhuma prévia para os filtros atuais.</td></tr>';
    return;
  }

  alvo.innerHTML = linhas.map(p => {
    const aberto = previaExpandido.has(p.id);
    const clientes = [...p.clientes.values()].sort((a, b) => b.valor - a.valor);
    const detalhe = !aberto ? '' : `
      <tr><td colspan="7" style="padding:0;background:rgba(255,255,255,0.02);">
        <table style="width:100%;">
          <thead><tr>
            <th style="padding-left:44px;">Cliente</th><th>Situação</th><th>TPV</th>
            <th>Produtos</th><th style="text-align:right;padding-right:22px;">Comissão</th>
          </tr></thead>
          <tbody>${clientes.map(c => `
            <tr>
              <td style="padding-left:44px;">
                <button class="link-cliente" onclick="abrirFichaCliente('${c.cnpj}','gestao-previa')">${c.nome}</button>
                <div class="td-codigo">${fmtCnpj(c.cnpj)}</div>
              </td>
              <td><span class="badge ${c.bloqueada ? 'badge-red' : 'badge-green'}">${c.status || '—'}</span></td>
              <td class="td-mono td-muted">${fmtR(c.tpv)}</td>
              <td class="td-muted" style="font-size:12px;">${c.produtos.join(' · ')}</td>
              <td class="td-mono" style="text-align:right;padding-right:22px;color:${c.bloqueada ? 'var(--efl-gray-500)' : 'var(--efl-green-400)'};">${fmtR(c.valor)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </td></tr>`;

    return `<tr>
      <td>
        <button class="btn btn-ghost btn-sm" style="padding:2px 8px;" onclick="togglePrevia('${p.id}')">${aberto ? '−' : '+'}</button>
      </td>
      <td>
        <strong style="color:#fff;font-family:var(--efl-font-head);">${p.nome}</strong>
        ${p.ativo ? '' : '<span class="badge badge-yellow" style="margin-left:6px;padding:1px 6px;font-size:9px;">Inativo</span>'}
      </td>
      <td><span class="badge ${p.tipo === 'indicador' ? 'badge-purple' : 'badge-blue'}">${p.tipo === 'indicador' ? 'Indicador' : 'Vendedor'}</span></td>
      <td class="td-mono td-muted">${p.clientes.size}</td>
      <td class="td-mono" style="color:var(--efl-green-400);">${fmtR(p.total)}</td>
      <td class="td-mono" style="color:${p.bloqueado > 0 ? 'var(--efl-orange)' : 'var(--efl-gray-500)'};">${fmtR(p.bloqueado)}</td>
      <td class="td-mono"><strong>${fmtR(p.total - p.bloqueado)}</strong></td>
    </tr>${detalhe}`;
  }).join('');
}

function togglePrevia(id) {
  if (previaExpandido.has(id)) previaExpandido.delete(id);
  else previaExpandido.add(id);
  renderPrevias();
}

// Quando a prévia foi atualizada pela última vez. Importante deixar à vista:
// se o cron falhar, a tela continuaria mostrando números plausíveis de ontem
// sem nenhum sinal de que pararam no tempo.
async function carregarCarimboPrevia() {
  const el = document.getElementById('pv-atualizado');
  if (!el) return;
  const { data } = await sb.from('previa_comissoes')
    .select('atualizado_em, periodo_inicio')
    .order('atualizado_em', { ascending: false }).limit(1);

  if (!data?.length) { el.textContent = 'sem dados de prévia'; return; }

  const quando = new Date(data[0].atualizado_em);
  const horas = Math.floor((Date.now() - quando) / 3600000);
  const mes = new Date(data[0].periodo_inicio + 'T12:00:00')
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  el.innerHTML = `${mes} · atualizado ${quando.toLocaleString('pt-BR')}` +
    (horas > 30 ? ` <span style="color:var(--efl-orange);">— há ${Math.floor(horas / 24)} dias, a carga diária pode ter parado</span>` : '');
}
