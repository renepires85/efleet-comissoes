// ── CARREGAR PRESTADORES ──────────────────────────────────────────────────────
async function carregarPrestadores() {
  const { data } = await sb.from('prestadores').select('*').order('nome');
  if (!data) return;
  document.getElementById('tbody-prestadores').innerHTML = data.map(p => `<tr>
    <td><strong style="color:#fff;font-family:var(--efl-font-head);">${p.nome}</strong></td>
    <td><span class="badge ${p.tipo === 'PJ' ? 'badge-blue' : 'badge-green'}">${p.tipo}</span></td>
    <td class="td-mono td-muted">${p.documento}</td>
    <td class="td-muted">${p.email}</td>
    <td class="td-muted">${p.banco || '—'}</td>
    <td class="td-muted">${p.pix || '—'}</td>
    <td><span class="badge ${p.ativo ? 'badge-green' : 'badge-yellow'}">${p.ativo ? 'Ativo' : 'Inativo'}</span></td>
    <td><button class="btn btn-ghost btn-sm" onclick="abrirModalPrestador('${p.id}')">Editar</button></td>
  </tr>`).join('');
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
  document.getElementById('f-tipo').value   = 'PJ';
  document.getElementById('f-banco').value  = '';
  document.getElementById('f-status').value = 'true';
  toggleDoc();
}

function fecharModalPrestador() { document.getElementById('modal-prestador').style.display = 'none'; }

async function salvarPrestador() {
  const id = document.getElementById('f-id').value;
  const ativo = document.getElementById('f-status').value === 'true';
  const payload = {
    nome:            document.getElementById('f-nome').value,
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

  let error;
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
    const { data: cod } = await sb.rpc('gerar_codigo_prestador', { p_nome: payload.nome });
    payload.codigo = cod;
    ({ error } = await sb.from('prestadores').insert(payload));
    if (error) { alert('Erro: ' + error.message); return; }
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
    st.textContent = `✓ Convite enviado para ${email}`;
  } catch (e) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = `✗ Erro: ${e.message}`;
  }
  btn.textContent = 'Enviar convite'; btn.disabled = false;
}
