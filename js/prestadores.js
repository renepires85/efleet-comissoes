// ── CARREGAR PRESTADORES ──────────────────────────────────────────────────────
async function carregarPrestadores() {
  const { data } = await sb.from('prestadores').select('*').order('nome');
  if (!data) return;
  document.getElementById('tbody-prestadores').innerHTML = data.map(p => {
    const ehIndicador = p.tipo_parceiro === 'indicador';
    return `<tr>
    <td>
      <strong style="color:#fff;font-family:var(--efl-font-head);">${p.nome}</strong>
      <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
        ${p.codigo ? `<span class="td-codigo">${p.codigo}</span>` : ''}
        ${ehIndicador ? `<span class="badge badge-purple" style="padding:1px 6px;font-size:9px;">Indicador</span>` : ''}
      </div>
    </td>
    <td><span class="badge ${p.tipo === 'PJ' ? 'badge-blue' : 'badge-green'}">${p.tipo}</span></td>
    <td class="td-mono td-muted">${p.documento}</td>
    <td class="td-muted">${p.email}</td>
    <td class="td-muted">${p.banco || '—'}</td>
    <td class="td-muted">${p.pix || '—'}</td>
    <td><span class="badge ${p.ativo ? 'badge-green' : 'badge-yellow'}">${p.ativo ? 'Ativo' : 'Inativo'}</span></td>
    <td><button class="btn btn-ghost btn-sm" onclick="abrirModalPrestador('${p.id}')">Editar</button></td>
  </tr>`;
  }).join('');
}

async function toggleContratoIndicador() {
  const ehIndicador = document.getElementById('f-tipo-parceiro').value === 'indicador';
  document.getElementById('bloco-contrato-indicador').style.display = ehIndicador ? 'block' : 'none';

  // Se está editando um prestador já salvo e virou indicador agora, mostra
  // (e carrega) os clientes vinculados sem precisar reabrir o modal.
  const id = document.getElementById('f-id').value;
  if (ehIndicador && id) {
    document.getElementById('bloco-clientes-vinculados').style.display = 'block';
    await carregarClientesVinculados(id);
  }
}

// ── CLIENTES VINCULADOS AO INDICADOR ──────────────────────────────────────────
// Mapa cliente_cnpj -> cliente_nome mais recente, montado a partir do
// histórico de fechamentos (única fonte de nome de cliente que existe no
// sistema — não há um cadastro de clientes separado). Cacheado por sessão.
let mapaClientesFechamentos = null;

async function carregarMapaClientesFechamentos() {
  if (mapaClientesFechamentos) return mapaClientesFechamentos;
  const { data } = await sb.from('fechamentos')
    .select('cliente_cnpj,cliente_nome,criado_em')
    .order('criado_em', { ascending: false });
  mapaClientesFechamentos = new Map();
  (data || []).forEach(f => {
    if (!mapaClientesFechamentos.has(f.cliente_cnpj)) {
      mapaClientesFechamentos.set(f.cliente_cnpj, f.cliente_nome);
    }
  });
  const dl = document.getElementById('dl-clientes-fechamentos');
  dl.innerHTML = [...mapaClientesFechamentos.entries()]
    .map(([cnpj, nome]) => `<option value="${cnpj}" label="${nome}"></option>`).join('');
  return mapaClientesFechamentos;
}

async function carregarClientesVinculados(indicadorId) {
  await carregarMapaClientesFechamentos();
  const { data } = await sb.from('clientes_indicadores').select('cliente_cnpj').eq('indicador_id', indicadorId).order('cliente_cnpj');
  const lista = document.getElementById('lista-clientes-vinculados');
  if (!data || !data.length) {
    lista.innerHTML = `<div style="font-size:12.5px;color:var(--efl-gray-500);">Nenhum cliente vinculado ainda.</div>`;
    return;
  }
  lista.innerHTML = data.map(v => {
    const nome = mapaClientesFechamentos.get(v.cliente_cnpj) || '(sem fechamento registrado)';
    return `<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:7px 10px;">
      <div><strong style="font-size:13px;color:#fff;">${nome}</strong><span class="td-mono td-muted" style="margin-left:8px;font-size:11px;">${v.cliente_cnpj}</span></div>
      <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:12px;" onclick="removerClienteIndicador('${v.cliente_cnpj}', '${indicadorId}')">✕</button>
    </div>`;
  }).join('');
}

async function adicionarClienteIndicador() {
  const indicadorId = document.getElementById('f-id').value;
  if (!indicadorId) { alert('Salve o cadastro do indicador antes de vincular clientes.'); return; }
  const input = document.getElementById('f-ind-novo-cliente');
  const cnpj = input.value.replace(/\D/g, '');
  if (!cnpj) { alert('Digite ou selecione um cliente.'); return; }

  const { data: existente } = await sb.from('clientes_indicadores').select('indicador_id').eq('cliente_cnpj', cnpj).maybeSingle();
  if (existente && existente.indicador_id !== indicadorId) {
    const nomeAtual = mapaClientesFechamentos?.get(cnpj) || cnpj;
    if (!confirm(`${nomeAtual} já está vinculado a outro indicador. Transferir para este?`)) return;
  }

  const { error } = await sb.from('clientes_indicadores').upsert({ cliente_cnpj: cnpj, indicador_id: indicadorId });
  if (error) { alert('Erro ao vincular: ' + error.message); return; }
  input.value = '';
  await carregarClientesVinculados(indicadorId);
}

async function removerClienteIndicador(cnpj, indicadorId) {
  if (!confirm('Desvincular este cliente do indicador?')) return;
  const { error } = await sb.from('clientes_indicadores').delete().eq('cliente_cnpj', cnpj);
  if (error) { alert('Erro ao desvincular: ' + error.message); return; }
  await carregarClientesVinculados(indicadorId);
}

// ── MODAL PRESTADOR ───────────────────────────────────────────────────────────
async function abrirModalPrestador(id) {
  limparModalPrestador();
  if (id) {
    const { data: p } = await sb.from('prestadores').select('*').eq('id', id).single();
    if (p) {
      document.getElementById('modal-prestador-title').textContent = p.nome;
      document.getElementById('f-id').value          = p.id;
      document.getElementById('f-nome').value        = p.nome || '';
      document.getElementById('f-tipo-parceiro').value = p.tipo_parceiro || 'vendedor';
      document.getElementById('f-tipo').value        = p.tipo || 'PJ';
      document.getElementById('f-doc').value         = p.documento || '';
      document.getElementById('f-email').value       = p.email || '';
      document.getElementById('f-cpf').value         = p.cpf_responsavel || '';
      document.getElementById('f-telefone').value    = p.telefone || '';
      document.getElementById('f-banco').value       = p.banco || '';
      document.getElementById('f-agencia').value     = p.agencia || '';
      document.getElementById('f-conta').value       = p.conta || '';
      document.getElementById('f-tipo-conta').value  = p.tipo_conta || 'corrente';
      document.getElementById('f-pix').value         = p.pix || '';
      document.getElementById('f-status').value      = p.ativo ? 'true' : 'false';
      toggleDoc();
      // toggleContratoIndicador já cuida de mostrar e carregar os clientes
      // vinculados, já que f-id foi preenchido acima.
      await toggleContratoIndicador();

      if (p.tipo_parceiro === 'indicador') {
        const { data: contrato } = await sb.from('contratos_indicadores')
          .select('*').eq('prestador_id', id).order('data_inicio', { ascending: false }).limit(1).maybeSingle();
        if (contrato) {
          document.getElementById('f-ind-percentual').value  = contrato.percentual_comissao;
          document.getElementById('f-ind-recorrencia').value = contrato.periodo_recorrencia;
          document.getElementById('f-ind-status').value      = contrato.status;
          document.querySelectorAll('.f-ind-produto').forEach(cb => {
            cb.checked = (contrato.produtos_elegiveis || []).includes(cb.value);
          });
        }
      }
    }
  }
  document.getElementById('modal-prestador').style.display = 'flex';
}

function abrirModalBanco() {
  if (!currentPrestadorId) return;
  abrirModalPrestador(currentPrestadorId).then(() => {
    ['f-nome', 'f-tipo', 'f-doc', 'f-email', 'f-status'].forEach(id => {
      const el = document.getElementById(id);
      el.disabled = true; el.style.opacity = '.5';
    });
  });
}

function limparModalPrestador() {
  document.getElementById('modal-prestador-title').textContent = 'Novo prestador';
  document.getElementById('f-id').value = '';
  ['f-nome', 'f-doc', 'f-email', 'f-agencia', 'f-conta', 'f-pix', 'f-cpf', 'f-telefone'].forEach(id => document.getElementById(id).value = '');
  ['f-nome', 'f-tipo', 'f-doc', 'f-email', 'f-status'].forEach(id => {
    const el = document.getElementById(id); el.disabled = false; el.style.opacity = '1';
  });
  document.getElementById('f-tipo').value          = 'PJ';
  document.getElementById('f-tipo-parceiro').value = 'vendedor';
  document.getElementById('f-banco').value  = '';
  document.getElementById('f-status').value = 'true';
  document.getElementById('f-ind-percentual').value  = '';
  document.getElementById('f-ind-recorrencia').value = '12';
  document.getElementById('f-ind-status').value      = 'pendente';
  document.querySelectorAll('.f-ind-produto').forEach(cb => cb.checked = false);
  document.getElementById('bloco-clientes-vinculados').style.display = 'none';
  document.getElementById('f-ind-novo-cliente').value = '';
  toggleDoc();
  toggleContratoIndicador();
}

function fecharModalPrestador() { document.getElementById('modal-prestador').style.display = 'none'; }

async function salvarPrestador() {
  const id = document.getElementById('f-id').value;
  const ativo = document.getElementById('f-status').value === 'true';
  const tipoParceiro = document.getElementById('f-tipo-parceiro').value;
  const payload = {
    nome:            document.getElementById('f-nome').value,
    tipo_parceiro:   tipoParceiro,
    tipo:            document.getElementById('f-tipo').value,
    documento:       document.getElementById('f-doc').value,
    email:           document.getElementById('f-email').value,
    cpf_responsavel: document.getElementById('f-cpf').value,
    telefone:        document.getElementById('f-telefone').value,
    banco:           document.getElementById('f-banco').value,
    agencia:         document.getElementById('f-agencia').value,
    conta:           document.getElementById('f-conta').value,
    tipo_conta:      document.getElementById('f-tipo-conta').value,
    pix:             document.getElementById('f-pix').value,
    ativo
  };

  let error, prestadorId = id;
  if (id) {
    const { data: prestadorAtual } = await sb.from('prestadores').select('ativo, usuario_id').eq('id', id).single();
    ({ error } = await sb.from('prestadores').update(payload).eq('id', id));
    if (error) { alert('Erro: ' + error.message); return; }

    if (prestadorAtual && prestadorAtual.ativo !== ativo && prestadorAtual.usuario_id) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(SMART_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON
          },
          body: JSON.stringify({
            action: 'atualizar_usuario',
            usuario_id: prestadorAtual.usuario_id,
            ativo
          })
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);
      } catch (e) {
        alert(`⚠️ Cadastro salvo mas erro ao ${ativo ? 'reativar' : 'bloquear'} acesso: ${e.message}`);
      }
    }
  } else {
    // codigo é gerado automaticamente pelo trigger set_codigo (prefixo VND/IND
    // conforme tipo_parceiro) — não passar aqui.
    const { data: novo, error: errIns } = await sb.from('prestadores').insert(payload).select('id').single();
    error = errIns;
    if (error) { alert('Erro: ' + error.message); return; }
    prestadorId = novo.id;
  }

  if (tipoParceiro === 'indicador') {
    const contratoPayload = {
      prestador_id:        prestadorId,
      percentual_comissao: parseFloat(document.getElementById('f-ind-percentual').value) || 0,
      periodo_recorrencia: parseInt(document.getElementById('f-ind-recorrencia').value, 10),
      produtos_elegiveis:  [...document.querySelectorAll('.f-ind-produto:checked')].map(cb => cb.value),
      status:              document.getElementById('f-ind-status').value
    };
    const { data: existente } = await sb.from('contratos_indicadores')
      .select('id').eq('prestador_id', prestadorId).order('data_inicio', { ascending: false }).limit(1).maybeSingle();
    const { error: errContrato } = existente
      ? await sb.from('contratos_indicadores').update(contratoPayload).eq('id', existente.id)
      : await sb.from('contratos_indicadores').insert(contratoPayload);
    if (errContrato) { alert('Cadastro salvo, mas houve erro ao salvar o contrato: ' + errContrato.message); return; }
  }

  fecharModalPrestador();
  await carregarPrestadores();
}

function toggleDoc() {
  const t = document.getElementById('f-tipo').value;
  document.getElementById('f-doc-label').textContent  = t === 'PJ' ? 'CNPJ' : 'CPF';
  document.getElementById('f-doc').placeholder        = t === 'PJ' ? '00.000.000/0001-00' : '000.000.000-00';
}

// ── MODAL CONVITE ─────────────────────────────────────────────────────────────
function abrirModalConvite() {
  document.getElementById('c-nome').value  = '';
  document.getElementById('c-email').value = '';
  document.getElementById('c-perfil').value = 'vendedor';
  const st = document.getElementById('c-status');
  st.style.display = 'none'; st.className = 'status-box';
  document.getElementById('modal-convite').style.display = 'flex';
}

function fecharModalConvite() { document.getElementById('modal-convite').style.display = 'none'; }

async function enviarConvite() {
  const nome   = document.getElementById('c-nome').value.trim();
  const email  = document.getElementById('c-email').value.trim();
  const perfil = document.getElementById('c-perfil').value;
  const st     = document.getElementById('c-status');
  const btn    = document.getElementById('btn-enviar-convite');
  if (!nome || !email) { alert('Preencha nome e e-mail.'); return; }
  btn.textContent = 'Enviando...'; btn.disabled = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SMART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ nome, email, perfil })
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    st.className = 'status-box status-ok'; st.style.display = 'block';
    // Se o e-mail não saiu, o acesso existe do mesmo jeito — mostramos a senha
    // para a gestão repassar por outro canal, em vez de deixar um cadastro
    // criado que ninguém consegue usar.
    st.innerHTML = result.email_enviado
      ? `✓ Convite enviado para ${email}`
      : `✓ Acesso criado, mas o e-mail não saiu.<br>Senha provisória: <strong style="font-family:ui-monospace,monospace;">${result.senha_provisoria}</strong><br><span style="font-size:12px;">Repasse por um canal privado.</span>`;
    await carregarPrestadores?.();
  } catch (e) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = `✗ Erro: ${e.message}`;
  }
  btn.textContent = 'Enviar convite'; btn.disabled = false;
}
