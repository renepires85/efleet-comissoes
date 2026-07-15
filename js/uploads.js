// ── UPLOAD ────────────────────────────────────────────────────────────────────
async function processarUpload(input, isArq) {
  if (!input.files.length) return;
  const file = input.files[0];
  const stId = isArq ? 'upload-status-arq' : 'upload-status';
  showStatus(`⏳ Lendo ${file.name}...`, 'warn', stId);
  try {
    const rows = await lerExcel(file);
    if (!rows.length) throw new Error('Arquivo vazio ou formato inválido');
    showStatus(`⏳ Salvando ${rows.length} linhas...`, 'warn', stId);
    const uid = crypto.randomUUID();
    const { error: uerr } = await sb.from('uploads').insert({
      id: uid, nome_arquivo: file.name,
      periodo_inicio: rows[0].periodo_inicio, periodo_fim: rows[0].periodo_fim,
      total_linhas: rows.length, uploader_id: currentUser.id
    });
    if (uerr) throw new Error('Erro ao salvar upload: ' + uerr.message);

    // Busca prestadores para vincular pelo nome
    const { data: prestadores } = await sb.from('prestadores').select('id, nome').eq('ativo', true);
    const prestMap = {};
    (prestadores || []).forEach(p => prestMap[p.nome.trim().toLowerCase()] = p.id);

    const linhas = rows.map(r => ({
      upload_id: uid, uploader_id: currentUser.id,
      periodo_inicio: r.periodo_inicio, periodo_fim: r.periodo_fim,
      vendedor_nome: r.vendedor_nome,
      prestador_id: prestMap[r.vendedor_nome?.trim().toLowerCase()] || null,
      cliente_cnpj: r.cliente_cnpj, cliente_nome: r.cliente_nome,
      ativacao_fuel:    r.ativacao_fuel    || null,
      ativacao_pass:    r.ativacao_pass    || null,
      ativacao_fines:   r.ativacao_fines   || null,
      ativacao_premium: r.ativacao_premium || null,
      tpv_fuel:        r.tpv_fuel      ? parseFloat(r.tpv_fuel)      : null,
      receita_fuel:    r.receita_fuel  ? parseFloat(r.receita_fuel)  : null,
      receita_pass:    r.receita_pass  ? parseFloat(r.receita_pass)  : null,
      receita_fines:   r.receita_fines ? parseFloat(r.receita_fines) : null,
      receita_premium: r.receita_premium ? parseFloat(r.receita_premium) : null,
      status_cliente: r.status_cliente || 'ativo'
    }));

    const { error: ferr } = await sb.from('fechamentos').insert(linhas);
    if (ferr) throw new Error('Erro ao salvar fechamentos: ' + ferr.message);
    showStatus(`⏳ Calculando comissões...`, 'warn', stId);
    const { error: rerr } = await sb.rpc('processar_comissoes', { p_upload_id: uid });
    if (rerr) {
      showStatus(`⚠ Arquivo salvo mas cálculo falhou — clique em "▶ Rodar cálculo". (${rerr.message})`, 'warn', stId);
      input.value = '';
      if (isArq) await carregarArquivos();
      return;
    }
    await sb.rpc('criar_validacoes_pendentes', { p_upload_id: uid });
    showStatus(`✓ ${file.name} processado — ${rows.length} linhas calculadas`, 'ok', stId);
    if (isArq) await carregarArquivos();
    await carregarGestao();
  } catch (e) {
    showStatus(`✗ Erro: ${e.message}`, 'err', stId);
  }
  input.value = '';
}

// ── PRÉ-PROCESSADOR ───────────────────────────────────────────────────────────
function normalizarLinhas(rows) {
  // Mapa de nomes completos e abreviações (com e sem ponto)
  const meses = {
    'janeiro': '01', 'jan': '01',
    'fevereiro': '02', 'fev': '02',
    'marco': '03', 'março': '03', 'mar': '03',
    'abril': '04', 'abr': '04',
    'maio': '05', 'mai': '05',
    'junho': '06', 'jun': '06',
    'julho': '07', 'jul': '07',
    'agosto': '08', 'ago': '08',
    'setembro': '09', 'set': '09',
    'outubro': '10', 'out': '10',
    'novembro': '11', 'nov': '11',
    'dezembro': '12', 'dez': '12'
  };

  function normalizarData(val) {
    if (!val || val.toString().trim() === '') return null;
    const s = val.toString().trim();

    // Já YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // YYYY-M-D sem zeros
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }

    // "1 jun., 2026" ou "4 maio, 2023" ou "4 de maio de 2023"
    // Remove ponto de abreviação antes de processar
    const sSemPonto = s.replace(/\./g, '');
    const match = sSemPonto.toLowerCase().match(/(\d{1,2})\s+(?:de\s+)?(\w+)[,\s]+(\d{4})/);
    if (match) {
      const [, d, mes, y] = match;
      // Remove acentos para normalizar
      const mesNorm = mes.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const m = meses[mesNorm];
      if (m) return `${y}-${m}-${d.padStart(2,'0')}`;
    }

    return null;
  }

  function normalizarValor(val) {
    if (!val || val.toString().trim() === '') return null;
    return val.toString()
      .replace(/R\$\s*/gi, '')  // Remove "R$"
      .replace(/\s/g, '')       // Remove espaços (milhar: "1 208 939,66" → "1208939,66")
      .replace(/\./g, '')       // Remove pontos de milhar
      .replace(',', '.')        // Troca vírgula decimal por ponto
      .trim();
  }

  function normalizarStatus(val) {
    if (!val) return 'ativo';
    const s = val.toString().toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (s === 'inadimplente' || s.includes('bloqueio') || s.includes('inadim')) return 'inadimplente';
    if (s === 'churn') return 'churn';
    return 'ativo';
  }

  return rows
    // Linhas sem vendedor_nome são clientes sem comissão — ignorar silenciosamente
    .filter(r => r.vendedor_nome && r.vendedor_nome.toString().trim() !== '')
    .map(r => ({
      periodo_inicio:   normalizarData(r.periodo_inicio),
      periodo_fim:      normalizarData(r.periodo_fim || r.periodo_final),
      vendedor_nome:    r.vendedor_nome?.toString().trim(),
      cliente_cnpj:     r.cliente_cnpj?.toString().trim(),
      cliente_nome:     r.cliente_nome?.toString().trim(),
      status_cliente:   normalizarStatus(r.status_cliente || r.status_nome),
      ativacao_fuel:    normalizarData(r.ativacao_fuel),
      ativacao_pass:    normalizarData(r.ativacao_pass),
      ativacao_fines:   normalizarData(r.ativacao_fines),
      ativacao_premium: normalizarData(r.ativacao_premium),
      tpv_fuel:         normalizarValor(r.tpv_fuel),
      receita_fuel:     normalizarValor(r.receita_fuel),
      receita_pass:     normalizarValor(r.receita_pass),
      receita_fines:    normalizarValor(r.receita_fines),
      receita_premium:  normalizarValor(r.receita_premium),
    }));
}

// ── LER EXCEL / CSV ───────────────────────────────────────────────────────────
function lerExcel(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith('.csv');

    r.onload = e => {
      try {
        let raw;

        if (isCsv) {
          // ── CSV do BI: separador vírgula, valores entre aspas ──────────────
          const texto = e.target.result;

          // Detecta separador: se a primeira linha tem mais "," que ";" usa vírgula
          const primeiraLinha = texto.split('\n')[0];
          const qtdVirgula = (primeiraLinha.match(/,/g) || []).length;
          const qtdPonto   = (primeiraLinha.match(/;/g) || []).length;
          const sep = qtdVirgula >= qtdPonto ? ',' : ';';

          // Usa SheetJS com o separador correto
          const wb = XLSX.read(texto, { type: 'string', raw: false, dateNF: 'yyyy-mm-dd', FS: sep });
          const ws = wb.Sheets[wb.SheetNames[0]];
          raw = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd' });

        } else {
          // ── XLSX normal ────────────────────────────────────────────────────
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const ws = wb.Sheets['FECHAMENTO_MES'] || wb.Sheets[wb.SheetNames[0]];
          raw = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd' });
        }

        if (!raw || !raw.length) throw new Error('Arquivo vazio ou formato inválido');
        res(normalizarLinhas(raw));
      } catch (err) { rej(err); }
    };

    r.onerror = rej;

    if (isCsv) {
      r.readAsText(file, 'utf-8');
    } else {
      r.readAsArrayBuffer(file);
    }
  });
}

// ── RODAR CÁLCULO ─────────────────────────────────────────────────────────────
async function rodarCalculo() {
  showStatus('⏳ Verificando arquivos pendentes...', 'warn', 'upload-status');
  const { data: uploads } = await sb.from('uploads').select('*').order('criado_em', { ascending: true });
  const { data: coms } = await sb.from('comissoes').select('fechamento_id,fechamentos!inner(upload_id)');
  const uploadsComComs = new Set((coms || []).map(c => c.fechamentos?.upload_id));
  const pendentes = (uploads || []).filter(u => !uploadsComComs.has(u.id));
  if (!pendentes.length) { showStatus('✓ Nenhum arquivo pendente.', 'ok', 'upload-status'); return; }
  let totalOk = 0, totalErr = 0;
  for (const upload of pendentes) {
    const { error } = await sb.rpc('processar_comissoes', { p_upload_id: upload.id });
    if (!error) {
      await sb.rpc('criar_validacoes_pendentes', { p_upload_id: upload.id });
      const r = await calcularCheckpoint(upload);
      totalOk += r.calculadas; totalErr += r.nao_calculadas;
    } else { totalErr++; }
  }
  showStatus(`✓ Concluído — ${totalOk} calculadas · ${totalErr} erros`, 'ok', 'upload-status');
  await carregarGestao();
}

// ── ARQUIVOS ──────────────────────────────────────────────────────────────────
async function carregarArquivos() {
  const { data } = await sb.from('uploads').select('*').order('criado_em', { ascending: false });
  const { data: cps } = await sb.from('checkpoints').select('upload_id');
  const processados = new Set((cps || []).map(c => c.upload_id));
  if (!data || !data.length) {
    document.getElementById('tbody-arquivos').innerHTML = '<tr><td colspan="6" class="loading">Nenhum arquivo enviado.</td></tr>';
    return;
  }
  document.getElementById('tbody-arquivos').innerHTML = data.map(u => {
    const calc = processados.has(u.id);
    return `<tr>
      <td><strong style="color:#fff;font-family:var(--efl-font-head);">${u.nome_arquivo}</strong></td>
      <td class="td-muted">${formatPeriodo(u.periodo_inicio, u.periodo_fim)}</td>
      <td class="td-mono">${u.total_linhas}</td>
      <td><span class="badge ${calc ? 'badge-green' : 'badge-yellow'}">${calc ? 'Calculado' : 'Pendente'}</span></td>
      <td class="td-muted">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
      <td style="display:flex;gap:6px;">
        ${!calc ? `<button class="btn btn-warning btn-sm" onclick="calcularArquivo('${u.id}')">▶ Calcular</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="excluirArquivo('${u.id}','${u.nome_arquivo}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}

async function calcularArquivo(uploadId) {
  const { data: upload } = await sb.from('uploads').select('*').eq('id', uploadId).single();
  if (!upload) return;
  showStatus(`⏳ Calculando...`, 'warn', 'upload-status-arq');
  const { error } = await sb.rpc('processar_comissoes', { p_upload_id: uploadId });
  if (error) { showStatus(`✗ Erro: ${error.message}`, 'err', 'upload-status-arq'); return; }
  await sb.rpc('criar_validacoes_pendentes', { p_upload_id: uploadId });
  const r = await calcularCheckpoint(upload);
  showStatus(`✓ ${r.calculadas} calculadas · ${r.nao_calculadas} erros`, 'ok', 'upload-status-arq');
  await carregarArquivos();
}

async function excluirArquivo(uploadId, nome) {
  if (!confirm(`Excluir "${nome}"? Remove todos os dados vinculados.`)) return;
  const { data: fecIds } = await sb.from('fechamentos').select('id').eq('upload_id', uploadId);
  if (fecIds?.length) await sb.from('comissoes').delete().in('fechamento_id', fecIds.map(f => f.id));
  await sb.from('validacoes_mensais').delete().eq('upload_id', uploadId);
  await sb.from('fechamentos').delete().eq('upload_id', uploadId);
  const { error } = await sb.from('uploads').delete().eq('id', uploadId);
  if (error) { alert('Erro: ' + error.message); return; }
  await carregarArquivos();
  await carregarGestao();
}

// ── CHECKPOINTS ───────────────────────────────────────────────────────────────
let cpAtual = null;

async function carregarCheckpoints() {
  document.getElementById('checkpoint-lista').style.display = 'block';
  document.getElementById('checkpoint-detalhe').style.display = 'none';
  const { data } = await sb.from('checkpoints').select('*,uploads(nome_arquivo)').order('criado_em', { ascending: false });
  if (!data || !data.length) {
    document.getElementById('tbody-checkpoints').innerHTML = '<tr><td colspan="7" class="loading">Nenhum checkpoint.</td></tr>';
    return;
  }
  document.getElementById('tbody-checkpoints').innerHTML = data.map(c => `<tr>
    <td class="td-muted">${formatPeriodo(c.periodo_inicio, c.periodo_fim)}</td>
    <td><strong style="color:#fff;">${c.uploads?.nome_arquivo || '—'}</strong></td>
    <td class="td-mono">${c.total_linhas}</td>
    <td class="td-green">${c.calculadas}</td>
    <td class="${c.nao_calculadas > 0 ? 'td-yellow' : ''}">${c.nao_calculadas}</td>
    <td class="td-muted">${new Date(c.criado_em).toLocaleString('pt-BR')}</td>
    <td><button class="btn btn-ghost btn-sm" onclick="abrirDetalheCheckpoint('${c.id}')">Ver detalhes</button></td>
  </tr>`).join('');
}

async function calcularCheckpoint(upload) {
  const { data: fechamentos } = await sb.from('fechamentos').select('*').eq('upload_id', upload.id);
  const { data: prestadores } = await sb.from('prestadores').select('id,nome').eq('ativo', true);
  const prestMap = {};
  (prestadores || []).forEach(p => prestMap[p.nome.trim().toLowerCase()] = p.id);
  const detalhes = []; let calculadas = 0, erros = 0;
  for (const f of (fechamentos || [])) {
    const produtos = [
      { produto: 'FUEL',    ativacao: f.ativacao_fuel,    receita: f.receita_fuel,    taxa: 0.20 },
      { produto: 'PASS',    ativacao: f.ativacao_pass,    receita: f.receita_pass,    taxa: 0.15 },
      { produto: 'FINES',   ativacao: f.ativacao_fines,   receita: f.receita_fines,   taxa: 0.15 },
      { produto: 'PREMIUM', ativacao: f.ativacao_premium, receita: f.receita_premium, taxa: 0.15 },
    ];
    const pid = prestMap[f.vendedor_nome.trim().toLowerCase()];
    for (const p of produtos) {
      if (!p.ativacao || !p.receita) continue;
      if (!pid) {
        detalhes.push({ vendedor_nome: f.vendedor_nome, cliente_cnpj: f.cliente_cnpj, cliente_nome: f.cliente_nome, produto: p.produto, mes_curva: null, fator_ramp: null, comissao: 0, status: 'erro', erro: 'Prestador não encontrado' });
        erros++; continue;
      }
      const atDate  = new Date(p.ativacao + 'T12:00:00');
      const fimDate = new Date(f.periodo_fim + 'T12:00:00');
      const mes = ((fimDate.getFullYear() - atDate.getFullYear()) * 12 + (fimDate.getMonth() - atDate.getMonth())) + 1;
      let fator = 0;
      if (mes === 1) fator = 0.2;
      else if (mes === 2) fator = 0.4;
      else if (mes === 3) fator = 0.6;
      else if (mes >= 4 && mes <= 6) fator = 0.8;
      else if (mes >= 7 && mes <= 12) fator = 1.0;
      if (fator === 0 && mes > 0) {
        detalhes.push({ vendedor_nome: f.vendedor_nome, cliente_cnpj: f.cliente_cnpj, cliente_nome: f.cliente_nome, produto: p.produto, mes_curva: mes, fator_ramp: fator, comissao: 0, status: 'erro', erro: `Mês ${mes} fora da janela` });
        erros++; continue;
      }
      const comissao  = parseFloat(p.receita) * p.taxa * fator;
      const statusCom = f.status_cliente === 'churn' ? 'zerada' : f.status_cliente === 'inadimplente' ? 'suspensa' : 'calculada';
      detalhes.push({ vendedor_nome: f.vendedor_nome, cliente_cnpj: f.cliente_cnpj, cliente_nome: f.cliente_nome, produto: p.produto, mes_curva: mes, fator_ramp: fator, comissao: statusCom === 'calculada' ? comissao : 0, status: statusCom, erro: null });
      if (statusCom === 'calculada') calculadas++; else erros++;
    }
  }
  await sb.from('checkpoints').insert({
    upload_id: upload.id, periodo_inicio: upload.periodo_inicio, periodo_fim: upload.periodo_fim,
    total_linhas: detalhes.length, calculadas, nao_calculadas: erros,
    detalhes: JSON.stringify(detalhes), criado_por: currentUser.id
  });
  return { calculadas, nao_calculadas: erros };
}

let cpDetalhes = [];

// Agrupa erros variáveis num rótulo único (ex: "Mês 13 fora da janela" → "Mês fora da janela")
function categoriaErro(erro) {
  if (!erro) return '';
  return erro.replace(/Mês \d+/, 'Mês');
}

async function abrirDetalheCheckpoint(cpId) {
  const { data: cp } = await sb.from('checkpoints').select('*,uploads(nome_arquivo)').eq('id', cpId).single();
  if (!cp) return;
  cpAtual = cp;
  document.getElementById('checkpoint-lista').style.display = 'none';
  document.getElementById('checkpoint-detalhe').style.display = 'block';
  document.getElementById('cp-titulo').textContent = `${cp.uploads?.nome_arquivo || '—'} · ${formatPeriodo(cp.periodo_inicio, cp.periodo_fim)}`;
  document.getElementById('cp-total').textContent = cp.total_linhas;
  document.getElementById('cp-ok').textContent    = cp.calculadas;
  document.getElementById('cp-err').textContent   = cp.nao_calculadas;
  cpDetalhes = typeof cp.detalhes === 'string' ? JSON.parse(cp.detalhes) : (cp.detalhes || []);
  limparFiltrosCp(false);
  const erros = [...new Set(cpDetalhes.map(d => categoriaErro(d.erro)).filter(Boolean))].sort();
  document.getElementById('cp-f-erro').innerHTML =
    '<option value="">Erro: todos</option>' +
    erros.map(e => `<option value="${e}">${e}</option>`).join('');
  renderCpDetalhe();
}

function limparFiltrosCp(rerender = true) {
  document.getElementById('cp-f-busca').value   = '';
  document.getElementById('cp-f-produto').value = '';
  document.getElementById('cp-f-status').value  = '';
  document.getElementById('cp-f-erro').value    = '';
  if (rerender) renderCpDetalhe();
}

function renderCpDetalhe() {
  const busca   = document.getElementById('cp-f-busca').value.trim().toLowerCase();
  const produto = document.getElementById('cp-f-produto').value;
  const status  = document.getElementById('cp-f-status').value;
  const erro    = document.getElementById('cp-f-erro').value;

  const det = cpDetalhes.filter(d =>
    (!busca   || `${d.cliente_nome} ${d.vendedor_nome} ${d.cliente_cnpj}`.toLowerCase().includes(busca)) &&
    (!produto || d.produto === produto) &&
    (!status  || d.status === status) &&
    (!erro    || categoriaErro(d.erro) === erro)
  );

  document.getElementById('cp-filtro-info').textContent =
    det.length === cpDetalhes.length ? `${cpDetalhes.length} linhas` : `${det.length} de ${cpDetalhes.length} linhas`;

  if (!det.length) {
    document.getElementById('tbody-cp-detalhe').innerHTML = '<tr><td colspan="9" class="loading">Nenhuma linha corresponde aos filtros.</td></tr>';
    return;
  }
  document.getElementById('tbody-cp-detalhe').innerHTML = det.map(d => {
    const pct     = d.fator_ramp != null ? Math.round(d.fator_ramp * 100) : null;
    const stBadge = d.status === 'calculada' ? 'badge-green' : d.status === 'suspensa' ? 'badge-yellow' : d.status === 'zerada' ? 'badge-blue' : 'badge-red';
    return `<tr>
      <td>${d.vendedor_nome}</td>
      <td><strong style="color:#fff;">${d.cliente_nome}</strong></td>
      <td class="td-mono td-muted">${d.cliente_cnpj}</td>
      <td><span class="badge ${d.produto === 'FUEL' ? 'badge-blue' : 'badge-green'}">${d.produto}</span></td>
      <td class="td-mono">${d.mes_curva != null ? d.mes_curva + '/12' : '—'}</td>
      <td>${pct != null ? `<div class="ramp-bar"><div class="ramp-track"><div class="ramp-fill ${pct < 100 ? 'partial' : ''}" style="width:${pct}%"></div></div><div class="ramp-label">${pct}%</div></div>` : '—'}</td>
      <td class="${d.status === 'calculada' ? 'td-green' : 'td-muted'}">${fmtR(d.comissao)}</td>
      <td><span class="badge ${stBadge}">${d.status}</span></td>
      <td style="font-size:12px;max-width:180px;white-space:normal;color:${d.erro ? 'var(--efl-red)' : d.status === 'suspensa' ? 'var(--efl-yellow)' : d.status === 'zerada' ? 'var(--efl-navy-300)' : 'var(--efl-gray-500)'};">${d.erro || (d.status === 'suspensa' ? 'Cliente inadimplente — comissão suspensa' : d.status === 'zerada' ? 'Cliente em churn — comissão zerada' : '—')}</td>
    </tr>`;
  }).join('');
}

function fecharDetalheCheckpoint() {
  document.getElementById('checkpoint-lista').style.display = 'block';
  document.getElementById('checkpoint-detalhe').style.display = 'none';
  cpAtual = null;
}

async function baixarCheckpoint() {
  if (!cpAtual) return;
  const det = typeof cpAtual.detalhes === 'string' ? JSON.parse(cpAtual.detalhes) : cpAtual.detalhes;
  const wb  = XLSX.utils.book_new();
  const cab = [
    ['Arquivo', cpAtual.uploads?.nome_arquivo || '—'],
    ['Período', formatPeriodo(cpAtual.periodo_inicio, cpAtual.periodo_fim)],
    ['Total', cpAtual.total_linhas],
    ['Calculadas', cpAtual.calculadas],
    ['Erros', cpAtual.nao_calculadas],
    []
  ];
  const rows = [
    ['Vendedor', 'Cliente', 'CNPJ', 'Produto', 'Mês', 'Fator', 'Comissão', 'Status', 'Erro'],
    ...det.map(d => [d.vendedor_nome, d.cliente_nome, d.cliente_cnpj, d.produto, d.mes_curva, d.fator_ramp, d.comissao, d.status, d.erro || ''])
  ];
  const ws = XLSX.utils.aoa_to_sheet([...cab, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Checkpoint');
  XLSX.writeFile(wb, `checkpoint_${cpAtual.periodo_fim}.xlsx`);
}
